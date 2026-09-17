export { loadConfig, mcpUrl, REPOHOP_SCOPES, type RepoHopConfig } from "./config.js";
export { RepoHopError, codeForToolError, getToolErrorDetail, type RepoHopErrorCode } from "./errors.js";
export { FileTokenStore } from "./auth/storage.js";
export { RepoHopOAuthProvider } from "./auth/provider.js";
export { login, logout } from "./auth/flow.js";
export { connectRepoHop, toRepoHopTransportError, type ConnectedClient } from "./transport/client.js";
export { RepoHopClient } from "./tools/client.js";
export {
	REPOHOP_TOOL_NAMES,
	REPOHOP_TOOL_SCOPES,
	REPOHOP_TOOL_RISK,
	REPOHOP_REQUEST_BUDGETS,
	GATEWAY_BODY_LIMIT_BYTES,
	newRequestId,
	type RepoHopToolName,
	type CatalogProject,
	type ToolRisk,
} from "./tools/types.js";
export {
	allowAll,
	allowReadOnly,
	promptApprover,
	tieredApprover,
	riskOf,
	type Approver,
	type ApprovalRequest,
} from "./approvals/policy.js";
export { withBot, type BotContext, type BotOptions } from "./bot/index.js";
