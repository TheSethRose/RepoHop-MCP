import readline from "node:readline";
import type { RepoHopToolName } from "../tools/types.js";
import { REPOHOP_TOOL_RISK } from "../tools/types.js";

export interface ApprovalRequest {
	tool: RepoHopToolName;
	args: Record<string, unknown>;
	risk: ReturnType<typeof riskOf>;
}

/** Decides whether a proposed tool call may execute. */
export type Approver = (request: ApprovalRequest) => Promise<boolean> | boolean;

export function riskOf(tool: RepoHopToolName) {
	return REPOHOP_TOOL_RISK[tool];
}

/** Reads execute without asking. Everything else needs explicit approval. */
export const allowReadOnly: Approver = ({ risk }) => risk === "read";

/** Approve everything. Only for fully autonomous, fully trusted setups. */
export const allowAll: Approver = () => true;

/** Ask on the terminal. Default for interactive bots. */
export function promptApprover(): Approver {
	return async ({ tool, args, risk }) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			const preview = JSON.stringify(args).slice(0, 500);
			const answer = await new Promise<string>((resolve) => {
				rl.question(`Approve ${tool} [${risk}] ${preview} ? (y/N) `, resolve);
			});
			return answer.trim().toLowerCase() === "y";
		} catch {
			return false;
		} finally {
			rl.close();
		}
	};
}

/** Approve reads + writes, escalate exec/publish/manage to a second approver. */
export function tieredApprover(escalate: Approver): Approver {
	return async (request) => {
		if (request.risk === "read" || request.risk === "write") return true;
		return escalate(request);
	};
}
