# Async Delivery Control Specification

## ADDED Requirements

### Requirement: Durable WorkItem

The system MUST persist a WorkItem and its execution history independently of
the MCP client, Web connection and Feishu client.

#### Scenario: Client disconnect

- GIVEN a WorkItem has an active ExecutionRun
- WHEN the MCP client, Web page and Feishu client disconnect
- THEN the supervisor continues or safely waits according to the durable state
- AND reconnecting does not create a new Change or duplicate side effect

### Requirement: Manual Release of Execution Resources

The supervisor MUST persist a checkpoint, create an AttentionRequest, release
the execution lease and enter `WAITING_FOR_USER` at a human decision boundary.

#### Scenario: H1 pending

- GIVEN a WorkItem reaches H1
- WHEN the checkpoint and AttentionRequest are durable
- THEN the Run enters `WAITING_FOR_USER`
- AND no model or command execution remains blocked on the approval

### Requirement: Automatic Resume

The supervisor MUST resume or create one new ExecutionRun after a valid
Decision and MUST NOT resume twice for the same Decision.

#### Scenario: Duplicate decision

- GIVEN a Decision has already been consumed
- WHEN the same callback or request is submitted again
- THEN no new execution starts
- AND the duplicate request is audited

### Requirement: Unified State Projection

Web, Feishu and MCP MUST project the same authoritative WorkItem revision and
MUST NOT maintain independent business state.

#### Scenario: Cross-surface decision

- GIVEN the same AttentionRequest is visible in Web and Feishu
- WHEN one surface completes a Decision
- THEN the other surface reports the request as decided or superseded

### Requirement: Web Management

The management UI MUST show actionable attention, cross-project health,
WorkItem and Run detail, AI role and phase, budget, commit, Evidence, Decision
and delivery lineage.

#### Scenario: Active Run inspection

- GIVEN an ExecutionRun is active
- WHEN an authorized user opens its detail
- THEN the user can inspect heartbeat, current phase, bounded command output,
  project, commit and remaining budget
- AND closing the page does not alter execution

### Requirement: Controlled Management

The management API MUST use GET for queries and POST for every mutation. It MUST
support only predefined actions and MUST NOT expose arbitrary shell or file
operations.

#### Scenario: Pause from Web

- GIVEN an authorized session and an active WorkItem
- WHEN a valid pause Decision is submitted
- THEN the WorkItem records the Decision and enters PAUSED
- AND the supervisor releases or stops execution safely

### Requirement: Minimal Attention Notification

Feishu MUST receive actionable notifications for human gates, unrecoverable
failures, offline or interrupted execution, exhausted budgets, customer
acceptance and final outcome. Routine progress MUST NOT notify.

#### Scenario: Normal implementation progress

- GIVEN AI is implementing and testing without a human gate
- WHEN internal phases change
- THEN no Feishu progress notification is sent

### Requirement: Notification Failure Isolation

Feishu delivery failure MUST NOT block execution or durable state changes.

#### Scenario: Feishu unavailable

- GIVEN Feishu is unreachable
- WHEN an AttentionRequest is created
- THEN the WorkItem and AttentionRequest remain durable
- AND the Outbox retries without changing business state
- AND Web reports the delivery failure

### Requirement: Secure Decision

A Decision MUST bind a trusted actor, authentication strength, WorkItem
revision, AttentionRequest revision, target artifact hash, idempotency key and
expiry.

#### Scenario: Stale link

- GIVEN a user opens an older AttentionRequest link
- WHEN the WorkItem revision has changed
- THEN the Decision is rejected
- AND the UI shows the latest revision and decision entry

### Requirement: High-Risk Confirmation

H1, H3, push, cancel and customer acceptance MUST require stronger
authentication than ordinary status queries.

#### Scenario: Missing step-up

- GIVEN a user has an ordinary management session
- WHEN the user attempts H3 approval without step-up authentication
- THEN the system rejects the Decision

### Requirement: Outcome Integrity

Outcome conclusions MUST be derived from Evidence and VerificationAssessment.
Model-generated text MUST NOT create a passed, deliverable or accepted fact.

