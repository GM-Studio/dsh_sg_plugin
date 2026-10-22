# Tasks

Status: approved (2026-10-22); work proceeds on branch `sg-codex-stack-solidify`.
Check tasks off as each slice lands and is verified.

Progress: `ProjectProfile` records optional `frontendFramework` (`vue`|`react`)
and `javaPreset`, exposed via `readProjectConventions`, populated for new
projects and detected on adoption (`be6ebfb`). The change workflow now rejects
Vue single-file components in a React project through the frontend role policy
(`440946a`). `sg_init` / `sg_init_preview` accept a `frontend` choice and fail
closed with `FRONTEND_UNAVAILABLE` for React until its template lands
(347 tests green).

Open constraint: the React template must ship a real `package-lock.json`
(the Vue template does; `npm ci` in verification requires it) and must pass the
Windows + Linux golden matrix. Authoring React sources without a real lockfile
would generate a template that cannot be verified, so the slice stops at a
fail-closed boundary until that is settled.

Vue admin scaffold: the module inventory and landing order are recorded in
`design.md`. This environment has no `java`/`mvn` on PATH, so authoring the
scaffold and running its real verification must be paired; a changed template
moves `GOLDEN_MANIFEST` to pending re-verification.

Landed (template step 1, layout + router + dashboard shell): the Vue frontend
gains `vue-router`, an `AppLayout` shell, `DashboardView` and `TasksView`; the
generated lockfile is regenerated with the new dependency. Verified by real runs
on a generated `jdk17-boot3.5` project: backend `clean verify` (jar + surefire),
frontend `vue-tsc` build, and 12/12 Vitest cases pass. `GOLDEN_MANIFEST` now
records the new hashes as `pending` with no platform evidence; Windows and Linux
re-verification is still required before any preset is `verified` again.

Landed (template step 2, users and roles): backend `com.<pkg>.sys` module
(SysRole/SysUser entities, repositories, services, controllers, dto/vo, two
MockMvc suites) and frontend `api/sys.ts`, `views/sys/RoleView.vue`,
`views/sys/UserView.vue` and `test/sys.test.ts`, wired into the router, sidebar
and zh/en i18n. Verified on a generated `jdk17-boot3.5` project: backend
`clean verify` 16/16 (2 new sys suites), frontend build, 23/23 Vitest, lint and
format:check all pass; repo suite 347/347. `GOLDEN_MANIFEST` hashes refreshed and
still `pending`.

Landed (template step 3, departments + menus + audit + dashboard): backend
`sys` modules SysDepartment, SysMenu, SysAuditLog (read-only) and
SysDashboard, each with service/controller/dto/vo and a MockMvc suite; frontend
`views/sys/{DepartmentView,MenuView,AuditView}.vue`, extended `api/sys.ts` and
`test/sys-admin.test.ts`; router, sidebar and zh/en i18n wired. Authored by five
parallel agents against a fixed contract. Verified on a generated
`jdk17-boot3.5` project: backend `clean verify` 25/25, frontend build, 31/31
Vitest, lint and format:check pass; repo suite 347/347. `GOLDEN_MANIFEST`
refreshed, still `pending`.

Fixed during integration: the earlier template copy-back had baked generated
package names into the role/user sys templates (17 files restored to
`com.example.tasks` + `javax.*` so the generator can rewrite them per project),
and two audit test assertions were corrected.

Landed (template step 4, CSV + dashboard + style baseline + audit writes):

- `SysUserCsvService` / `SysRoleCsvService` with `/import/validate`, `/import`,
  `/import/template` and `/export` endpoints on the users and roles controllers,
  plus two CSV MockMvc suites (5 cases each).
- Frontend `csv.import/template/export` clients, CSV panels in RoleView and
  UserView, and `DashboardView` now reads the real `/api/sys/dashboard` summary.
- `docs/style.md` rewritten as the enforceable style baseline and the reviewer
  agent template extended so unjustified deviation is a finding (blocking when
  substantive).
