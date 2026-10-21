# Repository working rules

- SpecGate is a DSH host plugin. `index.js` registers v3 commands/tools; default Java/Vue initialization and local verification live in `src/v4/`.
- Preserve pre-existing working-tree changes. Do not publish or commit this plugin repository or alter user projects as part of maintenance. Generated isolated acceptance fixtures may exercise their own Git baselines.
- Initialization generation is not verification. Record unexecuted checks explicitly; only real command and runtime evidence may mark local verification passed.
- Generated HTTP APIs use GET for queries and POST for every mutation. Update/delete ids belong in JSON request bodies at `/update` and `/delete`; business responses are JSON, including a 200 deletion receipt. Approved Java/Vue file transfers permit multipart uploads and binary download/export responses; errors remain JSON. Keep clients, tests, OpenAPI and Golden evidence aligned.
- Toolchain discovery must be bounded, cross-platform and reuse existing installations before asking for custom paths or downloading project-local archives.
- Run focused `node --import ./test/setup-temp.mjs --test <files>` regressions, then `npm test`, `npm run lint`, and formatting checks for changed source. Never update Golden hashes to claim success without real validation.
