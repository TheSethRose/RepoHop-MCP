/**
 * Stable client-side error taxonomy. Every failure a bot must branch on maps
 * to one of these codes — never match on message text.
 */

export type RepoHopErrorCode =
	| "NOT_AUTHENTICATED"
	| "AUTH_REJECTED"
	| "FORBIDDEN_SCOPE"
	| "RATE_LIMITED"
	| "REQUEST_TOO_LARGE"
	| "AMBIGUOUS_RESULT"
	| "TOOL_REJECTED"
	| "TRANSPORT"
	| "TIMEOUT";

export class RepoHopError extends Error {
	readonly code: RepoHopErrorCode;
	/** Seconds to wait before retrying. Set for RATE_LIMITED. */
	readonly retryAfterSec?: number | undefined;
	/** Raw server-side error detail ({ result: { error } }) when present. */
	readonly detail?: unknown;

	constructor(
		code: RepoHopErrorCode,
		message: string,
		options: { retryAfterSec?: number; detail?: unknown } = {},
	) {
		super(message);
		this.name = "RepoHopError";
		this.code = code;
		this.retryAfterSec = options.retryAfterSec;
		this.detail = options.detail;
	}
}

/** RepoHop tool failures arrive as data: { result: { error: {...} } }. */
export interface RepoHopToolErrorDetail {
	code?: string;
	message?: string;
	requestId?: string | null;
	retryable?: boolean;
	[key: string]: unknown;
}

export function getToolErrorDetail(result: unknown): RepoHopToolErrorDetail | null {
	if (typeof result !== "object" || result === null) return null;
	const error = (result as { error?: unknown }).error;
	if (typeof error !== "object" || error === null) return null;
	return error as RepoHopToolErrorDetail;
}

/**
 * Map a tool-failure detail to a client code. AMBIGUOUS_RESULT is load
 * bearing: the operation may have completed locally. Never blindly retry it —
 * reconcile first (read back the state you tried to change).
 */
export function codeForToolError(detail: RepoHopToolErrorDetail): RepoHopErrorCode {
	const code = String(detail.code ?? "").toUpperCase();
	if (code.includes("AMBIGUOUS")) return "AMBIGUOUS_RESULT";
	if (code.includes("FORBIDDEN") || code.includes("DENIED")) return "FORBIDDEN_SCOPE";
	if (code.includes("RATE") || code.includes("LIMIT")) return "RATE_LIMITED";
	if (code.includes("TOO_LARGE") || code.includes("PAYLOAD")) return "REQUEST_TOO_LARGE";
	return "TOOL_REJECTED";
}
