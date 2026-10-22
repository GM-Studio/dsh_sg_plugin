# Codex Delivery Assurance

## Why

Codex can increasingly implement and self-test software changes, but a solo
developer still lacks a durable answer to what was accepted, which evidence
supports it, what changed since the last delivery, and whether the result is
safe to hand to a client. Current SpecGate requires a generated Java/Vue
initialization report before a change, so existing client projects cannot use
the workflow without being recreated.

## What Changes

- Add a shared ProjectProfile and ProjectBaseline model for new and adopted
  Java/Vue projects.
- Add read-only existing-project discovery and explicit dirty-worktree baseline
  commits.
- Allow adopted baselines with known failures or partial verification while
  rejecting new regressions.
- Add feature, modify, and fix through one ChangeContract while preserving
  `sg_change_add` as a feature-compatible entry.
- Execute one implementation path serially and verify it from an independent
  perspective with AC-specific evidence.
- Record environment fingerprints, flaky-test outcomes, verification
  independence, and risk-appropriate code review.
- Produce immutable DeliveryRecords, local tags, internal evidence packs, and
  customer delivery packs.
- Link feedback to the previous accepted delivery and reuse or invalidate
  historical acceptance criteria and tests deliberately.
- Push only after H3 acceptance when a valid remote URL and explicit
  `push=true` are present.

## Impacted Capabilities

- Project initialization and verification.
- Change requirements and H1 approval.
- Plan, implementation, quality, review, and archive.
- Delivery history and incremental redelivery.
- Codex Skill, project agents, package manifests, and documentation.

## Non-Goals

- Replacing Codex's code generation, tool execution, or subagent runtime.
- Supporting arbitrary technology stacks in the first version.
- Parallel work-item DAGs, file-lock scheduling, or a self-built Harness.
- Production deployment or automatic production database rollback.
- Customer CRM, estimating, invoicing, or portfolio management.
