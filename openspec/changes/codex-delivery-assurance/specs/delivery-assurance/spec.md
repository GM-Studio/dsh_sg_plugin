# Delivery Assurance Specification

## ADDED Requirements

### Requirement: Dual Project Entry

The system MUST prepare Java/Vue projects from either a new-project template or
an existing repository, and both modes MUST enter the same change and delivery
workflow after a valid ProjectBaseline exists.

#### Scenario: Adopt an existing project

- GIVEN an existing Java/Vue Git repository without SpecGate metadata
- WHEN the user requests a read-only adoption preview
- THEN the system reports stack, commands, tests, risks, and dirty files
- AND the preview performs no project write
- WHEN the user confirms the preview
- THEN the system creates a ProjectProfile and adopted ProjectBaseline without
  rewriting business files

#### Scenario: Reject unsupported stack

- GIVEN a repository that is not a supported Java/Vue project
- WHEN adoption or new-project baseline is requested
- THEN the system returns a stable unsupported-stack error
- AND no ProjectProfile or Baseline is written

### Requirement: Explicit Dirty Baseline Commit

The system MUST NOT commit a dirty existing worktree without an explicit
user-approved file set.

#### Scenario: Approved baseline commit

- GIVEN a dirty existing project
- WHEN the user approves the displayed file list and commit summary
- THEN the system stages only those explicit paths
- AND creates one baseline commit
- AND rescans the worktree before establishing the Baseline

#### Scenario: Preview drift

- GIVEN an approved dirty-worktree preview
- WHEN tracked or untracked files change before commit
- THEN the system refuses the commit
- AND preserves the original worktree

### Requirement: Baseline Delta

The system MUST distinguish pre-existing failures from failures introduced by
the current change.

#### Scenario: Known failure remains unchanged

- GIVEN an adopted Baseline with a stable known failure
- WHEN the current change leaves the failure signature unchanged
- THEN the failure remains recorded as pre-existing
- AND it does not become evidence that the change passed

#### Scenario: New failure blocks

- GIVEN any Baseline state
- WHEN verification finds a failure not present at Baseline
- THEN the verification decision is blocked

### Requirement: Unified Change Contract

The system MUST use one confirmed contract for feature, modify, and fix while
preserving the existing add-change entry as a feature alias.

#### Scenario: Fix contract

- GIVEN a bug report with observed and expected behavior
- WHEN a fix ChangeContract is proposed
- THEN it records observable acceptance criteria, assumptions, risks, and
  verification expectations
- AND H1 binds the contract hash

### Requirement: Serial Independent Verification

The default workflow MUST execute implementation serially and verify the fixed
commit from an independent context.

#### Scenario: Self-report is not evidence

- GIVEN an implementation agent reports that all work is complete
- WHEN no current-commit command or runtime evidence exists
- THEN the change cannot enter H3 pending

#### Scenario: High-risk evidence is insufficient alone

- GIVEN a Red-risk change with passing automated tests
- WHEN independent fixed-commit code and migration review is missing
- THEN verification remains blocked

### Requirement: Evidence Sufficiency

Every acceptance criterion MUST identify evidence sufficient for its observable
behavior, environment, and risk.

#### Scenario: Non-automated acceptance criterion

- GIVEN a visual or business-judgment criterion
- WHEN only an unrelated unit test passes
- THEN the criterion remains insufficiently verified
- AND manual demonstration or user acceptance is required

### Requirement: Environment Fingerprint

Verification evidence MUST record enough environment identity to determine
whether it may be reused.

#### Scenario: Major runtime changes

- GIVEN evidence passed on one major Java or Node runtime
- WHEN verification is considered under a different supported major runtime
- THEN the evidence requires reassessment

### Requirement: Test Stability

The system MUST preserve retries, skips, quarantines, and flaky outcomes and
MUST NOT convert them silently into stable passing evidence.

#### Scenario: Retry after failure

- GIVEN a test fails and then passes after a bounded retry
- WHEN verification is assessed
- THEN the result remains marked unstable
- AND every attempt remains auditable

### Requirement: Immutable Delivery Record

After H3 acceptance, the system MUST create an immutable DeliveryRecord and a
local tag bound to the accepted commit.

#### Scenario: Technical verification is not acceptance

- GIVEN all technical checks pass before H3
- WHEN the delivery state is inspected
- THEN the system reports technical verification only
- AND does not report the delivery as accepted

### Requirement: Separate Delivery Packs

The system MUST generate an internal engineering pack and a customer-readable
delivery pack that reference the same DeliveryRecord.

#### Scenario: Customer pack redaction

- GIVEN internal evidence containing absolute paths or sensitive logs
- WHEN the customer pack is generated
- THEN those values are removed or redacted

### Requirement: Explicit Push

The system MUST keep local delivery by default and push only after H3 when a
valid remote URL and explicit `push=true` are present.

#### Scenario: Remote URL alone

- GIVEN a project with a configured remote URL
- WHEN `push` is false or omitted
- THEN no push occurs
- AND the local delivery remains available

### Requirement: Incremental Redelivery

A customer feedback change MUST reference an accepted parent Delivery.

#### Scenario: Reuse and invalidate history

- GIVEN a feedback Change linked to an accepted Delivery
- WHEN impact analysis completes
- THEN historical acceptance criteria and tests are marked reused or invalidated
- AND required historical regression is executed
- AND a new DeliveryRecord is created without overwriting the parent

### Requirement: Attention Budget

The user-visible workflow MUST expose no more than four lifecycle states:
project ready, change confirmed, evidence ready, and delivery accepted.

#### Scenario: Normal change

- GIVEN a normal low-risk change
- WHEN the workflow completes
- THEN the user handles business confirmation and final acceptance
- AND does not manually orchestrate internal phase tools