#### Scenario: Summary conflicts with evidence

- GIVEN a model summary claims all acceptance criteria passed
- WHEN the stored VerificationAssessment contains an insufficient criterion
- THEN the Outcome reports insufficient evidence and marks the conflict

### Requirement: Delivery Lifecycle Separation

The system MUST distinguish technical verification, H3 release approval,
DeliveryRecord creation, customer acceptance, push and deployment.

#### Scenario: H3 approved but not delivered

- GIVEN H3 has passed
- WHEN the DeliveryRecord is created
- THEN customer acceptance remains false until an authorized acceptance event

### Requirement: Observable Recovery

The system MUST expose online, suspect, offline/interrupted, wait, retry and
recovery state and MUST reject operations that cannot be safely reconciled.

#### Scenario: Heartbeat timeout

- GIVEN an active Run has not updated heartbeat beyond the configured threshold
- WHEN the supervisor reconciles state
- THEN the Run becomes suspect and then OFFLINE or INTERRUPTED
- AND it is never projected as RUNNING

### Requirement: Portable Execution Boundary

The control plane MUST launch Codex with an explicit project-bound tool
configuration and a bounded environment. It MUST NOT inherit unrelated host MCP
servers or transmit Feishu, MFA or management secrets to the child process.

#### Scenario: Move to another machine

- GIVEN the same SpecGate package and an authenticated Codex CLI on a supported
  Windows, macOS or Linux host
- WHEN the supervisor starts a WorkItem
- THEN it locates its own server and project without a repository-local
  absolute path
- AND it injects one SpecGate MCP server bound to that WorkItem's project
- AND an unrelated user MCP server is not started

#### Scenario: Blocked non-interactive execution

- GIVEN a WorkItem runs without a terminal
- WHEN Codex proposes a command requiring approval
- THEN the execution follows the configured non-interactive approval policy
- AND it never waits indefinitely for an unavailable terminal prompt

#### Scenario: Web project binding

- GIVEN a management daemon was started for one project
- WHEN a Web request includes another `projectRoot`
- THEN that client value is ignored
- AND a new WorkItem is bound only to the daemon's configured project

### Requirement: Delivery-Linked Acceptance

The system MUST expose `accept_delivery` only when a real schema 3
DeliveryRecord is hash-linked to the completed WorkItem.

#### Scenario: Control-only completion

- GIVEN the AI run completes without producing a DeliveryRecord
- WHEN the completion AttentionRequest is created
- THEN customer acceptance is not offered
- AND the WorkItem remains reviewable without claiming delivery acceptance

#### Scenario: Customer acceptance

- GIVEN a completion is linked to an unchanged DeliveryRecord hash
- WHEN a step-up `accept_delivery` Decision is submitted
- THEN an append-only customer-acceptance receipt is written
- AND the same delivery record is marked customer-accepted
- AND the Control WorkItem records the acceptance receipt and completes

#### Scenario: Delivery changed before acceptance

- GIVEN the linked DeliveryRecord hash no longer matches
- WHEN the user submits customer acceptance
- THEN no acceptance receipt or Control Decision is written

### Requirement: Notification Resolution

After an AttentionRequest is decided, superseded or expired, the system MUST
send one idempotent follow-up notification that marks the previous request as no
longer actionable.

#### Scenario: Decision made

- GIVEN an actionable Feishu card was delivered
- WHEN the same AttentionRequest is decided
- THEN one follow-up card states that it was handled
- AND duplicate daemon ticks do not send the follow-up again
- AND the original card explicitly states that it is no longer actionable

### Requirement: Portable Graceful Stop

The control daemon MUST provide a file-based graceful stop request that works
without Unix-only signal assumptions.

#### Scenario: Stop on Windows

- GIVEN a daemon is supervising an active Codex child on Windows
- WHEN the user runs the stop command
- THEN the daemon stops claiming WorkItems
- AND the active process tree is terminated within the shutdown bound
- AND durable WorkItem state remains available
