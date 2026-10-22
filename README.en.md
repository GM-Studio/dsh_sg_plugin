# SpecGate for Codex

SpecGate is a native Codex plugin for project readiness, asynchronous delivery,
accepted changes, independent verification, delivery records and incremental
redelivery with real subagents, isolated worktrees, executable tests and
auditable MCP state.

[中文](README.md) · [Source-loading Quickstart (Chinese)](docs/quickstart-codex-source.zh.md)

## Capabilities

- Initialize a new Java/Vue project or adopt an existing repository without
  recreating it.
- Commit a dirty existing worktree only through an explicit approved file set.
- Use `sg_change` for feature, modify and fix while retaining `sg_change_add`.
- Freeze requirements, ChangeContract and acceptance criteria through H1.
- Run the Test Designer before implementation.
- Run Frontend and Backend implementation serially in isolated worktrees.
- Run frozen tests and real Maven, Vitest, HTTP and runtime verification.
- Format in a dedicated worktree and perform read-only Review on a fixed commit.
- Record commit, AC, environment fingerprint, flaky outcomes and unexecuted
  checks as evidence.
- Create immutable DeliveryRecords, local tags, internal evidence packs and
  customer delivery packs after H3.
- Reuse or invalidate prior acceptance evidence for incremental redelivery.
- Require explicit `push: true`; force push is forbidden.
- Keep WorkItems running in a detached supervisor after MCP, Web and Feishu
  clients disconnect.
- Release H1/H3 execution leases and resume the persisted Codex session after a
  trusted Decision.
- Monitor attention, projects, WorkItems, ExecutionRuns, evidence and Decisions
  in a local Web management UI.
- Send only actionable Feishu notifications. Buttons open an authenticated
  management page and never act as approval by themselves.
- Require TOTP step-up, CAS and artifact binding for high-risk Decisions.
- Separate H3 release approval from customer acceptance in DeliveryRecords.
- Do not deploy production or roll back production data automatically.

## Load from source

```powershell
cd E:\ai_workflow\specgate
npm ci
codex plugin marketplace add E:\ai_workflow\specgate
codex plugin add specgate-codex@specgate-source
node E:\ai_workflow\specgate\scripts\codex-source-setup.mjs --project <absolute-project-path>
codex -C <absolute-project-path>
```

Ask Codex to follow `AGENTS.md` and the `sg-codex` Skill. See the
[Quickstart](docs/quickstart-codex-source.zh.md) for installation details.

Start the asynchronous control plane separately:

```powershell
npm run codex:control -- status
npm run codex:control -- start --project <absolute-project-path>
```

The start result contains a one-time Web pairing URL. Closing Codex does not stop
the supervisor. Use `npm run codex:control -- stop` to stop it while preserving
WorkItem state.

Use `npm run codex:control -- doctor --project <absolute-project-path>` before
starting on a new host. The supervisor clears unrelated user MCP servers,
injects only the project-bound SpecGate MCP, excludes control-plane credentials
from the child environment, and uses a cross-platform stop request.

## Layout

```text
plugin.json / mcp.json                 portable plugin entry
.codex-plugin/ / .mcp.json             compatibility manifests
skills/                                sg-codex and setup Skills
assets/codex/                          six project Agent templates
assets/java-vue/template/              generated Java/Vue baseline
src/codex/                             MCP server and workflow services
src/codex/core/                        shared state, verification and Java tooling
src/codex/control/                     WorkItems, supervisor, Decision and Outcome
src/codex/management/                  local management API and Web UI
src/codex/channels/                    Feishu notifications and Outbox
scripts/codex-source-setup.mjs         project Agent installer
scripts/specgate-control.mjs           control daemon CLI
scripts/codex-plugin-smoke.mjs         packaged MCP smoke check
scripts/verify-codex-matrix.mjs        real Java/Vue preset matrix
test/codex-*.test.js                   focused Codex regressions
```

This branch contains the Codex plugin runtime only, with no legacy host entry
point or compatibility directories.

## Verification

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
npm run codex:control -- help
```

## License

MIT
