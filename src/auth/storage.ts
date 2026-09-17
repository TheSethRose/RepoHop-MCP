import fs from "node:fs";
import path from "node:path";
import type {
	StoredOAuthClientInformation,
	StoredOAuthTokens,
} from "@modelcontextprotocol/client";

/**
 * 0600 JSON token store. Holds OAuth client registration, tokens, and the
 * PKCE verifier, keyed by authorization-server issuer with a single-issuer
 * fallback. Tokens never leave this file except as an Authorization header.
 */

interface StoredState {
	clientInformation?: Record<string, StoredOAuthClientInformation>;
	tokens?: Record<string, StoredOAuthTokens>;
	codeVerifier?: string;
}

const FALLBACK_ISSUER = "__default__";

export class FileTokenStore {
	constructor(private readonly filePath: string) {}

	private read(): StoredState {
		try {
			const raw = fs.readFileSync(this.filePath, "utf8");
			const parsed: unknown = JSON.parse(raw);
			if (typeof parsed === "object" && parsed !== null) {
				return parsed as StoredState;
			}
			return {};
		} catch {
			return {};
		}
	}

	private write(state: StoredState): void {
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
		fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), {
			mode: 0o600,
		});
		try {
			fs.chmodSync(this.filePath, 0o600);
		} catch {
			// Best effort on filesystems without POSIX modes.
		}
	}

	private key(issuer?: string): string {
		return issuer ?? FALLBACK_ISSUER;
	}

	getClientInformation(issuer?: string): StoredOAuthClientInformation | undefined {
		return this.read().clientInformation?.[this.key(issuer)];
	}

	saveClientInformation(info: StoredOAuthClientInformation, issuer?: string): void {
		const state = this.read();
		state.clientInformation = {
			...(state.clientInformation ?? {}),
			[this.key(issuer)]: info,
		};
		this.write(state);
	}

	getTokens(issuer?: string): StoredOAuthTokens | undefined {
		const state = this.read();
		return (
			state.tokens?.[this.key(issuer)] ??
			// Single-issuer fallback: most-recently-saved set.
			(Object.values(state.tokens ?? {})[0] as StoredOAuthTokens | undefined)
		);
	}

	saveTokens(tokens: StoredOAuthTokens, issuer?: string): void {
		const state = this.read();
		state.tokens = {
			...(state.tokens ?? {}),
			[this.key(issuer)]: tokens,
		};
		this.write(state);
	}

	getCodeVerifier(): string {
		const verifier = this.read().codeVerifier;
		if (!verifier) throw new Error("No PKCE code verifier saved for this login attempt.");
		return verifier;
	}

	saveCodeVerifier(verifier: string): void {
		this.write({ ...this.read(), codeVerifier: verifier });
	}

	clear(scope: "all" | "tokens" | "client" | "verifier" = "all"): void {
		if (scope === "all") {
			try {
				fs.unlinkSync(this.filePath);
			} catch {
				// Already absent.
			}
			return;
		}
		const state = this.read();
		if (scope === "tokens") delete state.tokens;
		if (scope === "client") delete state.clientInformation;
		if (scope === "verifier") delete state.codeVerifier;
		this.write(state);
	}

	exists(): boolean {
		return fs.existsSync(this.filePath);
	}
}
