# Codex Async Delivery Control

## Why

SpecGate already verifies project readiness, accepted changes, Evidence,
VerificationAssessment, DeliveryRecords and incremental delivery. The current
runtime is still bound to the MCP stdio session, and `sg_pause`, `sg_resume` and
decision gates do not provide a durable asynchronous control plane.

A solo builder needs to submit work, leave the Codex desktop app, receive only
actionable Feishu notifications, make a secure asynchronous decision, and have
the existing Codex session resume without manually orchestrating internal
agents.

## What Changes

- Add persistent WorkItem, ExecutionRun, AttentionRequest, Decision, Outcome and
  Notification Outbox records.
- Add an execution supervisor independent of MCP, Web and Feishu connections.
- Stop and release the execution lease at human decision boundaries, then resume
  after a validated decision.
- Add a local-only management API and responsive Web UI for cross-project
  monitoring, evidence drill-down and controlled management.
- Add Feishu webhook notification with secure decision links. Feishu remains a
  notification and entry surface, never the approval authority.
- Add durable high-risk decision validation with version, artifact and
  authentication-strength binding.
- Separate release approval, DeliveryRecord creation and customer acceptance.

## Impacted Capabilities

- Codex plugin runtime and package entry points.
- Project/change evidence and H1/H3 integration.
- DeliveryRecord and customer-facing delivery state.
- Local HTTP management API and Web assets.
- Feishu notification delivery.
- Tests, documentation and package contents.

## Non-Goals

- Arbitrary remote command execution or a Web IDE.
- Multiple message channels in the first implementation.
- Multi-tenant SaaS, complex RBAC or organization administration.
- Automatic H1/H3 approval.
- Production deployment or database rollback.
- A second evidence or DeliveryRecord store.
