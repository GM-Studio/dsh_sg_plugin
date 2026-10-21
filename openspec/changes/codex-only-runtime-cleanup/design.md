# Design

## Runtime Namespace

All shared code needed by `src/codex/server.js`,
`src/codex/init-worker.js` and `src/codex/native-test-runner.mjs` moves under
`src/codex/core/`.

- Generic state, requirements, suites and environment helpers go in
  `src/codex/core/` and its `env/`, `util/` and `coverage/` subdirectories.
- Java/Vue toolchain, initialization and evidence code goes in
  `src/codex/core/java/`.
- Existing `src/codex/*` modules keep their public MCP responsibilities and
  import only from `src/codex/core/`.

The move must preserve relative behavior. In particular, Java template lookup
must continue to resolve `assets/java-vue/template/`, and the init worker must
continue to run in a clean child process.

## Removal Boundary

The branch may remove:

- DSH root loader, Cordis patch, locale and icon resources.
- All v3/v4 source files not in the Codex runtime dependency closure.
- v3/v4 tests and legacy Java template acceptance scripts.
- Legacy DSH Skill, rules, experience, scaffold and sample assets.
- Historical verification directories except the concise CRM acceptance report.
- Generated local artifacts already covered by `.gitignore`.

The branch must keep:

- Portable and compatibility plugin manifests.
- Source setup, MCP smoke and Codex runtime matrix checks.
- The six project Agent templates and two Codex Skills.
- The Java/Vue template required by initialization.
- All focused Codex tests and their fixtures.

## Package Shape

`package.json` becomes a Codex-only package. Its `files` allowlist names the
runtime directories and documents instead of including the entire repository.
DSH exports, DSH engine requirements and the Cordis bundle configuration are
removed.

## Verification

After migration:

1. The runtime dependency graph must resolve without `src/v3` or `src/v4`.
2. Focused Codex tests must pass.
3. Full tests, lint, formatting and pack checks must pass.
4. A clean temporary project must initialize and verify using the packaged
   Codex plugin path.
