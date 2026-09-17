/**
 * RepoHop tool contract, mirrored from the server's canonical definitions
 * (repohop-protocol + packages/api/mcp/repohop.ts). If the server adds a
 * tool, the compat suite's tools/list check fails loudly — update here.
 */

export const REPOHOP_TOOL_NAMES = [
	"project_catalog",
	"project_status",
	"project_snapshot",
	"project_list",
	"project_read",
	"project_read_many",
	"project_search",
	"project_write",
	"project_patch",
	"project_patch_many",
	"project_delete",
	"project_exec",
	"project_process",
	"project_diff",
	"project_commit",
	"project_push",
] as const;

export type RepoHopToolName = (typeof REPOHOP_TOOL_NAMES)[number];

/** OAuth scopes each tool requires. Request the union your bot needs. */
export const REPOHOP_TOOL_SCOPES: Record<RepoHopToolName, readonly string[]> = {
	project_catalog: ["projects:read"],
	project_status: ["projects:read"],
	project_snapshot: ["projects:read"],
	project_list: ["projects:read"],
	project_read: ["projects:read"],
	project_read_many: ["projects:read"],
	project_search: ["projects:read"],
	project_diff: ["projects:read"],
	project_write: ["projects:read", "projects:write"],
	project_patch: ["projects:read", "projects:write"],
	project_patch_many: ["projects:read", "projects:write"],
	project_delete: ["projects:read", "projects:write"],
	project_exec: ["projects:read", "projects:write", "projects:exec"],
	project_process: ["projects:read", "projects:write", "projects:exec"],
	project_commit: ["projects:read", "projects:write", "projects:publish"],
	project_push: ["projects:read", "projects:write", "projects:publish"],
};

export type ToolRisk = "read" | "write" | "execute" | "publish";

/**
 * Execute implies Write: arbitrary local commands run as the device OS user
 * and can read secrets, modify files, and reach the network. Never present
 * exec as sandboxed. Publish moves reviewed commits to remotes.
 */
export const REPOHOP_TOOL_RISK: Record<RepoHopToolName, ToolRisk> = {
	project_catalog: "read",
	project_status: "read",
	project_snapshot: "read",
	project_list: "read",
	project_read: "read",
	project_read_many: "read",
	project_search: "read",
	project_diff: "read",
	project_write: "write",
	project_patch: "write",
	project_patch_many: "write",
	project_delete: "write",
	project_exec: "execute",
	project_process: "execute",
	project_commit: "publish",
	project_push: "publish",
};

/**
 * Client-side request budgets (bytes of JSON). Mirrors the server protocol
 * budgets; the HTTP transport additionally caps bodies at 64 KiB, so large
 * writes must be chunked client-side before sending.
 */
export const KiB = 1024;
export const MiB = 1024 * KiB;

export const REPOHOP_REQUEST_BUDGETS: Record<RepoHopToolName, number> = {
	project_catalog: 16 * KiB,
	project_status: 64 * KiB,
	project_snapshot: 64 * KiB,
	project_list: 64 * KiB,
	project_read: 64 * KiB,
	project_read_many: 256 * KiB,
	project_search: 128 * KiB,
	project_diff: 64 * KiB,
	project_write: 10 * MiB,
	project_patch: 12 * MiB,
	project_patch_many: 16 * MiB,
	project_delete: 64 * KiB,
	project_exec: 8 * MiB,
	project_process: 512 * KiB,
	project_commit: 128 * KiB,
	project_push: 64 * KiB,
};

/** Hard HTTP body ceiling enforced by the server gateway. */
export const GATEWAY_BODY_LIMIT_BYTES = 64 * KiB;

export interface PageArgs {
	offset?: number;
	limit?: number;
}

export interface CatalogProject {
	alias: string;
	ready: boolean;
	cloudPolicy?: unknown;
	local?: unknown;
}

export interface ProjectArgs {
	project: string;
}

export interface ReadArgs extends ProjectArgs {
	path: string;
	offset?: number;
	limit?: number;
}

export interface ReadManyArgs extends ProjectArgs {
	paths: string[];
}

export interface SearchArgs extends ProjectArgs {
	query: string;
	path?: string;
	offset?: number;
	limit?: number;
}

export interface WriteArgs extends ProjectArgs {
	path: string;
	content: string;
	expectedSha256?: string;
	requestId: string;
}

export interface Replacement {
	old: string;
	new: string;
	expectedOccurrences?: number;
}

export interface PatchArgs extends ProjectArgs {
	path: string;
	expectedSha256: string;
	replacements: Replacement[];
	requestId: string;
}

export interface PatchManyEntry {
	path: string;
	expectedSha256: string;
	replacements: Replacement[];
}

export interface PatchManyArgs extends ProjectArgs {
	entries: PatchManyEntry[];
	requestId: string;
}

export interface DeleteArgs extends ProjectArgs {
	path: string;
	expectedSha256: string;
	requestId: string;
}

export interface ExecArgs extends ProjectArgs {
	requestId: string;
	command: string;
	args?: string[];
	timeoutMs?: number;
	background?: boolean;
}

export interface ProcessArgs extends ProjectArgs {
	requestId: string;
	sessionId: string;
	action: "poll" | "write" | "interrupt" | "terminate";
	input?: string;
	endStdin?: boolean;
}

export interface DiffArgs extends ProjectArgs {
	base?: string;
	offset?: number;
	limit?: number;
}

export interface CommitArgs extends ProjectArgs {
	requestId: string;
	expectedHead: string;
	expectedPatchSha256: string;
	message: string;
}

export interface PushArgs extends ProjectArgs {
	requestId: string;
	expectedCommit: string;
}

export type ToolArgs =
	| Record<string, never>
	| ProjectArgs
	| ReadArgs
	| ReadManyArgs
	| SearchArgs
	| WriteArgs
	| PatchArgs
	| PatchManyArgs
	| DeleteArgs
	| ExecArgs
	| ProcessArgs
	| DiffArgs
	| CommitArgs
	| PushArgs;

/** Caller-supplied idempotency/reconciliation key. Always set it on mutations. */
export function newRequestId(): string {
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
