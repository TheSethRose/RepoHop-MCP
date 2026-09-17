# RepoHop MCP Client (template)

Connect any bot to [RepoHop](https://repohop.dev) over MCP: OAuth 2.1 login, typed wrappers for all 16 `project_*` tools, approval hooks, and a live conformance suite. Copy this repo, run three commands, point your agent at it.

> **Agent shortcut:** if you were told to "pull it from here," do exactly this and nothing else first:
>
> ```bash
> git clone https://github.com/TheSethRose/RepoHop-MCP.git && cd RepoHop-MCP
> bun install
> bun run cli login   # opens an approve URL; approve it, done
> bun run cli catalog # proves the connection: lists granted projects
> ```
>
> Then read `AGENTS.md` in this repo before writing any bot code.

## How connecting works (exact)

1. **Endpoint.** `POST {REPOHOP_URL}/api/mcp` (default `https://repohop.app/api/mcp`). Stateless Streamable HTTP, JSON responses. For local RepoHop dev use `REPOHOP_URL=http://localhost:3000`.
2. **Auth.** OAuth 2.1 authorization-code + PKCE, public native client, loopback callback on `127.0.0.1:12719`. The server supports dynamic client registration — no pre-registration needed. `bun run cli login` runs discovery → registration → prints the approve URL → captures the callback → stores tokens (with `offline_access` refresh) in a `0600` file at `~/.repohop-mcp/tokens.json`.
3. **Scopes.** Request what the bot needs, nothing more:
   - `projects:read` — catalog, status, list, read, search, diff
   - `projects:write` — + write, patch, delete (requires read)
   - `projects:exec` — + exec, process (requires write; unsandboxed local commands)
   - `projects:publish` — + commit, push (requires write)
   - `offline_access` — refresh tokens for headless bots
4. **First call is always `project_catalog`.** Resolve the project alias from the catalog, verify `ready: true`, then act. Never guess aliases, never substitute another project.

## Minimal bot (copy this)

```ts
import { loadConfig } from "repohop-mcp-client";
import { withBot } from "repohop-mcp-client";

await withBot(loadConfig(), async ({ call }) => {
	const projects = (await call("project_catalog", {})) as Array<{
		alias: string;
		ready: boolean;
	}>;
	const ready = projects.filter((p) => p.ready);
	if (ready.length === 0) throw new Error("No ready projects.");
	const [first] = ready;
	return call("project_read", { project: first.alias, path: "README.md" });
});
```

Writes need approval by default. For autonomous operation pass an explicit approver — see `src/approvals/policy.ts` (`allowReadOnly` default, `promptApprover`, `tieredApprover`, `allowAll` for fully trusted setups only).

## Rules your bot must follow

- **Catalog first, alias-exact.** Unknown alias = stop and ask. The client enforces this.
- **Mutations carry `requestId`.** Always set it (use `newRequestId()`); it is your reconciliation key.
- **Timeouts are ambiguous.** A timed-out `exec`/`write` may have completed locally. Read back state before retrying — never blindly resend a mutation.
- **Respect budgets.** Large reads must page (`offset`/`limit`); large writes must chunk. The client pre-checks request bytes and fails fast instead of eating a gateway 413.
- **429 means wait.** Honor `Retry-After` (60s typical). The client retries reads once automatically; mutations never auto-retry.
- **No `Origin` header.** The server rejects cross-origin POSTs with 403. Node fetch sends none — keep it that way.
- **Tokens stay in the token file.** Never log them, never paste them into prompts or tickets.

## CLI

```
bun run cli login              # browser approve → tokens stored
bun run cli status             # auth state + granted tools
bun run cli catalog            # granted projects with readiness
bun run cli call <tool> '<json args>'
bun run cli logout             # forget local tokens (revoke the grant in the dashboard too)
```

## Verify against a server

```bash
bun run verify                        # lint + typecheck + unit (no server needed)
REPOHOP_COMPAT_URL=http://localhost:3000 REPOHOP_COMPAT_TOKEN=<access-token> bun run test:compat
```

Tested against RepoHop with `@modelcontextprotocol/client@2.0.0` (pinned — keep the major in lockstep with the server). See `package.json#testedServers`.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `No OAuth tokens found` | Run `bun run cli login`. |
| `401 after login` | Grant revoked or expired → `login` again; revoke stale grants in the dashboard. |
| `Tool X is not in this grant` | Re-login with broader `REPOHOP_SCOPES`; the grant, not the code, decides. |
| `403 Origin is not allowed` | Something added an `Origin` header (browser fetch does). Use Node. |
| `429` | Wait out `Retry-After`; lower call rate. |
| `AMBIGUOUS_RESULT` on exec | Read back state (status/diff/read) to reconcile; do not resend blind. |
| `REQUEST_TOO_LARGE` | Page reads, chunk writes; gateway caps bodies at 64 KiB. |
