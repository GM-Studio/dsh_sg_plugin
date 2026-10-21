# Design

## Host Boundary

Codex, not the MCP server, owns subagent creation. The plugin therefore ships custom-agent TOMLs and a Skill/AGENTS instruction that requires the main Codex agent to spawn them. MCP tools are split into prepare/execute phases so the main agent can return to the model between tool calls, spawn subagents, and then submit or validate their committed work.

## Source Loading

Use the portable Agent Plugins layout:

```text
plugin.json
mcp.json
skills/
assets/codex/agents/
```

`.codex-plugin/plugin.json` and `.mcp.json` remain compatibility inputs. The repo root also exposes `.agents/plugins/marketplace.json` pointing to the checkout.

## Agent Profiles

Project-scoped agents are installed into `.codex/agents/`:

- `specgate_test_designer`
- `specgate_frontend`
- `specgate_backend`
- `specgate_tester`
- `specgate_formatter`
- `specgate_reviewer`

The installer manages a marked block in the project `AGENTS.md` and preserves unrelated content.

## Test Worktree

`sg_test_design_prepare` creates `.specgate/codex/worktrees/<change>/test-design` on `sg/codex/<change>/test-design`. `sg_test_design_freeze` reads the committed `specgate-tests.json`, verifies every file hash and AC mapping, writes immutable copies, and removes neither branch nor worktree.

`specgate-tests.json` is the only native asset manifest. It contains the schema version, cases, code, fixtures, coverage targets and runner path. `runner.mjs` must be included as an executable test file.

The runner CLI uses a canonical `--tests` path that directly contains `runner.mjs`; test assets resolve from that root without appending another `specgate-tests/`. The MCP-owned adapter retries the legacy snapshot-parent interpretation only when the canonical attempt produced no report or a setup-only duplicated-path error. A runner that produced explicit case failures is never retried.

If later evidence shows that the frozen test source itself violates project formatting or the runner contract, `sg_test_replace_assets` accepts a Test Designer revision with a bounded reason. It preserves v1 and writes a hash-bound v2 manifest instead of allowing product developers to edit tests.

## Development

`sg_development_prepare` creates frontend, backend, integration, test, review and format worktrees. The native red runner is derived from the frozen runner path, not a client command.

Codex spawns frontend and backend agents with the exact paths/branches. `sg_development_run` uses a server-owned native provider that does not execute model commands; it validates the already committed worktrees and returns `precompleted: true`.

## Quality and Formatting

`TESTING -> FORMATTING -> REVIEWING` is explicit in the state machine. The Tester invokes the frozen runner and real verifier in the test worktree. Only a complete pass advances.

The Formatter worktree is aligned to the integration commit and runs project-owned format commands. Its role policy forbids test and `.specgate` content. A commit, if any, is merged through integration.

Before a Tester retry, the server aligns its own test worktree and removes only untracked files classified as test paths from prior generated-test runs. Unrelated or tracked changes still fail closed. This keeps repeated quality attempts clean without hiding product edits.

## Review and Rework

Reviewer reports are submitted to MCP and validated against the fixed integration commit, diff hunks, AC ids and quality hash. Review worktree writes are rejected.

On blocking findings, rework increments `development.round`, creates new frontend/backend/format worktrees from the current integration commit with round-qualified branch names, and permits `REVIEWING -> DEVELOPING`. The existing frozen tests remain authoritative; rework must repeat quality, formatting and review.

## Approval Identity

The plugin server can opt into `SPECGATE_INTERACTIVE_APPROVAL=1`. In that mode it derives a local actor from `os.userInfo()` and combines that with MCP `elicitation/create`. The actor source is `codex-mcp-os-user`. This is not client-supplied identity: tool arguments cannot set it, and the action is still subject to explicit MCP elicitation, artifact rehashing and durable audit.
