import type { Client } from "@modelcontextprotocol/client";
import type { RepoHopConfig } from "../config.js";
import {
	RepoHopError,
	codeForToolError,
	getToolErrorDetail,
} from "../errors.js";
import { readRetryAfter } from "../transport/client.js";
import {
	GATEWAY_BODY_LIMIT_BYTES,
	REPOHOP_REQUEST_BUDGETS,
	REPOHOP_TOOL_NAMES,
	REPOHOP_TOOL_RISK,
	REPOHOP_TOOL_SCOPES,
	type CatalogProject,
	type CommitArgs,
	type DeleteArgs,
	type DiffArgs,
	type ExecArgs,
	type PatchArgs,
	type PatchManyArgs,
	type ProcessArgs,
	type PushArgs,
	type ReadArgs,
	type ReadManyArgs,
	type RepoHopToolName,
	type SearchArgs,
	type WriteArgs,
} from "./types.js";

export interface GrantedTool {
	name: string;
	description?: string | undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * High-level RepoHop client: catalog-first routing, client-side budget
 * guards, structured {result}/{result.error} handling, and honest timeout
 * semantics. Construct via connectRepoHop() + listTools(), or new directly
 * in tests with a stub transport client.
 */
export class RepoHopClient {
	private granted = new Set<string>();

	constructor(
		private readonly client: Pick<Client, "callTool" | "listTools">,
		private readonly config: RepoHopConfig,
	) {}

	/** Tools this grant actually exposes. Call first; route only by alias. */
	async tools(): Promise<GrantedTool[]> {
		const { tools } = await this.client.listTools();
		this.granted = new Set(tools.map((tool) => tool.name));
		return tools.map((tool) => ({ name: tool.name, description: tool.description }));
	}

	requireTool(name: RepoHopToolName): void {
		if (this.granted.size > 0 && !this.granted.has(name)) {
			const scopes = REPOHOP_TOOL_SCOPES[name].join(" ");
			throw new RepoHopError(
				"FORBIDDEN_SCOPE",
				`Tool ${name} is not in this grant (needs scopes: ${scopes}). Re-authorize with broader scopes or pick a granted tool.`,
			);
		}
	}

	/** Byte size guard: fail fast before the gateway 413s the request. */
	assertBudget(name: RepoHopToolName, args: unknown): void {
		const bytes = Buffer.byteLength(JSON.stringify(args), "utf8");
	 const protocolBudget = REPOHOP_REQUEST_BUDGETS[name];
		if (bytes > protocolBudget) {
			throw new RepoHopError(
				"REQUEST_TOO_LARGE",
				`${name} payload is ${bytes} bytes (budget ${protocolBudget}). Chunk, page, or narrow the call.`,
			);
		}
		if (bytes > GATEWAY_BODY_LIMIT_BYTES) {
			throw new RepoHopError(
				"REQUEST_TOO_LARGE",
				`${name} payload is ${bytes} bytes but the HTTP gateway caps bodies at ${GATEWAY_BODY_LIMIT_BYTES}. Split into smaller calls.`,
			);
		}
	}

	/**
	 * Call a tool and unwrap {result}. Tool-level failures arrive as data
	 * ({result:{error}}) and throw RepoHopError with a stable code. Honors
	 * 429 Retry-After once, then surfaces RATE_LIMITED.
	 *
	 * Timeout rule: a timed-out or failed TRANSPORT on a mutating call is
	 * AMBIGUOUS_RESULT — the operation may have completed locally. Reconcile
	 * (read back state) before retrying; never blindly resend.
	 */
	async call<T = unknown>(name: RepoHopToolName, args: Record<string, unknown>): Promise<T> {
		this.requireTool(name);
		this.assertBudget(name, args);
		let result: Awaited<ReturnType<Client["callTool"]>>;
		try {
			result = await this.client.callTool(
				{ name, arguments: args },
				{ timeout: this.config.requestTimeoutMs },
			);
		} catch (error) {
			throw this.mapTransportError(name, error);
		}
		const structured = (result.structuredContent ?? null) as { result?: unknown } | null;
	 const payload = structured !== null && "result" in structured ? structured.result : null;
		if (result.isError || payload === null) {
			const detail = getToolErrorDetail(payload ?? undefined) ?? {
				message: textContent(result),
			};
			throw new RepoHopError(
				codeForToolError(detail),
				`${name} rejected: ${String(detail.message ?? detail.code ?? "unknown")}`,
				{ detail },
			);
		}
		return payload as T;
	}

