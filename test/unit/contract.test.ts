import { describe, expect, test } from "bun:test";
import { loadConfig, REPOHOP_SCOPES } from "../../src/config.js";
import {
	RepoHopError,
	codeForToolError,
	getToolErrorDetail,
} from "../../src/errors.js";
import {
	GATEWAY_BODY_LIMIT_BYTES,
	REPOHOP_REQUEST_BUDGETS,
	REPOHOP_TOOL_NAMES,
	REPOHOP_TOOL_RISK,
	REPOHOP_TOOL_SCOPES,
	newRequestId,
} from "../../src/tools/types.js";
import {
	allowAll,
	allowReadOnly,
	riskOf,
	tieredApprover,
} from "../../src/approvals/policy.js";

describe("config", () => {
	test("defaults target hosted cloud with the full grant", () => {
		const config = loadConfig({});
		expect(config.baseUrl).toBe("https://repohop.app");
		expect(config.mcpPath).toBe("/api/mcp");
		expect(config.scopes).toEqual([...REPOHOP_SCOPES]);
		expect(config.scopes).toContain("offline_access");
	});
	test("trims trailing slashes and honors overrides", () => {
		const config = loadConfig({
			REPOHOP_URL: "http://localhost:3000/",
			REPOHOP_SCOPES: "projects:read",
		});
		expect(config.baseUrl).toBe("http://localhost:3000");
		expect(config.scopes).toEqual(["projects:read"]);
	});
	test("honors REPOHOP_REDIRECT_URI override", () => {
		const config = loadConfig({
			REPOHOP_REDIRECT_URI: "https://agent.meta.ai/api/hatch/oauth/callback",
		});
		expect(config.redirectUri).toBe(
			"https://agent.meta.ai/api/hatch/oauth/callback",
		);
	});
});

describe("tool contract", () => {
	test("exactly the 23 project_* + manage_* tools, each with scopes, risk, budget", () => {
		expect(REPOHOP_TOOL_NAMES).toHaveLength(23);
		for (const name of REPOHOP_TOOL_NAMES) {
			expect(name.startsWith("project_") || name.startsWith("manage_")).toBe(
				true,
			);
			expect(REPOHOP_TOOL_SCOPES[name].length).toBeGreaterThan(0);
			expect(REPOHOP_REQUEST_BUDGETS[name]).toBeGreaterThan(0);
			expect(["read", "write", "execute", "publish", "manage"]).toContain(
				REPOHOP_TOOL_RISK[name],
			);
		}
		for (const name of REPOHOP_TOOL_NAMES) {
			if (name.startsWith("project_")) {
				expect(REPOHOP_TOOL_SCOPES[name][0]).toBe("projects:read");
			} else {
				expect(REPOHOP_TOOL_SCOPES[name][0]?.startsWith("manage:")).toBe(true);
			}
		}
	});
	test("execute implies write (unsandboxed local authority)", () => {
		for (const name of ["project_exec", "project_process"] as const) {
			expect(REPOHOP_TOOL_SCOPES[name]).toContain("projects:write");
			expect(REPOHOP_TOOL_SCOPES[name]).toContain("projects:exec");
			expect(REPOHOP_TOOL_RISK[name]).toBe("execute");
		}
	});
	test("management tools carry manage scopes and escalating risk", () => {
		expect(REPOHOP_TOOL_SCOPES.manage_devices_list).toEqual([
			"manage:devices:read",
		]);
		expect(REPOHOP_TOOL_SCOPES.manage_devices_remove).toEqual([
			"manage:devices:write",
		]);
		expect(REPOHOP_TOOL_SCOPES.manage_repositories_list).toEqual([
			"manage:repos:read",
		]);
		expect(REPOHOP_TOOL_SCOPES.manage_repositories_request).toEqual([
			"manage:repos:write",
		]);
		expect(REPOHOP_TOOL_SCOPES.manage_connections_list).toEqual([
			"manage:connections:read",
		]);
		expect(REPOHOP_TOOL_SCOPES.manage_connections_revoke).toEqual([
			"manage:connections:write",
		]);
		expect(REPOHOP_TOOL_SCOPES.manage_settings_read).toEqual([
			"manage:settings:read",
		]);
		for (const name of [
			"manage_devices_list",
			"manage_repositories_list",
			"manage_connections_list",
			"manage_settings_read",
		] as const) {
			expect(REPOHOP_TOOL_RISK[name]).toBe("read");
		}
		for (const name of [
			"manage_devices_remove",
			"manage_repositories_request",
			"manage_connections_revoke",
		] as const) {
			expect(REPOHOP_TOOL_RISK[name]).toBe("manage");
		}
	});
	test("gateway body ceiling is the binding transport limit", () => {
		expect(GATEWAY_BODY_LIMIT_BYTES).toBe(64 * 1024);
	});
	test("request ids are unique", () => {
		expect(newRequestId()).not.toBe(newRequestId());
	});
});

