import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileTokenStore } from "../../src/auth/storage.js";
import { RepoHopOAuthProvider } from "../../src/auth/provider.js";
import { RepoHopClient } from "../../src/tools/client.js";
import { createConfirmElicitationHandler } from "../../src/transport/client.js";
import { loadConfig } from "../../src/config.js";
import { RepoHopError } from "../../src/errors.js";

function tempPath(): string {
	return path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "repohop-mcp-")),
		"tokens.json",
	);
}

describe("token store", () => {
	test("round-trips client info, tokens, verifier with 0600 mode", () => {
		const file = tempPath();
		const store = new FileTokenStore(file);
		store.saveClientInformation({ client_id: "abc" }, "https://x");
		store.saveTokens(
			{ access_token: "tok", token_type: "Bearer", refresh_token: "ref" },
			"https://x",
		);
		store.saveCodeVerifier("verifier");
		expect(store.getClientInformation("https://x")?.client_id).toBe("abc");
		expect(store.getTokens("https://x")?.refresh_token).toBe("ref");
		expect(store.getCodeVerifier()).toBe("verifier");
		expect(fs.statSync(file).mode & 0o777).toBe(0o600);
		store.clear("all");
		expect(store.exists()).toBe(false);
	});
});

describe("oauth provider", () => {
	test("advertises a public native client with loopback redirect", () => {
		const provider = new RepoHopOAuthProvider({
			tokenPath: tempPath(),
			callbackPort: 12719,
			scopes: ["projects:read", "offline_access"],
		});
		expect(provider.redirectUrl).toBe("http://127.0.0.1:12719/callback");
		expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none");
		expect(provider.clientMetadata.redirect_uris).toEqual([
			provider.redirectUrl,
		]);
		expect(provider.hasTokens()).toBe(false);
	});
	test("honors custom redirect URI in metadata", () => {
		const provider = new RepoHopOAuthProvider({
			tokenPath: tempPath(),
			callbackPort: 12719,
			scopes: ["projects:read"],
			redirectUri: "https://agent.meta.ai/api/hatch/oauth/callback",
		});
		expect(provider.redirectUrl).toBe(
			"https://agent.meta.ai/api/hatch/oauth/callback",
		);
		expect(provider.clientMetadata.redirect_uris).toEqual([
			"https://agent.meta.ai/api/hatch/oauth/callback",
		]);
	});
});

describe("client guards", () => {
	function stubClient() {
		return {
			listTools: async (): Promise<{ tools: Array<{ name: string }> }> => ({
				tools: [{ name: "project_read" }],
			}),
			callTool: async (): Promise<{
				structuredContent: { result: unknown };
				content: Array<{ type: string; text: string }>;
			}> => ({
				structuredContent: { result: { ok: true } },
				content: [{ type: "text", text: "{}" }],
			}),
		};
	}

	test("budget guard rejects oversized payloads before sending", async () => {
		const client = new RepoHopClient(stubClient() as never, loadConfig({}));
		let error: unknown;
		try {
			await client.call("project_read", {
				project: "x",
				path: "f",
				offset: 0,
				limit: 1,
				pad: "y".repeat(70 * 1024),
			});
		} catch (error_) {
			error = error_;
		}
		expect(error).toBeInstanceOf(RepoHopError);
		expect((error as RepoHopError).code).toBe("REQUEST_TOO_LARGE");
	});

	test("missing grant tool fails with scope guidance", async () => {
		const client = new RepoHopClient(stubClient() as never, loadConfig({}));
		await client.tools();
		let error: unknown;
		try {
			await client.call("project_exec", { project: "x" });
		} catch (error_) {
			error = error_;
		}
		expect(error).toBeInstanceOf(RepoHopError);
		expect((error as RepoHopError).code).toBe("FORBIDDEN_SCOPE");
	});

	test("unknown project alias never substitutes", async () => {
		const stub = stubClient();
		stub.listTools = async () => ({ tools: [{ name: "project_catalog" }] });
		stub.callTool = async () => ({
			structuredContent: { result: [{ alias: "site", ready: true }] },
			content: [{ type: "text", text: "{}" }],
		});
		const client = new RepoHopClient(stub as never, loadConfig({}));
		await client.tools();
		await expect(client.read({ project: "other", path: "x" })).rejects.toThrow(
			/Unknown project alias/,
		);
	});
});

