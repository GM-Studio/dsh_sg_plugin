# SpecGate Codex repository rules

- This branch is a Codex host plugin. `plugin.json` and `mcp.json` are the
  portable entry points; the MCP server is `src/codex/server.js`.
- Runtime code lives under `src/codex/`. Shared initialization, verification and
  Java/Vue implementation belongs under `src/codex/core/`.
- Do not introduce version-named compatibility directories or imports. Codex is
  the only supported runtime on this branch.
- Preserve user working-tree changes. Do not commit or push unless the user
  explicitly requests it.
- Initialization generation is not verification. Record unexecuted checks
  explicitly; only real command and runtime evidence may mark verification as
  passed.
- Generated HTTP APIs use GET for queries and POST for every mutation.
  Update/delete ids belong in JSON request bodies at `/update` and `/delete`;
  business responses are JSON, including a 200 deletion receipt. Approved
  Java/Vue file transfers may use multipart uploads and binary responses; errors
  remain JSON.
- Toolchain discovery must be bounded, cross-platform and reuse existing
  installations before requesting custom paths or downloading project-local
  archives.
- Run focused `node --import ./test/setup-temp.mjs --test <files>` regressions,
  then `npm test`, `npm run lint`, `npm run format:check` and
  `npm run pack:check` for changed source.
