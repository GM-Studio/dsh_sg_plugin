# CRM native Agent workflow acceptance

Date: 2026-10-21

## Environment

- Isolated VMware Ubuntu VM.
- Codex CLI 0.163.0.
- Source-loaded plugin: `specgate-codex@specgate-source` 0.3.0.
- Project-scoped MCP bound to the absolute project root.
- Six real project agents: Test Designer, Frontend, Backend, Tester, Formatter, Reviewer.
- Generated stack: Java 21, Spring Boot 3.5.16, Maven, Vue 3, TypeScript and Vite.

## Delivered flow

The isolated fixture used `sg_init` to generate and verify the Java/Vue baseline,
created the `customer-crm` change, froze requirements, contracts, model and
executable tests, and then ran the native Agent loop:

1. Test Designer froze four acceptance cases in its isolated worktree.
2. Frontend and Backend agents ran concurrently in separate worktrees.
3. MCP validated role commits and merged both through integration.
4. Tester ran all frozen cases plus real Java/Vue verification.
5. Formatter ran in a dedicated worktree after quality passed.
6. Reviewer performed a read-only strict Review.
7. Blocking Review findings automatically created new development rounds.
8. Quality, formatting and strict Review were repeated until all passed.

The workflow stopped at `H3_PENDING`. No H3 approval, archive, push or
publication was performed.

## Final result

- State: `H3_PENDING`, version 69.
- Final integration commit: `b5dcb4547add6cf53b9bcb8f0632c6119d3e727d`.
- Frozen cases: 4 passed, 0 failed, 0 skipped.
- Real verification: 9/9 stages passed.
- Backend tests: 17/17.
- Frontend tests: 12/12.
- Changed-line coverage: 413/449 = 91.98%, unavailable 0.
- Quality hash: `sha256:d1ada9a0b01931da50633075f8be70d8f2f7461d481d86bf24e923e164decf3c`.
- Format hash: `sha256:97c6a05e847a5903b70e4afbcc77eab90d047814d8650b83a7ca10bf42302e68`.
- Strict Review hash: `sha256:b5e3b6a759a6338f137f49fb831447585fbfd8d8167da2de01c6abdcb1824c42`.
- Strict Review findings: P0/P1/P2/P3 = 0/0/0/0.

## Defects found by the real run

- Source setup left `.codex/` and a setup-created `AGENTS.md` untracked. The
  installer now writes managed entries to the repository-local Git exclude,
  creates a missing `.git/info/` directory and reports tracked `AGENTS.md`
  explicitly instead of hiding it.
- Test Designer and MCP used different `--tests` root semantics. The native
  adapter now uses one canonical test root and performs only a setup-safe legacy
  fallback. Explicit failing reports are never retried.
- A frozen JUnit source had non-project import order, but the test-replacement
  service had no MCP surface. `sg_test_replace_assets` now records a bounded,
  versioned Test Designer revision while preserving v1.
- A Tester retry inherited generated test files from the previous run. Quality
  alignment now removes only untracked generated test-path files; unrelated or
  tracked changes still fail closed.
- Strict Review found a case-insensitive email uniqueness race and non-atomic
  summary counts. Rework introduced normalized persistence, database uniqueness,
  conflict translation and one aggregate summary query.
- Changed-line coverage exposed a declaration-only repository interface. A
  follow-up development round moved the aggregate to the service and restored
  the interface byte-for-byte.

## Verification commands

```sh
node --import ./test/setup-temp.mjs --test test/codex-*.test.js
npm test
npm run lint
npm run format:check
npm run pack:check
```

Codex-only repository result: 161 tests, 161 passed, 0 failed and 0 skipped.
Lint, formatting, the 157-file / 1.1 MB unpacked package check and packaged MCP
stdio smoke all passed.

The post-cleanup real matrix initialized and verified all four Java presets:

- `jdk8-boot2.7`
- `jdk17-boot3.5`
- `jdk21-boot3.5`
- `jdk21-boot4.0`

Each preset passed Maven verify, frontend install/build/test/lint/format, HTTP
CRUD and graceful-restart persistence.