describe("management tools", () => {
	function manageStub() {
		const calls: Array<{ name: string; args: unknown }> = [];
		return {
			calls,
			listTools: async (): Promise<{ tools: Array<{ name: string }> }> => ({
				tools: [
					{ name: "manage_devices_list" },
					{ name: "manage_devices_remove" },
					{ name: "manage_repositories_list" },
					{ name: "manage_repositories_request" },
					{ name: "manage_connections_list" },
					{ name: "manage_connections_revoke" },
					{ name: "manage_settings_read" },
				],
			}),
			callTool: async (request: {
				name: string;
				arguments: unknown;
			}): Promise<{
				structuredContent: { result: unknown };
				content: Array<{ type: string; text: string }>;
			}> => {
				calls.push({ name: request.name, args: request.arguments });
				return {
					structuredContent: { result: { ok: true } },
					content: [{ type: "text", text: "{}" }],
				};
			},
		};
	}

	test("account tools skip project routing and call through", async () => {
		const stub = manageStub();
		const client = new RepoHopClient(stub as never, loadConfig({}));
		await client.tools();
		// No catalog call: zero callTool invocations before the first action.
		await client.devices({ limit: 10 });
		await client.repositories({});
		await client.connections({});
		await client.readSettings({ teamId: "team-1" });
		expect(stub.calls.map((call) => call.name)).toEqual([
			"manage_devices_list",
			"manage_repositories_list",
			"manage_connections_list",
			"manage_settings_read",
		]);
	});

	test("management mutations send requestId and stay budgeted", async () => {
		const stub = manageStub();
		const client = new RepoHopClient(stub as never, loadConfig({}));
		await client.tools();
		await client.removeDevice({ deviceId: "dev-1", requestId: "req-1" });
		await client.revokeConnection({
			connectionId: "grant-1",
			requestId: "req-2",
		});
		await client.requestRepositoryChange({
			workspaceId: "ws-1",
			requestId: "req-3",
			permissions: { canWrite: true },
		});
		expect(stub.calls).toHaveLength(3);
		let error: unknown;
		try {
			await client.requestRepositoryChange({
				workspaceId: "ws-1",
				requestId: "req-4",
				policy: { defaultBranch: "x".repeat(300 * 1024) },
			});
		} catch (error_) {
			error = error_;
		}
		expect(error).toBeInstanceOf(RepoHopError);
		expect((error as RepoHopError).code).toBe("REQUEST_TOO_LARGE");
	});

	test("missing manage grant fails with scope guidance", async () => {
		const stub = manageStub();
		stub.listTools = async () => ({ tools: [{ name: "project_read" }] });
		const client = new RepoHopClient(stub as never, loadConfig({}));
		await client.tools();
		let error: unknown;
		try {
			await client.devices({});
		} catch (error_) {
			error = error_;
		}
		expect(error).toBeInstanceOf(RepoHopError);
		expect((error as RepoHopError).code).toBe("FORBIDDEN_SCOPE");
		expect(String((error as RepoHopError).message)).toMatch(
			/manage:devices:read/,
		);
	});
});

describe("elicitation confirmations", () => {
	test("accept carries confirm:true, decline/refusal declines", async () => {
		const accept = createConfirmElicitationHandler(async () => true);
		expect(
			await accept({
				params: {
					message: "Remove MacBook?",
					requestedSchema: { type: "object", properties: {} },
				},
			} as never),
		).toEqual({ action: "accept", content: { confirm: true } });

		const decline = createConfirmElicitationHandler(async () => false);
		expect(
			await decline({ params: { message: "Remove MacBook?" } } as never),
		).toEqual({ action: "decline" });

		const throwing = createConfirmElicitationHandler(async () => {
			throw new Error("no terminal");
		});
		expect(
			await throwing({ params: { message: "Remove MacBook?" } } as never),
		).toEqual({ action: "decline" });
	});
});
