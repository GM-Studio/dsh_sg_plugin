# SpecGate for Codex

SpecGate is a native Codex plugin for project readiness, accepted changes,
independent verification, delivery records and incremental redelivery with real
subagents, isolated worktrees, executable tests and auditable MCP state.

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

## Layout

```text
plugin.json / mcp.json                 portable plugin entry
.codex-plugin/ / .mcp.json             compatibility manifests
skills/                                sg-codex and setup Skills
assets/codex/                          six project Agent templates
assets/java-vue/template/              generated Java/Vue baseline
src/codex/                             MCP server and workflow services
src/codex/core/                        shared state, verification and Java tooling
scripts/codex-source-setup.mjs         project Agent installer
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
```

## License

MIT
