# Tasks

Status: approved (2026-10-22); work proceeds on branch `sg-codex-stack-solidify`.
Check tasks off as each slice lands and is verified.

Progress: `ProjectProfile` records optional `frontendFramework` (`vue`|`react`)
and `javaPreset`, exposed via `readProjectConventions`, populated for new
projects and detected on adoption (`be6ebfb`). The change workflow now rejects
Vue single-file components in a React project through the frontend role policy
(346 tests green). Interactive `frontend` selection in `sg_init`/`sg_init_preview`
and the React template are still pending.

- [x] 1. P0: approve the requirements document; keep this proposal/design/spec
      aligned with it.
- [ ] 2. P1: add failing tests for JDK+frontend selection, `ProjectProfile`
      recording, and stack enforcement in the change workflow.
- [ ] 3. P1: implement interactive stack selection and stack-match fail-closed
      behavior.
- [ ] 4. P2: add failing tests for the domain-neutral management-system scaffold
      (users, roles, departments, menus, permissions, audit, pagination,
      import/export, dashboard) on both backend and frontend.
- [ ] 5. P2: build the Vue 3 scaffold and its real build/test/run verification.
- [ ] 6. P3: add failing tests for the React 18 scaffold and its parity with Vue
      (shared backend contract, menu, i18n keys).
- [ ] 7. P3: implement the React 18 scaffold and align it with the Vue scaffold.
- [ ] 8. P4: author the style guide and add Reviewer blocking-on-deviation
      findings with tests.
- [ ] 9. P5: add failing tests for the multi-project registry, aggregate console
      (cross-project attention/queue, global concurrency), isolated mode, and
      switching command.
- [ ] 10. P5: implement the registry, aggregate and isolated control modes.
- [ ] 11. P5: add failing tests for durable Web sessions and pairing across
      control-plane restart; implement durable storage.
- [ ] 12. P6: add failing tests for host capability probing (`plugin`,
      `exec --json`, native subagents, elicitation), degradation path and
      version gate hint.
- [ ] 13. P6: implement the capability probe, `doctor` reporting and the
      project-level MCP + skill degradation path.
- [ ] 14. P7: add failing tests for dual-platform golden verification
      (`win32` + `linux`, WSL not accepted) and extend the verification matrix.
- [ ] 15. P7: implement dual-platform acceptance and update the golden manifest
      to require both platforms.
- [ ] 16. P8: wire incremental delivery impact analysis into the `sg_change`
      intake with tests.
- [ ] 17. P8: small cleanups (`HOST_HEALTH` `SUSPECT`, unused `pushApproved`).
- [ ] 18. P9: update the Codex Skill, project agents, installers, manifests,
      README and changelogs.
- [ ] 19. P9: run focused suites, `npm test`, `npm run lint`,
      `npm run format:check`, `npm run pack:check`,
      `node scripts/codex-plugin-smoke.mjs`,
      `node scripts/verify-codex-matrix.mjs` and `git diff --check`.
- [ ] 20. P9: execute the real matrix on Windows and Linux, record actual
      results, unexecuted checks and residual risks.
