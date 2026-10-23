# Changelog

## Unreleased

- Add environment, project, change and read-only status task Skills behind the
  shared router, with setup alias compatibility and synchronized project copies.
- Add selected-stack environment preflight and installation with trusted consent,
  pinned official checksums, domestic mirrors, temporary configuration cleanup,
  and environment gates before generation and workflow execution.
- Aggregate status without starting a control runtime; exclude external installer
  prototypes from the package. Fix template formatting exposed by real matrix
  runs and bound the baseline worker test wait for slower virtual machines.

- Isolate all automated-test workers under one ownership-marked temporary root,
  clean it on normal, failing and signalled exits, recover interrupted leftovers
  on the next run, and always remove matrix/pilot workspaces after preserving
  their explicit evidence directories.
- Require an explicit absolute business-project path in the create-project form
  when the session directory is a SpecGate plugin directory; ordinary roots can
  still leave the path empty to reuse the current repository.
- Localize approval and clarification failure messages into Chinese with
  actionable recovery guidance; ordinary chat confirmation never counts as an
  H1/H3 approval.
- Bump the plugin version to 0.3.2 so hosts load a fresh cache instead of an
  old connection missing sg_request_h1 or trusted approval identity.
- Add a detached async supervisor with durable WorkItems, ExecutionRuns, leases,
  heartbeat and crash recovery.
- Add asynchronous H1/H3 AttentionRequests that resume the persisted Codex
  session after a trusted Decision.
- Add a local Web management UI with one-time pairing, CSRF and session security.
- Add Feishu interactive-card notifications with a durable Outbox, deduplication
  and exponential retry.
- Add TOTP step-up, Decision CAS, artifact binding and idempotency.
- Add DeliveryRecord schema 3 to separate H3 release approval from customer
  acceptance.
- Launch supervised Codex runs with only a project-bound SpecGate MCP and a
  bounded credential-safe environment.
- Link customer acceptance to the immutable DeliveryRecord receipt before
  consuming the Control Decision.
- Send idempotent Feishu handled/superseded follow-ups and provide a portable
  graceful daemon stop request.
- Add new-project and existing-project readiness with ProjectProfile and
  ProjectBaseline.
- Add explicit dirty-worktree baseline commits and known-failure baselines.
- Run adopted baselines in detached temporary worktrees, expose resumable
  progress, persist bounded command evidence, and clean successful run state.
- Discover lockfile-driven install commands before build and commit only stable
  SpecGate metadata with explicit paths.
- Verify adopted projects through ProjectProfile commands and compare stable
  failure signatures with the accepted Baseline.
- Generate `com.<company>.<business>` Java packages with Chinese source
  comments and a Chinese-first Vue I18n interface.
- Add unified `sg_change` for feature, modify and fix.
- Execute implementation serially and verify with environment fingerprints,
  evidence sufficiency and explicit flaky-test records.
- Add immutable DeliveryRecords, local tags, internal/customer packs,
  incremental redelivery and explicit non-force push.
- Add portable Codex source loading, project-scoped MCP, six real subagents and
  interactive H1/H3 approval.
- Add test-first handoff, parallel frontend/backend worktrees, quality,
  formatting, strict Review and automatic rework rounds.
- Add controlled frozen-test replacement and native runner compatibility.
- Move every shared runtime dependency under `src/codex/core/`.
- Remove legacy entry points, tests, assets and historical verification data
  unrelated to the Codex plugin.
- Select the stack at initialization and record it on `ProjectProfile` as the
  optional `frontendFramework` (`vue` | `react`) and `javaPreset`; later changes
  fail closed on a stack mismatch. React 18 stays fail-closed until its template
  lands.
- Generate a domain-neutral admin scaffold: users, roles, departments, menus, a
  read-only audit log and a dashboard under `/api/sys/**`, with pagination,
  filtering and batch actions.
- Add CSV import (validate, template, import) and export for users and roles.
- Ship the generated `docs/style.md` style baseline and make the Reviewer treat an
  unjustified deviation as a finding, blocking when it is substantive.
- Persist control-plane Web sessions and pairing tokens across a restart within
  their TTLs.
- Add a read-only, bounded host capability probe to `doctor` (`plugin`,
  `exec --json`, native subagents, elicitation) with an explicit degradation path
  and version-gate hint.
- Compute and persist incremental delivery impact (affected and reused acceptance
  criteria, invalidated tests) at the `sg_change` intake.
- Add `SUSPECT` to `HOST_HEALTH` for a host whose heartbeat has gone stale.
- Remove the dead `pushApproved` field from `ProjectProfile`.
- Add a multi-project registry, aggregate vs isolated control modes (with a
  `--mode` switch and a `register` command) and a cross-project portfolio view
  in the console.

## 0.3.0

- Codex Java/Vue initialization, verification and auditable workflow state.
