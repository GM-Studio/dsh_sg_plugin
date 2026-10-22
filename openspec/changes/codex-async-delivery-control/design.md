# Async Delivery Control Design

## Boundaries

The existing `src/codex/state-machine.js` remains the authority for one active
Change. The new control plane owns WorkItem orchestration, ExecutionRuns,
AttentionRequests, Decisions, Notification Outbox and Web projections. It stores
references and hashes for ChangeContract, Evidence, VerificationAssessment and
DeliveryRecord rather than copying those objects.

## Control Store

The control store is a single-user append-only event log with a replaceable
snapshot. Events are canonical JSON with a previous-event hash. Reads verify the
complete chain. Mutations acquire a filesystem lock and compare the expected
version. The default location is beneath the Codex user state directory and can
be overridden for tests. It is never placed in the product project repository.

The store has one project registry and WorkItems across projects. Project
evidence remains in each project's `.specgate` tree.

## Domain State

Business milestone, execution state, host health and attention state are
orthogonal fields. A user-visible status is a pure projection and cannot become
an alternative authority.

Human decisions stop at a stable boundary:

```text
RUNNING -> checkpoint -> WAITING_FOR_USER -> release lease
Decision consumed -> QUEUED -> new or resumed ExecutionRun
```

## Supervisor

The supervisor is a detached local process, not part of the MCP stdio server.
It leases projects and WorkItems, starts the stable `codex exec --json` command,
persists bounded events and heartbeat, and resumes with
`codex exec resume <session-id>`. The adapter is replaceable so tests can use a
deterministic fake.

A WorkItem's prompt instructs Codex to use the copied SpecGate workflow. The
supervisor treats model prose as metadata. Existing SpecGate tools remain the
authority for project changes and evidence.

The child Codex process receives an explicit, bounded environment and a
single project-bound SpecGate MCP server. It does not inherit the host user's
other MCP servers or control-plane secrets. CLI command and state directory can
be overridden for portable installations. The same launch contract must work
on Windows, macOS and Linux.

## Web Management

The management server uses Node HTTP APIs and static Web assets. It binds to
localhost by default. Browser access is exchanged from a one-time pairing token
into an HttpOnly SameSite session; mutations require a session CSRF value.
Status queries use GET, every mutation uses POST, and update/delete identifiers
remain in JSON bodies.

The UI renders only the control projection and never writes project files.
Management actions enter the shared Decision Service.

## Feishu

The first adapter uses a configured Feishu webhook for interactive-card
notifications. Buttons open authenticated management links. A webhook bot is
not treated as an identity or approval authority. A later app callback adapter
can be added without changing AttentionRequest or Decision semantics.

An Outbox makes delivery at least once. Unique notification IDs, Decision
idempotency keys and state CAS make business effects exactly once.

Generic webhook bots cannot mutate a previously sent card. After a Decision or
supersession, the Outbox therefore sends an idempotent follow-up card marking
the earlier request as handled or invalid and linking to current state.

## Decision Security

Every Decision includes an idempotency key, expected WorkItem version,
AttentionRequest revision and action-specific binding. H1/H3, push, cancel and
customer acceptance require an HMAC-based TOTP step-up code in addition to the
local management session. Rejected or duplicate attempts are audited.

## Delivery Integrity

New DeliveryRecords use schema 3 and reference ChangeContract,
VerificationAssessment, H3 approval, artifact and pack hashes, known issues and
customer acceptance. Schema 2 records remain readable and immutable.

Completion may expose `accept_delivery` only after the supervisor has discovered
and hash-linked a real schema 3 DeliveryRecord. Customer acceptance validates
the linked record again, writes the append-only customer-acceptance receipt,
then consumes the Control Decision. A retry can reuse the identical acceptance
receipt but cannot accept a different record or actor.

## Failure Model

- MCP client shutdown does not stop the supervisor.
- A stale lease is recoverable only when the old owner is demonstrably dead or
  the lease has expired.
- A crash before a durable event is retryable.
- A crash after a durable event is recovered without repeating the effect.
- Notification failures remain pending in the Outbox.
- Unknown external side-effect outcomes become INTERRUPTED, never passed.
- Daemon stop is a durable local request followed by bounded process-tree
  termination; a platform signal alone is not the only stop mechanism.