describe("error taxonomy", () => {
	test("tool error detail parses and maps", () => {
		expect(getToolErrorDetail({ result: { error: { code: "X" } } })).toBeNull();
		const detail = getToolErrorDetail({ error: { code: "AMBIGUOUS_RESULT" } });
		expect(detail?.code).toBe("AMBIGUOUS_RESULT");
		expect(codeForToolError({ code: "AMBIGUOUS_RESULT" })).toBe(
			"AMBIGUOUS_RESULT",
		);
		expect(codeForToolError({ code: "FORBIDDEN" })).toBe("FORBIDDEN_SCOPE");
		expect(codeForToolError({ code: "TIMEOUT" })).toBe("TIMEOUT");
		expect(codeForToolError({ code: "whatever" })).toBe("TOOL_REJECTED");
	});
	test("RepoHopError carries code and retry hint", () => {
		const error = new RepoHopError("RATE_LIMITED", "slow down", {
			retryAfterSec: 60,
		});
		expect(error.code).toBe("RATE_LIMITED");
		expect(error.retryAfterSec).toBe(60);
	});
});

describe("approval policy", () => {
	test("read-only allows reads, denies the rest", async () => {
		expect(
			await allowReadOnly({ tool: "project_read", args: {}, risk: "read" }),
		).toBe(true);
		expect(
			await allowReadOnly({ tool: "project_write", args: {}, risk: "write" }),
		).toBe(false);
		expect(
			await allowReadOnly({ tool: "project_exec", args: {}, risk: "execute" }),
		).toBe(false);
		expect(
			await allowAll({ tool: "project_push", args: {}, risk: "publish" }),
		).toBe(true);
	});
	test("tiered approver escalates exec/publish", async () => {
		const policy = tieredApprover(async () => false);
		expect(
			await policy({
				tool: "project_read",
				args: {},
				risk: riskOf("project_read"),
			}),
		).toBe(true);
		expect(
			await policy({
				tool: "project_write",
				args: {},
				risk: riskOf("project_write"),
			}),
		).toBe(true);
		expect(
			await policy({
				tool: "project_exec",
				args: {},
				risk: riskOf("project_exec"),
			}),
		).toBe(false);
	});
	test("tiered approver escalates account-management mutations, not reads", async () => {
		const policy = tieredApprover(async () => false);
		expect(
			await policy({
				tool: "manage_devices_list",
				args: {},
				risk: riskOf("manage_devices_list"),
			}),
		).toBe(true);
		for (const tool of [
			"manage_devices_remove",
			"manage_repositories_request",
			"manage_connections_revoke",
		] as const) {
			expect(await policy({ tool, args: {}, risk: riskOf(tool) })).toBe(false);
		}
		expect(
			await allowReadOnly({
				tool: "manage_settings_read",
				args: {},
				risk: riskOf("manage_settings_read"),
			}),
		).toBe(true);
		expect(
			await allowReadOnly({
				tool: "manage_devices_remove",
				args: {},
				risk: riskOf("manage_devices_remove"),
			}),
		).toBe(false);
	});
});
