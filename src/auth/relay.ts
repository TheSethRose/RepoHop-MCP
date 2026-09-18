import { RepoHopError } from "../errors.js";

export interface RelaySession {
	sessionId: string;
	secret: string;
	callbackUrl: string;
	expiresAt: string;
}

export interface PollResult {
	code: string;
	iss?: string | undefined;
}

/**
 * Register an ephemeral OAuth callback session on the RepoHop relay.
 * The returned callbackUrl is used as the OAuth redirect_uri.
 */
export async function createRelaySession(
	relayUrl: string,
	state: string,
	ttlSeconds = 600,
): Promise<RelaySession> {
	const normalizedUrl = relayUrl.replace(/\/+$/, "");
	let res: Response;
	try {
		res = await fetch(`${normalizedUrl}/oauth/session`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify({ state, ttlSeconds }),
		});
	} catch (error) {
		throw new RepoHopError(
			"TRANSPORT",
			`Failed to reach the RepoHop relay at ${normalizedUrl}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	if (!res.ok) {
		const raw = await res.text().catch(() => "");
		let message = `Relay responded with status ${res.status}`;
		try {
			const parsed = JSON.parse(raw) as { error?: string };
			if (parsed.error) message = parsed.error;
		} catch (_) {}
		throw new RepoHopError("AUTH_REJECTED", message);
	}

	const data = (await res.json()) as RelaySession;
	if (!data.sessionId || !data.secret || !data.callbackUrl) {
		throw new RepoHopError(
			"AUTH_REJECTED",
			"Relay returned an invalid session response.",
		);
	}
	return data;
}

/**
 * Poll the relay until the user approves in their browser and the callback lands.
 * Once read, the code is burned by the relay.
 */
export async function pollForCode(
	relayUrl: string,
	sessionId: string,
	secret: string,
	options: {
		intervalMs?: number;
		timeoutMs?: number;
		signal?: AbortSignal;
	} = {},
): Promise<PollResult> {
	const normalizedUrl = relayUrl.replace(/\/+$/, "");
	const intervalMs = options.intervalMs ?? 2000;
	const timeoutMs = options.timeoutMs ?? 600_000; // 10 minutes
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (options.signal?.aborted) {
			throw new RepoHopError("TIMEOUT", "Login cancelled.");
		}

		let res: Response;
		try {
			res = await fetch(`${normalizedUrl}/oauth/session/${sessionId}`, {
				method: "GET",
				headers: {
					authorization: `Bearer ${secret}`,
					accept: "application/json",
				},
				...(options.signal ? { signal: options.signal } : {}),
			});
		} catch (error) {
			if (options.signal?.aborted) {
				throw new RepoHopError("TIMEOUT", "Login cancelled.");
			}
			throw new RepoHopError(
				"TRANSPORT",
				`Network error polling relay: ${error instanceof Error ? error.message : String(error)}`,
			);
		}

		if (res.status === 401) {
			throw new RepoHopError(
				"AUTH_REJECTED",
				"Relay authorization secret was rejected.",
			);
		}

		if (res.status === 404 || res.status === 410) {
			throw new RepoHopError(
				"TIMEOUT",
				"Relay authorization session has expired or was already retrieved.",
			);
		}

		if (res.ok) {
			const body = (await res.json()) as
				| { status: "pending" }
				| { status: "code"; code: string; iss?: string }
				| { status: "error"; error: string; errorDescription?: string };

			if (body.status === "code" && body.code) {
				return { code: body.code, iss: body.iss };
			}

			if (body.status === "error") {
				throw new RepoHopError(
					"AUTH_REJECTED",
					body.errorDescription || body.error || "Authorization was denied.",
				);
			}
		}

		// Wait before next poll
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new RepoHopError(
		"TIMEOUT",
		"Timed out waiting for browser authorization approval on the relay.",
	);
}
