import {
	Client,
	StreamableHTTPClientTransport,
	UnauthorizedError,
	type CallToolResult,
} from "@modelcontextprotocol/client";
import type { RepoHopConfig } from "../config.js";
import { mcpUrl } from "../config.js";
import { RepoHopError } from "../errors.js";
import { RepoHopOAuthProvider } from "../auth/provider.js";

export interface ConnectedClient {
	client: Client;
	transport: StreamableHTTPClientTransport;
	serverInfo: { name: string; version: string };
	close(): Promise<void>;
}

/**
 * Connect to the RepoHop MCP endpoint (stateless Streamable HTTP, JSON).
 *
 * Transport notes the template depends on:
 * - Node fetch sends no Origin header; keep it that way. The server rejects
 *   cross-origin POSTs with 403, so never add one (browser runtimes do).
 * - The server answers 429 with Retry-After: 60 on user/client/IP budgets.
 *   Retry-After is honored in callTool below, not here.
 * - Timeouts bound transport only. A timed-out mutating call is an
 *   AMBIGUOUS_RESULT: reconcile before retrying (see tools/client.ts).
 */
export async function connectRepoHop(
	config: RepoHopConfig,
	options: { provider?: RepoHopOAuthProvider } = {},
): Promise<ConnectedClient> {
	const provider =
		options.provider ??
		new RepoHopOAuthProvider({
			tokenPath: config.tokenPath,
			callbackPort: config.callbackPort,
			scopes: config.scopes,
			redirectUri: config.redirectUri,
		});
	if (!provider.hasTokens()) {
		throw new RepoHopError(
			"NOT_AUTHENTICATED",
			"No OAuth tokens found. Run `repohop-mcp login` first.",
		);
	}
	const transport = new StreamableHTTPClientTransport(new URL(mcpUrl(config)), {
		authProvider: provider,
	});
	const client = new Client(
		{ name: "repohop-mcp-client", version: "0.1.0" },
		{ capabilities: {} },
	);
	try {
		await client.connect(transport);
	} catch (error) {
		if (error instanceof UnauthorizedError) {
			throw new RepoHopError(
				"NOT_AUTHENTICATED",
				"Server rejected credentials (401). Tokens may be revoked — run `repohop-mcp login` again.",
			);
		}
		throw toRepoHopTransportError(error);
	}
	const serverInfo = client.getServerVersion() ?? {
		name: "unknown",
		version: "unknown",
	};
	return {
		client,
		transport,
		serverInfo: { name: serverInfo.name, version: serverInfo.version },
		close: () => client.close(),
	};
}

export function toRepoHopTransportError(error: unknown): RepoHopError {
	if (error instanceof RepoHopError) return error;
	if (error instanceof UnauthorizedError) {
		return new RepoHopError(
			"NOT_AUTHENTICATED",
			"Server rejected credentials (401). Run `repohop-mcp login` again.",
		);
	}
	const message = error instanceof Error ? error.message : String(error);
	if (/429|too many requests|rate/i.test(message)) {
		return new RepoHopError("RATE_LIMITED", `Rate limited: ${message}`, {
			retryAfterSec: 60,
		});
	}
	if (/413|too large/i.test(message)) {
		return new RepoHopError(
			"REQUEST_TOO_LARGE",
			`Request too large: ${message}`,
		);
	}
	return new RepoHopError("TRANSPORT", `Transport failure: ${message}`);
}

export function readRetryAfter(error: unknown): number {
	if (
		error instanceof RepoHopError &&
		typeof error.retryAfterSec === "number"
	) {
		return error.retryAfterSec;
	}
	return 60;
}

export type { CallToolResult };