- The four `sys` services now record audit entries on create/update/delete.
  Verified on a generated `jdk17-boot3.5` project: backend `clean verify` 35/35,
  frontend build, 34/34 Vitest, lint and format:check pass; repo suite 347/347.
  `GOLDEN_MANIFEST` refreshed, still `pending`.

Landed (control-plane step 5, five parallel agents): incremental delivery impact
is computed and persisted at the `sg_change` intake
(`state.context.changeAdd.incremental`); host capabilities are probed and
reported by `doctor` with an explicit degradation policy and version gate hint;
Web sessions and pairing persist across a control-plane restart through an
injected file session store; a multi-project registry and aggregate projection
module is in place (wired in the step below); `HOST_HEALTH` now includes
`SUSPECT` and the dead `pushApproved` profile field is removed. Repo suite
395/395, lint, format:check and pack pass.

Landed (control-plane step 6, five parallel agents): the control plane registers
and serves several projects in aggregate mode, supports an explicit isolated
mode through `--mode` plus a `register` command, and the console gained a
cross-project portfolio view and a severity-ordered attention home; the
dual-platform golden mechanism (`--platform`, platform-scoped records, a
no-fabricated-pass helper) is in place while every preset stays `pending`; the
Skill, agent templates, README/CHANGELOG and the two zh guides now describe the
admin scaffold, the control modes and capability degradation. Repo suite
415/415, lint, format:check and pack pass.

- [x] 1. P0: approve the requirements document; keep this proposal/design/spec
      aligned with it.
- [x] 2. P1: add failing tests for JDK+frontend selection, `ProjectProfile`
      recording, and stack enforcement in the change workflow.
- [x] 3. P1: implement interactive stack selection and stack-match fail-closed
      behavior.
- [x] 4. P2: add failing tests for the domain-neutral management-system scaffold
      (users, roles, departments, menus, permissions, audit, pagination,
      import/export, dashboard) on both backend and frontend.
- [x] 5. P2: build the Vue 3 scaffold and its real build/test/run verification.
- [ ] 6. P3: add failing tests for the React 18 scaffold and its parity with Vue
      (shared backend contract, menu, i18n keys).
- [ ] 7. P3: implement the React 18 scaffold and align it with the Vue scaffold.
- [x] 8. P4: author the style guide and add Reviewer blocking-on-deviation
      findings with tests.
- [x] 9. P5: add failing tests for the multi-project registry, aggregate console
      (cross-project attention/queue, global concurrency), isolated mode, and
      switching command.
- [x] 10. P5: implement the registry, aggregate and isolated control modes.
- [x] 11. P5: add failing tests for durable Web sessions and pairing across
      control-plane restart; implement durable storage.
- [x] 12. P6: add failing tests for host capability probing (`plugin`,
      `exec --json`, native subagents, elicitation), degradation path and
      version gate hint.
- [x] 13. P6: implement the capability probe, `doctor` reporting and the
      project-level MCP + skill degradation path.
- [x] 14. P7: add failing tests for dual-platform golden verification
      (`win32` + `linux`, WSL not accepted) and extend the verification matrix.
- [x] 15. P7: implement dual-platform acceptance and update the golden manifest
      to require both platforms.
- [x] 16. P8: wire incremental delivery impact analysis into the `sg_change`
      intake with tests.
- [x] 17. P8: small cleanups (`HOST_HEALTH` `SUSPECT`, unused `pushApproved`).
- [x] 18. P9: update the Codex Skill, project agents, installers, manifests,
      README and changelogs.
- [ ] 19. P9: run focused suites, `npm test`, `npm run lint`,
      `npm run format:check`, `npm run pack:check`,
      `node scripts/codex-plugin-smoke.mjs`,
      `node scripts/verify-codex-matrix.mjs` and `git diff --check`.
- [ ] 20. P9: execute the real matrix on Windows and Linux, record actual
      results, unexecuted checks and residual risks.
