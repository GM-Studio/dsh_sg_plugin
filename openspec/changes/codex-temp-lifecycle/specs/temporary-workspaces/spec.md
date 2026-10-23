# Temporary Workspaces

## ADDED Requirements

### Requirement: Bounded Temporary Workspace Lifetime

Every SpecGate test or verification workspace created in the operating-system
temporary directory MUST have an explicit owner and MUST be removed when that
operation finishes, whether it succeeds or fails.

#### Scenario: Successful operation

- GIVEN SpecGate creates a temporary workspace
- WHEN the operation completes successfully
- THEN the exact workspace is removed
- AND durable evidence written outside the workspace remains available

#### Scenario: Failed operation

- GIVEN SpecGate creates a temporary workspace
- WHEN the operation throws or returns a failure
- THEN cleanup still runs before control returns to the caller

### Requirement: Interrupted Test Recovery

Test execution MUST isolate all workers below one owned run directory and MUST
recover leftovers from interrupted earlier test runs without deleting unrelated
temporary content.

#### Scenario: Next run follows an interrupted run

- GIVEN a marked SpecGate test run directory belongs to a process that is no
  longer alive
- WHEN a new test invocation starts
- THEN the stale marked directory is removed
- AND unmarked directories and directories owned by live processes are retained

### Requirement: Cleanup Failures Are Observable

SpecGate MUST NOT silently claim successful temporary cleanup when the owned
directory could not be removed.

#### Scenario: Windows handle temporarily blocks deletion

- GIVEN cleanup initially receives a retryable filesystem error
- WHEN bounded retries are exhausted
- THEN the process emits a cleanup warning
- AND the marked directory remains eligible for recovery by a later run
