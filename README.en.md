# SpecGate for Codex

SpecGate is a native Codex plugin for gated, evidence-backed delivery with real
subagents, isolated worktrees, executable tests and auditable MCP state.

[中文](README.md) · [Source-loading Quickstart (Chinese)](docs/quickstart-codex-source.zh.md)

## Capabilities

- Initialize a Java 21 / Spring Boot / Vue 3 baseline with `sg_init`.
- Freeze requirements, contracts, models and tests through `sg_change_add` and H1.
- Run the Test Designer before implementation.
- Dispatch Frontend and Backend subagents concurrently in isolated worktrees.
- Run frozen tests and real Maven, Vitest, HTTP and runtime verification.
- Format in a dedicated worktree and perform read-only Review on a fixed commit.
- Send blocking Review or quality failures into new development rounds and repeat
  the full quality, formatting and Review loop.
- Keep H3 interactive and artifact-bound; never report unexecuted checks as passed.

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
