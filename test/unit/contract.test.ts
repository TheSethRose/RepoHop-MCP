import { describe, expect, test } from "bun:test";
import { loadConfig, REPOHOP_SCOPES } from "../../src/config.js";
import {
	RepoHopError,
	codeForToolError,
	getToolErrorDetail,
} from "../../src/errors.js";
import {
	GATEWAY_BODY_LIMIT_BYTES,
	REPOHOP_REQUEST_BUDGETS,
	REPOHOP_TOOL_NAMES,
	REPOHOP_TOOL_RISK,
	REPOHOP_TOOL_SCOPES,
	newRequestId,
} from "../../src/tools/types.js";
import {
	allowAll,
	allowReadOnly,
	riskOf,
	tieredApprover,
} from "../../src/approvals/policy.js";

describe("config", () => {
	test("defaults target hosted cloud with the full grant", () => {
		const config = loadConfig({});
		expect(config.baseUrl).toBe("https://repohop.app");
		expect(config.mcpPath).toBe("/api/mcp");
		expect(config.scopes).toEqual([...REPOHOP_SCOPES]);
		expect(config.scopes).toContain("offline_access");
	});
	test("trims trailing slashes and honors overrides", () => {
		const config = loadConfig({
			REPOHOP_URL: "http://localhost:3000/",
			REPOHOP_SCOPES: "projects:read",
		});
		expect(config.baseUrl).toBe("http://localhost:3000");
		expect(config.scopes).toEqual(["projects:read"]);
	});
});

describe("tool contract", () => {
	test("exactly the 16 project_* tools, each with scopes, risk, budget", () => {
		expect(REPOHOP_TOOL_NAMES).toHaveLength(16);
		for (const name of REPOHOP_TOOL_NAMES) {
			expect(name.startsWith("project_")).toBe(true);
			expect(REPOHOP_TOOL_SCOPES[name].length).toBeGreaterThan(0);
			expect(REPOHOP_TOOL_SCOPES[name][0]).toBe("projects:read");
			expect(REPOHOP_REQUEST_BUDGETS[name]).toBeGreaterThan(0);
			expect(["read", "write", "execute", "publish"]).toContain(REPOHOP_TOOL_RISK[name]);
		}
	});
	test("execute implies write (unsandboxed local authority)", () => {
		for (const name of ["project_exec", "project_process"] as const) {
			expect(REPOHOP_TOOL_SCOPES[name]).toContain("projects:write");
			expect(REPOHOP_TOOL_SCOPES[name]).toContain("projects:exec");
			expect(REPOHOP_TOOL_RISK[name]).toBe("execute");
		}
	});
	test("gateway body ceiling is the binding transport limit", () => {
		expect(GATEWAY_BODY_LIMIT_BYTES).toBe(64 * 1024);
	});
	test("request ids are unique", () => {
		expect(newRequestId()).not.toBe(newRequestId());
	});
});

describe("error taxonomy", () => {
	test("tool error detail parses and maps", () => {
		expect(getToolErrorDetail({ result: { error: { code: "X" } } })).toBeNull();
		const detail = getToolErrorDetail({ error: { code: "AMBIGUOUS_RESULT" } });
		expect(detail?.code).toBe("AMBIGUOUS_RESULT");
		expect(codeForToolError({ code: "AMBIGUOUS_RESULT" })).toBe("AMBIGUOUS_RESULT");
		expect(codeForToolError({ code: "FORBIDDEN" })).toBe("FORBIDDEN_SCOPE");
		expect(codeForToolError({ code: "whatever" })).toBe("TOOL_REJECTED");
	});
	test("RepoHopError carries code and retry hint", () => {
		const error = new RepoHopError("RATE_LIMITED", "slow down", { retryAfterSec: 60 });
		expect(error.code).toBe("RATE_LIMITED");
		expect(error.retryAfterSec).toBe(60);
	});
});

describe("approval policy", () => {
	test("read-only allows reads, denies the rest", async () => {
		expect(await allowReadOnly({ tool: "project_read", args: {}, risk: "read" })).toBe(true);
		expect(await allowReadOnly({ tool: "project_write", args: {}, risk: "write" })).toBe(false);
		expect(await allowReadOnly({ tool: "project_exec", args: {}, risk: "execute" })).toBe(false);
		expect(await allowAll({ tool: "project_push", args: {}, risk: "publish" })).toBe(true);
	});
	test("tiered approver escalates exec/publish", async () => {
		const policy = tieredApprover(async () => false);
		expect(await policy({ tool: "project_read", args: {}, risk: riskOf("project_read") })).toBe(true);
		expect(await policy({ tool: "project_write", args: {}, risk: riskOf("project_write") })).toBe(true);
		expect(await policy({ tool: "project_exec", args: {}, risk: riskOf("project_exec") })).toBe(false);
	});
});
