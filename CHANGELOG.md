# Changelog

## Unreleased

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

## 0.3.0

- Codex Java/Vue initialization, verification and auditable workflow state.
