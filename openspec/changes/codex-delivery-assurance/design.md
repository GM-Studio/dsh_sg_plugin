# Delivery Assurance Design

## Boundaries

Codex owns code understanding, implementation, command execution, and available
project agents. SpecGate owns project readiness, contracts, evidence
sufficiency, delivery records, and incremental lineage.

The active-change state remains authoritative in
`src/codex/state-machine.js`. Project readiness and accepted delivery history
are versioned artifacts outside that state and do not use the legacy
Codex-core workflow state.

## Project Model

`src/codex/project-model.js` provides pure validation and state rules for:

- ProjectProfile
- ProjectBaseline
- ChangeContract
- Evidence
- VerificationAssessment
- DeliveryRecord

`src/codex/core/artifact-store.js` owns safe project-relative immutable JSON
reads and writes, hashing, path boundaries, and overwrite refusal.

## Entry Modes

New projects reuse the existing template generator and Java/Vue verifier. A
profile and baseline are written only after complete verification.

Existing projects use a bounded read-only discovery service. Adoption preview,
explicit dirty-worktree commit, profile application, and baseline execution are
separate operations. A dirty commit requires trusted native user approval and
an unchanged approved file-set hash. No `git add -A` path is allowed.

## Change and Execution

`sg_change` becomes the unified entry for feature, modify, and fix.
`sg_change_add` remains an alias for feature compatibility. H1 continues to bind
the immutable requirements hash and trusted user approval.

Plans default to serial execution. Existing contract, executable test,
implementation, integration, quality, and review evidence are retained where
useful, but unrelated sides are skipped rather than forced to create empty
commits.

## Verification

`environment-fingerprint.js` records runtime and tool versions without secret
values. `verification.js` records:

- risk and independence level;
- AC-to-evidence sufficiency;
- current commit and environment;
- flaky, skipped, retried, and not-run outcomes;
- required code review for high risk;
- final H3 decision.

Evidence must come from actual commands or observations. Agent summaries are
metadata only.

## Delivery

`delivery.js` creates the DeliveryRecord and local tag after H3, then generates
separate internal and customer packs. Delivery state distinguishes technical
verification, acceptance, push, and deployment.

Release reads the target branch from ProjectProfile. Push requires both a valid
remote URL and explicit `push=true`, and force push is forbidden.

## Incremental Delivery

`incremental.js` resolves an accepted parent Delivery, verifies its integrity
and project identity, analyzes the new ChangeContract, and records which ACs and
tests remain valid. Historical tests are versioned rather than overwritten.

## Safety and Failure

- Trusted approval remains server-owned.
- State mutation uses existing CAS rules.
- Artifact writes are immutable and hash-bound.
- Dirty-worktree commit and push require explicit approval.
- Failed worktrees, logs, reports, and branches are preserved.
- Exceptions retain `failed`, `timeout`, `cancelled`, `skipped`, or `not-run`.
