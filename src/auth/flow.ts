import http from "node:http";
import { auth } from "@modelcontextprotocol/client";
import type { RepoHopConfig } from "../config.js";
import { mcpUrl } from "../config.js";
import { RepoHopError } from "../errors.js";
import { RepoHopOAuthProvider } from "./provider.js";

export interface LoginResult {
	authorizationUrl: string | null;
	authorized: boolean;
}

function listenForCode(
	port: number,
	timeoutMs: number,
): Promise<{ code: string; iss?: string | undefined }> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			try {
				const url = new URL(req.url ?? "/", "http://127.0.0.1");
				if (url.pathname !== "/callback") {
					res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
					return;
				}
				const error = url.searchParams.get("error");
				if (error) {
					res
						.writeHead(400, { "content-type": "text/plain" })
						.end("Authorization failed. You can close this tab.");
					server.close();
					reject(new Error(`Authorization server error: ${error}`));
					return;
				}
				const code = url.searchParams.get("code");
				const iss = url.searchParams.get("iss") ?? undefined;
				if (!code) {
					res
						.writeHead(400, { "content-type": "text/plain" })
						.end("Missing code.");
					return;
				}
				res
					.writeHead(200, { "content-type": "text/plain" })
					.end(
						"RepoHop connected. You can close this tab and return to your terminal.",
					);
				server.close();
				resolve({ code, iss });
			} catch (error) {
				server.close();
				reject(error);
			}
		});
		server.on("error", reject);
		const timer = setTimeout(() => {
			server.close();
			reject(
				new Error("Timed out waiting for the browser authorization callback."),
			);
		}, timeoutMs);
		timer.unref?.();
		server.listen(port, "127.0.0.1");
	});
}

/**
 * Interactive login. Phase 1 runs discovery + dynamic registration and
 * yields the authorize URL; after the operator approves in the browser, the
 * loopback listener captures the code and phase 2 exchanges it for tokens.
 * Tokens (with offline_access refresh) persist in the 0600 token file.
 */
export async function login(
	config: RepoHopConfig,
	options: {
		timeoutMs?: number;
		onAuthorizationUrl?: (url: string) => void;
	} = {},
): Promise<LoginResult> {
	const provider = new RepoHopOAuthProvider({
		tokenPath: config.tokenPath,
		callbackPort: config.callbackPort,
		scopes: config.scopes,
		redirectUri: config.redirectUri,
	});
	const serverUrl = mcpUrl(config);
	const first = await auth(provider, {
		serverUrl,
		scope: config.scopes.join(" "),
	});
	if (first === "AUTHORIZED") {
		return { authorizationUrl: null, authorized: true };
	}
	const authorizationUrl = provider.takeAuthorizationUrl();
	if (!authorizationUrl) {
		throw new RepoHopError(
			"AUTH_REJECTED",
			"Authorization redirect was not produced. Check server reachability and try again.",
		);
	}
	options.onAuthorizationUrl?.(authorizationUrl.toString());
	const { code, iss } = await listenForCode(
		config.callbackPort,
		options.timeoutMs ?? 5 * 60_000,
	);
	const second = await auth(provider, {
		serverUrl,
		scope: config.scopes.join(" "),
		authorizationCode: code,
		...(iss === undefined ? {} : { iss }),
	});
	if (second !== "AUTHORIZED") {
		throw new RepoHopError(
			"AUTH_REJECTED",
			"Code exchange did not authorize. Re-run login.",
		);
	}
	return { authorizationUrl: authorizationUrl.toString(), authorized: true };
}

/** Forget local OAuth state. Does not revoke the server-side grant — revoke in the dashboard. */
export function logout(config: RepoHopConfig): void {
	new RepoHopOAuthProvider({
		tokenPath: config.tokenPath,
		callbackPort: config.callbackPort,
		scopes: config.scopes,
	}).clearAll();
}
