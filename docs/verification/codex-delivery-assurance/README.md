# Codex Delivery Assurance Verification

- Date: 2026-10-22
- Requirement:
  `docs/requirements/2026-10-22-codex-delivery-mvp-requirements-analysis.zh.md`
- Plan: `docs/plans/2026-10-22-codex-delivery-assurance-plan.zh.md`

## Automated Evidence

- The delivery-assurance test snapshot before parallel async-control work reached
  237/237 passing.
- Focused project-convention and adopted-delivery tests: 70/70 passed.
  The separate protocol snapshot remains blocked because it does not yet include
  the concurrently added `sg_work_item_*` tools.
- `npm run lint`: passed with both change sets present.
- Scoped Prettier check for this change set: passed. The repository-wide
  `npm run format:check` is blocked by unrelated unformatted async-control
  files.
- `npm run pack:check`: passed using a workspace-local npm cache.
- `node scripts/codex-plugin-smoke.mjs`: passed stdio diagnostics.

## Adopted Closure and Project Conventions

The adopted quality path now executes ProjectProfile commands at the fixed
integration commit and compares stable failure signatures with the accepted
Baseline. Unchanged known failures remain explicit; new failures and
environment drift block the change.

Generated projects now support validated company/business namespaces:

```text
company acme + business orders -> com.acme.orders
```

The generator writes the matching Java source tree, Maven coordinates and
frontend package name, rejects invalid namespace segments, adds Chinese source
comments, and never creates a new `com.example.*` source tree. Frontend text is
provided through Vue I18n with `zh-CN` as the default and `en-US` as a runtime
alternative.

Real template matrix:

`docs/verification/codex-delivery-assurance/20261022-conventions-matrix-v4/matrix.json`

All four presets passed:

- backend Maven verification and tests;
- frontend lockfile install, build, test, lint and format;
- backend HTTP CRUD and restart persistence;
- generated frontend tests, including Chinese default locale and runtime
  English switching.

### Real adopted-project verification

The isolated adopted pilot ran against the real
`gheinze/springboot-vuejs` clone. The verifier:

- created a temporary Git worktree at the recorded commit;
- executed the ProjectProfile install/build/test/lint commands;
- matched two unchanged baseline known failures;
- blocked three new failures caused by the current lockfile/JDK environment;
- preserved the main worktree and removed the temporary worktree afterwards.

This is a correct fail-closed result, not an adopted-path bypass. The command
outputs and new signatures remain in the execution report.

Summary evidence:
`docs/verification/codex-delivery-assurance/adopted-real-pilot-20261022.json`.

## Third-Party GitHub Adoption Pilot

Three independent Java/Vue repositories were cloned into Ubuntu 26.04 WSL1
ext4 workspaces and driven through Codex CLI 0.117 with the project-bound
SpecGate MCP server.

| Repository                                  | Commit    | Baseline                    | Result                    |
| ------------------------------------------- | --------- | --------------------------- | ------------------------- |
| `tibame201020/basic_vue_springboot_h2_otel` | `41359bd` | `baseline-47948e338599ac8f` | Adopted, `known-failures` |
| `61crossroad/vuejs-springboot-h2`           | `ff1bc1d` | `baseline-50ee88c0bd79e2c5` | Adopted, `known-failures` |
| `gheinze/springboot-vuejs`                  | `e556090` | `baseline-88be0ad767d70dfc` | Adopted, `known-failures` |

All three runs used `sg_project_status`, `sg_adopt_preview` and
`sg_adopt_apply` through the real Codex CLI MCP connection. The baseline call
returned without blocking, a detached worker continued execution, commands ran
in an isolated temporary Git worktree, stable SpecGate metadata was committed,
and each main worktree ended clean.

Known failures remain explicit rather than hidden. They include legacy
Mockito/JDK compatibility, TypeScript errors, stale lockfiles, missing frontend
tooling, and an unavailable Loki endpoint during backend tests.

The first baseline implementation ran commands in the main worktree and was
rejected because the WSL1 DrvFs environment could not chmod npm package
binaries and Maven could not create `target` files reliably. A later run found
that one repository deletes tracked generated frontend assets during its build.
The worktree was restored, and the product now runs each detached baseline in a
temporary worktree that is always removed.

## New Project Pilot

An empty workspace was created at
`/home/sc/specgate-pilots/new-java-vue-20261022` and driven through Codex CLI:

```text
sg_project_status
-> sg_init_preview (jdk21-boot3.5)
-> sg_init
-> real verifyProject
-> sg_project_finalize_new
-> sg_project_status
```

Result:

- Generated commit: `8c8f796a3e6bf492367b305a6d78e5b2f75ba072`
- Project mode: `new`
- Baseline: `baseline-37576ce08bfb4f77`, `green`
- Verification run: `2026-10-22T02-07-24-786Z-03b43110`
- Working tree after finalization: clean

The VM initially lacked the supported Node major version. The first
verification correctly recorded every stage as `not-run` and blocked. After
installing Node 22.12, the backend and frontend matrix ran to completion.
WSL1 cannot use Mockito's default self-attach mechanism, so verification used
the documented `mockito-core` JVM agent rather than changing project source.

## Real Java/Vue Matrix

Passing evidence:

`docs/verification/codex-delivery-assurance/20261022-matrix-network/matrix.json`

Presets passed:

- `jdk8-boot2.7`
- `jdk17-boot3.5`
- `jdk21-boot3.5`
- `jdk21-boot4.0`

Each preset executed backend Maven verification, frontend install, build, test,
lint and format checks, plus runtime HTTP CRUD and restart persistence checks.

The first matrix run is preserved at:

`docs/verification/codex-delivery-assurance/20261022-matrix/matrix.json`

That run was blocked by sandbox network denial while resolving the Spring Boot
parent POM. It is retained as failed evidence and is not counted as a product
failure.

## Real Project Pilot

Passing evidence:

`docs/verification/codex-delivery-assurance/pilot-20261022-v10/pilot.json`

- 3 complete generated Java/Vue applications.
- 9 actual source changes: 3 features, 3 modifies and 3 fixes.
- 9 pre-implementation red test observations.
- 9 accepted DeliveryRecords with local tags and customer packs.
- Every change executed Maven tests, frontend Vitest and frontend build.
- Every project completed the full runtime verification matrix after its three
  changes.
- Average change duration: 26.7 seconds after project readiness.
- Project setup plus complete initial verification: 49.7–57.5 seconds per
  project.

The pilot preserves earlier failed harness and compatibility runs as separate
evidence directories. Only `pilot-20261022-v10` is counted as the passing pilot.

## Unexecuted Checks

- No production deployment or production database rollback was attempted.
- Native interactive H1/H3 elicitation was not available in `codex exec`.
  Approval authority remains fail-closed; no approval was fabricated.
- The complete feature/modify/fix and DeliveryRecord matrix uses the
  generated-project harness. Third-party coverage proves real repository
  discovery, adoption, isolated baseline execution and metadata delivery.
- WSL2 was unavailable. Ubuntu 26.04 WSL1 was used; DrvFs `/mnt/e` was rejected
  for builds because of file-operation limitations.

The real pilot remains the final product-value gate before declaring the full
MVP complete.
