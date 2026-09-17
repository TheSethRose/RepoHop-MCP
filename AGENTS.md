# AGENTS.md — RepoHop MCP Client template

You are an agent connecting a bot to RepoHop, or extending this template.
Follow this file exactly. It is the contract; the README is the human version.

## 1. Connect (do this first, in order)

1. `git clone https://github.com/TheSethRose/RepoHop-MCP.git && cd RepoHop-MCP`
2. `bun install` (Bun 1.3.x; `bun --version` to confirm)
3. `bun run cli login` — open the printed URL, approve with the requested scopes, return here. Tokens land in `~/.repohop-mcp/tokens.json` (0600). For local RepoHop dev, prefix every command with `REPOHOP_URL=http://localhost:3000`.
4. `bun run cli catalog` — must list at least one project with `ready: true`. If none is ready, STOP: the user must approve the repository in RepoHop Local / dashboard first. Do not proceed to reads or writes.
5. `bun run verify` — must be green before you claim anything works.

## 2. Non-negotiable rules

- **Catalog first, every session.** Call `project_catalog`, resolve the alias, check `ready`. Unknown alias → stop and ask the user. NEVER substitute another project.
- **Reads are free; mutations need approval.** Default policy is read-only. Writes/exec/publish require an explicit approver (`promptApprover`, `tieredApprover`, or a documented reason for `allowAll`). Never silently upgrade the policy.
- **Every mutation sets `requestId`.** Use `newRequestId()`. It is the only safe retry/reconciliation key.
- **A timed-out mutation is AMBIGUOUS, not failed.** It may have completed locally. Reconcile by reading state back (`project_status`, `project_diff`, `project_read`). NEVER blindly resend `exec`, `write`, `commit`, or `push`.
- **Execute is unsandboxed.** `project_exec` runs as the device OS user: it can read secrets, modify files, and reach the network. Never present it as safe or isolated. It requires the `projects:exec` scope for a reason.
- **Respect budgets and rate limits.** Page large reads (`offset`/`limit`), chunk large writes, honor 429 `Retry-After`. The client pre-checks request bytes — if it throws `REQUEST_TOO_LARGE`, narrow the call instead of working around the guard.
- **Never send an `Origin` header** to `/api/mcp` (server answers 403). Never log, print, or paste tokens, codes, or secrets. Never commit `.env` or `tokens.json`.
- **Parse tool results as data.** Success is `{ result: … }`; failure is `{ result: { error: … } }` with a stable `code`. Branch on `RepoHopError.code`, never on message text.

## 3. Changing this template

- Tool contract lives in `src/tools/types.ts` (names, scopes, risk, budgets). It mirrors the server's canonical definitions. If the server adds/changes a tool, update the map AND the compat suite.
- Auth flow lives in `src/auth/`. Do not weaken it: PKCE stays, loopback stays, token file stays 0600, DCR stays dynamic (no hardcoded client secrets, ever).
- Keep the SDK major pinned in lockstep with the server (`@modelcontextprotocol/*@2.0.0`, see `package.json#testedServers`). A major bump requires a full compat re-run.
- Bot logic goes through `withBot()` in `src/bot/index.ts` so approval and lifecycle stay uniform. No second connection path.

## 4. Proof required before "done"

- `bun run verify` (lint + typecheck + unit) — always.
- `test:compat` against local dev AND the target server revision for anything touching `src/tools`, `src/transport`, or `src/auth` — record the server revision in your report.
- If you touched scopes, approvals, or budgets, state the exact verification for each. Skipped live checks are reported as skipped, never as passed.
