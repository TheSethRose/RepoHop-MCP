#!/usr/bin/env bun
/**
 * repohop-mcp CLI: login, status, catalog, call, logout.
 * Human bootstrap for the OAuth grant; bots use src/ programmatically.
 */
import { loadConfig, mcpUrl } from "./config.js";
import { login, logout } from "./auth/flow.js";
import { RepoHopOAuthProvider } from "./auth/provider.js";
import { connectRepoHop } from "./transport/client.js";
import { RepoHopClient } from "./tools/client.js";
import type { RepoHopToolName } from "./tools/types.js";
import { REPOHOP_TOOL_NAMES } from "./tools/types.js";

const config = loadConfig();

function usage(): never {
	console.log(`repohop-mcp — RepoHop MCP client

  login [--relay]       OAuth login (browser approve, loopback or relay callback)
  logout                Forget local tokens (revoke the grant in the dashboard)
  status                Show auth state + granted tools
  catalog               List granted projects (needs login)
  call <tool> <json>    Call one tool, e.g. call project_read '{"project":"x","path":"README.md"}'

env: REPOHOP_URL (default https://repohop.app), REPOHOP_RELAY_URL (default https://relay.repohop.app),
     REPOHOP_SCOPES, REPOHOP_TOKEN_PATH, REPOHOP_REQUEST_TIMEOUT_MS, REPOHOP_CALLBACK_PORT`);
	process.exit(2);
}

function isToolName(value: string): value is RepoHopToolName {
	return (REPOHOP_TOOL_NAMES as readonly string[]).includes(value);
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	if (!command) usage();
	if (command === "login") {
		const useRelay =
			rest.includes("--relay") ||
			Boolean(
				process.env.REPOHOP_RELAY_URL && !process.env.REPOHOP_REDIRECT_URI,
			);
		const result = await login(config, {
			useRelay,
			onAuthorizationUrl: (url) => {
				console.log("\nOpen this URL to approve the connection:\n");
				console.log(url);
				if (useRelay) {
					console.log("\nWaiting for approval on relay (zero-paste)…");
				} else {
					console.log("\nWaiting for the browser callback…");
				}
			},
		});
		console.log(result.authorized ? "Authorized." : "Not authorized.");
		return;
	}
	if (command === "logout") {
		logout(config);
		console.log(
			"Local tokens forgotten. Revoke the grant in the dashboard to fully disconnect.",
		);
		return;
	}
	const provider = new RepoHopOAuthProvider({
		tokenPath: config.tokenPath,
		callbackPort: config.callbackPort,
		scopes: config.scopes,
		redirectUri: config.redirectUri,
	});
	if (command === "status") {
		console.log(`server: ${mcpUrl(config)}`);
		console.log(
			`tokens: ${provider.hasTokens() ? "present" : "missing (run login)"}`,
		);
		if (!provider.hasTokens()) return;
		const connected = await connectRepoHop(config, { provider });
		try {
			const client = new RepoHopClient(connected.client, config);
			const tools = await client.tools();
			console.log(
				`tools granted (${tools.length}): ${tools.map((t) => t.name).join(", ")}`,
			);
		} finally {
			await connected.close();
		}
		return;
	}
	if (command === "catalog") {
		const connected = await connectRepoHop(config, { provider });
		try {
			const client = new RepoHopClient(connected.client, config);
			console.log(JSON.stringify(await client.catalog(), null, 2));
		} finally {
			await connected.close();
		}
		return;
	}
	if (command === "call") {
		const [tool, json] = rest;
		if (!tool || !json || !isToolName(tool)) usage();
		const connected = await connectRepoHop(config, { provider });
		try {
			const client = new RepoHopClient(connected.client, config);
			const result = await client.call(
				tool,
				JSON.parse(json) as Record<string, unknown>,
			);
			console.log(JSON.stringify(result, null, 2));
		} finally {
			await connected.close();
		}
		return;
	}
	usage();
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
