import { describe, expect, test } from "bun:test";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { loadConfig, mcpUrl } from "../../src/config.js";
import { RepoHopClient } from "../../src/tools/client.js";
import {
	REPOHOP_TOOL_NAMES,
	type CatalogProject,
} from "../../src/tools/types.js";

/**
 * Live conformance against a real RepoHop server. Requires:
 *   REPOHOP_COMPAT_URL   e.g. http://localhost:3000
 *   REPOHOP_COMPAT_TOKEN a valid OAuth access token with projects:read
 * Without both, the suite passes vacuous (skip) — unit tests own the offline contract.
 */
const baseUrl = process.env.REPOHOP_COMPAT_URL;
const token = process.env.REPOHOP_COMPAT_TOKEN;
const LIVE = Boolean(baseUrl && token);

const live = LIVE ? test : test.skip;

function bearerTransport(url: string, accessToken: string) {
	return new StreamableHTTPClientTransport(new URL(url), {
		authProvider: { token: async () => accessToken },
	});
}

describe("live conformance", () => {
	live("initializes and advertises known tools only", async () => {
		const config = loadConfig({ REPOHOP_URL: baseUrl as string });
		const transport = bearerTransport(mcpUrl(config), token as string);
		const sdk = new Client(
			{ name: "repohop-compat", version: "0.1.0" },
			{ capabilities: {} },
		);
		await sdk.connect(transport);
		try {
			const client = new RepoHopClient(sdk, config);
			const tools = await client.tools();
			expect(tools.length).toBeGreaterThan(0);
			// Grants are scoped: a projects-only grant advertises project_*
			// tools, while a grant with manage:* scopes additionally
			// advertises the mirrored manage_* tools. Anything else is a
			// server/client contract drift.
			for (const tool of tools) {
				expect(
					tool.name.startsWith("project_") || tool.name.startsWith("manage_"),
				).toBe(true);
				expect(
					(REPOHOP_TOOL_NAMES as readonly string[]).includes(tool.name),
				).toBe(true);
			}
		} finally {
			await sdk.close();
		}
	});

	live("catalog resolves and a ready project reads", async () => {
		const config = loadConfig({ REPOHOP_URL: baseUrl as string });
		const transport = bearerTransport(mcpUrl(config), token as string);
		const sdk = new Client(
			{ name: "repohop-compat", version: "0.1.0" },
			{ capabilities: {} },
		);
		await sdk.connect(transport);
		try {
			const client = new RepoHopClient(sdk, config);
			await client.tools();
			const projects = await client.catalog();
			expect(Array.isArray(projects)).toBe(true);
			const ready = projects.find((project: CatalogProject) => project.ready);
			if (!ready) {
				console.log("compat note: no ready project; read step skipped");
				return;
			}
			const result = (await client.list(ready.alias, ".")) as unknown;
			expect(result).toBeDefined();
		} finally {
			await sdk.close();
		}
	});
});
