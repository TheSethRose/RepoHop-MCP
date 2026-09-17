import type {
	OAuthClientInformation,
	OAuthClientInformationFull,
	OAuthClientMetadata,
	OAuthClientProvider,
	StoredOAuthClientInformation,
	StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { FileTokenStore } from "./storage.js";

/**
 * OAuthClientProvider for RepoHop: public native client, PKCE S256,
 * loopback redirect, dynamic client registration. Persisted per issuer.
 */
export class RepoHopOAuthProvider implements OAuthClientProvider {
	readonly redirectUrl: string;
	private readonly store: FileTokenStore;
	private readonly clientName: string;
	private readonly scopes: string[];
	private pendingAuthorizationUrl: URL | undefined;

	constructor(options: {
		tokenPath: string;
		callbackPort: number;
		scopes: string[];
		clientName?: string | undefined;
		redirectUri?: string | undefined;
	}) {
		this.store = new FileTokenStore(options.tokenPath);
		this.redirectUrl =
			options.redirectUri ??
			`http://127.0.0.1:${options.callbackPort}/callback`;
		this.scopes = options.scopes;
		this.clientName = options.clientName ?? "RepoHop MCP Client";
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: this.clientName,
			redirect_uris: [this.redirectUrl],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			scope: this.scopes.join(" "),
			token_endpoint_auth_method: "none",
		};
	}

	clientInformation(ctx?: {
		issuer?: string;
	}): StoredOAuthClientInformation | undefined {
		return this.store.getClientInformation(ctx?.issuer);
	}

	saveClientInformation(
		info: StoredOAuthClientInformation,
		ctx?: { issuer?: string },
	): void {
		this.store.saveClientInformation(info, ctx?.issuer);
	}

	tokens(ctx?: { issuer?: string }): StoredOAuthTokens | undefined {
		return this.store.getTokens(ctx?.issuer);
	}

	saveTokens(tokens: StoredOAuthTokens, ctx?: { issuer?: string }): void {
		this.store.saveTokens(tokens, ctx?.issuer);
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		this.pendingAuthorizationUrl = authorizationUrl;
	}

	takeAuthorizationUrl(): URL | undefined {
		const url = this.pendingAuthorizationUrl;
		this.pendingAuthorizationUrl = undefined;
		return url;
	}

	saveCodeVerifier(codeVerifier: string): void {
		this.store.saveCodeVerifier(codeVerifier);
	}

	codeVerifier(): string {
		return this.store.getCodeVerifier();
	}

	invalidateCredentials(
		scope: "all" | "client" | "tokens" | "verifier" | "discovery" = "all",
	): void {
		if (scope === "all" || scope === "tokens" || scope === "client") {
			this.store.clear(scope === "all" ? "all" : scope);
		}
		if (scope === "all" || scope === "verifier") {
			this.store.clear("verifier");
		}
	}

	clearAll(): void {
		this.store.clear("all");
	}

	hasTokens(): boolean {
		return this.store.getTokens() !== undefined;
	}

	static staticClientInfo(
		info: OAuthClientInformation | OAuthClientInformationFull,
	): StoredOAuthClientInformation {
		return { ...info };
	}
}
