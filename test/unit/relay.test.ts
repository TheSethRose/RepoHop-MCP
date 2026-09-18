import { describe, expect, test } from "bun:test";
import { createRelaySession, pollForCode } from "../../src/auth/relay.js";

describe("relay auth client", () => {
	test("createRelaySession sends state and returns session", async () => {
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/oauth/session" && req.method === "POST") {
					return Response.json({
						sessionId: "sess-12345",
						secret: "secret-abcde",
						callbackUrl: "https://relay.test/oauth/cb/sess-12345",
						expiresAt: new Date(Date.now() + 600_000).toISOString(),
					});
				}
				return new Response("Not found", { status: 404 });
			},
		});

		try {
			const session = await createRelaySession(
				`http://127.0.0.1:${server.port}`,
				"my-state-12345",
			);
			expect(session.sessionId).toBe("sess-12345");
			expect(session.secret).toBe("secret-abcde");
			expect(session.callbackUrl).toBe(
				"https://relay.test/oauth/cb/sess-12345",
			);
		} finally {
			server.stop(true);
		}
	});

	test("createRelaySession handles unreachable relay", async () => {
		expect(
			createRelaySession("http://127.0.0.1:54321", "my-state-12345"),
		).rejects.toThrow(/Failed to reach the RepoHop relay/);
	});

	test("pollForCode polls until code is ready", async () => {
		let pollCount = 0;
		const server = Bun.serve({
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/oauth/session/sess-12345") {
					const authHeader = req.headers.get("authorization");
					if (authHeader !== "Bearer secret-abcde") {
						return Response.json({ error: "Unauthorized" }, { status: 401 });
					}
					pollCount += 1;
					if (pollCount < 2) {
						return Response.json({ status: "pending" });
					}
					return Response.json({
						status: "code",
						code: "auth-code-999",
						iss: "https://repohop.app",
					});
				}
				return new Response("Not found", { status: 404 });
			},
		});

		try {
			const result = await pollForCode(
				`http://127.0.0.1:${server.port}`,
				"sess-12345",
				"secret-abcde",
				{ intervalMs: 20, timeoutMs: 1000 },
			);
			expect(result.code).toBe("auth-code-999");
			expect(result.iss).toBe("https://repohop.app");
			expect(pollCount).toBe(2);
		} finally {
			server.stop(true);
		}
	});

	test("pollForCode throws when authorization is denied", async () => {
		const server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({
					status: "error",
					error: "access_denied",
					errorDescription: "The operator denied access.",
				});
			},
		});

		try {
			expect(
				pollForCode(
					`http://127.0.0.1:${server.port}`,
					"sess-12345",
					"secret-abcde",
					{ intervalMs: 20, timeoutMs: 1000 },
				),
			).rejects.toThrow(/The operator denied access/);
		} finally {
			server.stop(true);
		}
	});

	test("pollForCode handles 401 unauthorized", async () => {
		const server = Bun.serve({
			port: 0,
			fetch() {
				return Response.json({ error: "Unauthorized" }, { status: 401 });
			},
		});

		try {
			expect(
				pollForCode(
					`http://127.0.0.1:${server.port}`,
					"sess-12345",
					"wrong-secret",
					{ intervalMs: 20, timeoutMs: 1000 },
				),
			).rejects.toThrow(/secret was rejected/);
		} finally {
			server.stop(true);
		}
	});
});
