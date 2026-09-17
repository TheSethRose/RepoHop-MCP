import type { RepoHopConfig } from "../config.js";
import { RepoHopError } from "../errors.js";
import { connectRepoHop } from "../transport/client.js";
import { RepoHopClient } from "../tools/client.js";
import type { Approver } from "../approvals/policy.js";
import { allowReadOnly, riskOf } from "../approvals/policy.js";
import type { RepoHopToolName } from "../tools/types.js";

export interface BotContext {
	config: RepoHopConfig;
	client: RepoHopClient;
	approve: Approver;
	call<T>(tool: RepoHopToolName, args: Record<string, unknown>): Promise<T>;
	close(): Promise<void>;
}

export interface BotOptions {
	approve?: Approver;
	onLog?: (message: string) => void;
}

/**
 * Template bot lifecycle: connect → verify tools → hand control to `goal`.
 * Every tool call passes through the approver; reads run free under the
 * default read-only policy, mutations ask.
 */
export async function withBot<T>(
	config: RepoHopConfig,
	goal: (ctx: BotContext) => Promise<T>,
	options: BotOptions = {},
): Promise<T> {
	const approve = options.approve ?? allowReadOnly;
	const log = options.onLog ?? (() => {});
	const connected = await connectRepoHop(config);
	const client = new RepoHopClient(connected.client, config);
	const close = () => connected.close();
	const call = async <R>(
		tool: RepoHopToolName,
		args: Record<string, unknown>,
	): Promise<R> => {
		const allowed = await approve({ tool, args, risk: riskOf(tool) });
		if (!allowed) {
			throw new RepoHopError("TOOL_REJECTED", `Operator declined ${tool}.`);
		}
		log(`call ${tool}`);
		return client.call<R>(tool, args);
	};
	try {
		const tools = await client.tools();
		log(`connected: ${tools.length} tools granted`);
		return await goal({ config, client, approve, call, close });
	} finally {
		await close();
	}
}
