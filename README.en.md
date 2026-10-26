# SpecGate Core for Codex

SpecGate Core delivers an auditable, local change workflow for **existing Git projects**. The default MCP uses local files, Git worktrees, and an append-only event chain. It starts without MySQL, a web service, notification credentials, or an open port.

[中文](README.md) · [Frozen v1 requirements](docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md) · [Approved plan](docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md)

## Default workflow

1. Bind and adopt an existing Git project with a verified ProjectProfile and ProjectBaseline.
2. Clarify requirements and obtain trusted human H1 approval.
3. Freeze contracts, acceptance criteria, task file policies, and executable tests; observe a genuinely failing red baseline.
4. Run bounded Test Designer, Implementer, and Reviewer roles in isolated worktrees.
5. Execute frozen tests and project-declared verification. After deterministic formatting, rerun the full quality gate at the formatted integration commit before read-only Review.
6. Obtain trusted human H3 approval, then create a commit-bound DeliveryRecord, rollback notes, and a customer pack containing every known issue. Pushing requires an explicit request; force push is forbidden.

Unexecuted, skipped, timed-out, or failed checks cannot count as passed. The real project canary and release acceptance remain in plan milestone M6. Repository fixtures do not establish a real business delivery, human approval, or native Reviewer session.

## Installation and scope

`plugin.json` and `mcp.json` are the portable entry points; the MCP server is `src/codex/server.js`. The default 43-tool list is asserted in the protocol tests. `$sg-codex` routes to environment inspection, existing-project adoption, change delivery, and read-only status. Core inspects and reuses installed toolchains without automatic downloads or installation.

Historical new-project templates, auto-installation, asynchronous WorkItems, control plane, Workers, Decisions, TOTP, web UI, and notifications remain in the source tree. They are excluded from the default tools, static startup graph, and Core tarball. Source developers can explicitly set `SPECGATE_OPTIONAL_MODULES=1` to expose historical tools; that mode and its external dependencies are outside Core release validation. The Core package contains no `mysql2`.

## Verification

```sh
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

`npm test:mysql` separately runs historical MySQL integration tests and requires user-provided database configuration; missing prerequisites fail explicitly. See the [acceptance records](docs/implementation/specgate-core-mvp-v2/04-m0-acceptance.md) and approved plan appendix for completed stages.
