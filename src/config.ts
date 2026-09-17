/**
 * Environment-driven configuration. Every value has a safe default for the
 * hosted RepoHop Cloud; point REPOHOP_URL at a local checkout for development.
 *
 * Required for first connect: nothing — `repohop-mcp login` walks OAuth.
 * Required headless: a refresh-bearing token file from a prior login.
 */

export interface RepoHopConfig {
	/** Cloud origin, e.g. https://repohop.app or http://localhost:3000. */
	baseUrl: string;
	/** MCP endpoint path. Do not change unless the server documents it. */
	mcpPath: string;
	/** OAuth scopes to request. Defaults to the full RepoHop grant. */
	scopes: string[];
	/** Where OAuth client info + tokens live (0600 file). */
	tokenPath: string;
	/** Per-request timeout in ms. Applies to transport, not server execution. */
	requestTimeoutMs: number;
	/** Port for the loopback OAuth callback listener during login. */
	callbackPort: number;
	/** Optional OAuth redirect URI override (defaults to loopback). */
	redirectUri?: string | undefined;
}

export const REPOHOP_SCOPES = [
	"projects:read",
	"projects:write",
	"projects:exec",
	"projects:publish",
	"offline_access",
] as const;

function defaultTokenPath(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
	return `${home}/.repohop-mcp/tokens.json`;
}

export function loadConfig(
	env: NodeJS.ProcessEnv = process.env,
): RepoHopConfig {
	const baseUrl = (env.REPOHOP_URL ?? "https://repohop.app").replace(
		/\/+$/,
		"",
	);
	const scopes = (env.REPOHOP_SCOPES ?? [...REPOHOP_SCOPES].join(" "))
		.split(/[\s,]+/)
		.map((scope) => scope.trim())
		.filter(Boolean);
	return {
		baseUrl,
		mcpPath: env.REPOHOP_MCP_PATH ?? "/api/mcp",
		scopes: scopes.length > 0 ? scopes : [...REPOHOP_SCOPES],
		tokenPath: env.REPOHOP_TOKEN_PATH ?? defaultTokenPath(),
		requestTimeoutMs: Number(env.REPOHOP_REQUEST_TIMEOUT_MS ?? 120_000),
		callbackPort: Number(env.REPOHOP_CALLBACK_PORT ?? 12719),
		redirectUri: env.REPOHOP_REDIRECT_URI,
	};
}

export function mcpUrl(config: RepoHopConfig): string {
	return `${config.baseUrl}${config.mcpPath}`;
}