	private mapTransportError(name: RepoHopToolName, error: unknown): RepoHopError {
		if (error instanceof RepoHopError) return error;
		const message = error instanceof Error ? error.message : String(error);
	 const mutating = REPOHOP_TOOL_RISK[name] !== "read";
		if (/429|rate|too many/i.test(message)) {
			return new RepoHopError("RATE_LIMITED", `${name} rate limited: ${message}`, {
				retryAfterSec: readRetryAfter(error),
			});
		}
		if (/abort|timeout|timed out/i.test(message)) {
			if (mutating) {
				return new RepoHopError(
					"AMBIGUOUS_RESULT",
					`${name} transport timed out — the operation may have completed. Reconcile before retrying.`,
				);
			}
			return new RepoHopError("TIMEOUT", `${name} timed out: ${message}`);
		}
		return new RepoHopError("TRANSPORT", `${name} transport failure: ${message}`);
	}

	/** Call with one automatic retry honoring Retry-After. Reads only. */
	async callWithRetry<T>(name: RepoHopToolName, args: Record<string, unknown>): Promise<T> {
		try {
			return await this.call<T>(name, args);
		} catch (error) {
			if (
				error instanceof RepoHopError &&
				error.code === "RATE_LIMITED" &&
				REPOHOP_TOOL_RISK[name] === "read"
			) {
				await sleep((error.retryAfterSec ?? 60) * 1000);
				return this.call<T>(name, args);
			}
			throw error;
		}
	}

	// Catalog-first routing: resolve the alias before touching anything else.
	async catalog(): Promise<CatalogProject[]> {
		return this.callWithRetry<CatalogProject[]>("project_catalog", {});
	}

	async resolveProject(alias: string): Promise<CatalogProject> {
		const projects = await this.catalog();
		const match = projects.find((project) => project.alias === alias);
		if (!match) {
			const known = projects.map((project) => project.alias).join(", ") || "(none)";
			throw new RepoHopError(
				"TOOL_REJECTED",
				`Unknown project alias "${alias}". Granted: ${known}. Never substitute another project.`,
			);
		}
		if (!match.ready) {
			throw new RepoHopError(
				"TOOL_REJECTED",
				`Project "${alias}" is not ready (not acknowledged locally). Ask the user to approve it first.`,
			);
		}
		return match;
	}

	async read(args: ReadArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.callWithRetry("project_read", args as unknown as Record<string, unknown>);
	}

	async readMany(args: ReadManyArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.callWithRetry("project_read_many", args as unknown as Record<string, unknown>);
	}

	async search(args: SearchArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.callWithRetry("project_search", args as unknown as Record<string, unknown>);
	}

	async diff(args: DiffArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.callWithRetry("project_diff", args as unknown as Record<string, unknown>);
	}

	async status(project: string, fetch = false): Promise<unknown> {
		await this.resolveProject(project);
		return this.callWithRetry("project_status", { project, fetch });
	}

	async snapshot(project: string, includeDiff = false): Promise<unknown> {
		await this.resolveProject(project);
		return this.callWithRetry("project_snapshot", { project, includeDiff });
	}

	async list(project: string, path = "."): Promise<unknown> {
		await this.resolveProject(project);
		return this.callWithRetry("project_list", { project, path });
	}

	async write(args: WriteArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_write", args as unknown as Record<string, unknown>);
	}

	async patch(args: PatchArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_patch", args as unknown as Record<string, unknown>);
	}

	async patchMany(args: PatchManyArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_patch_many", args as unknown as Record<string, unknown>);
	}

	async delete(args: DeleteArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_delete", args as unknown as Record<string, unknown>);
	}

	async exec(args: ExecArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_exec", args as unknown as Record<string, unknown>);
	}

	async process(args: ProcessArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_process", args as unknown as Record<string, unknown>);
	}

	async commit(args: CommitArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_commit", args as unknown as Record<string, unknown>);
	}

	async push(args: PushArgs): Promise<unknown> {
		await this.resolveProject(args.project);
		return this.call("project_push", args as unknown as Record<string, unknown>);
	}
}

function textContent(result: { content?: Array<{ type?: string; text?: string }> }): string {
	const first = result.content?.[0];
	if (first?.type === "text" && typeof first.text === "string") return first.text;
	return "unknown tool failure";
}

export { REPOHOP_TOOL_NAMES, REPOHOP_TOOL_RISK, REPOHOP_TOOL_SCOPES };
