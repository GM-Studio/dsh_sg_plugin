# Tasks

- [x] 1. P0: freeze requirements and establish OpenSpec artifacts and verification
      baseline.
- [x] 2. P1: add failing tests for control domain state, projections, budget,
      attention revisions, decisions and durable event storage.
- [x] 3. P1: implement the control domain, append-only store and projection.
- [x] 4. P2: add failing tests for the Codex execution adapter, lease,
      heartbeat, wait boundary, recovery and automatic resume.
- [x] 5. P2: implement the detached supervisor and control CLI.
- [x] 6. P3: add failing tests for authenticated management queries, mutation
      methods, state freshness and no-write GET behavior.
- [x] 7. P3: implement the management API and responsive Web monitoring shell.
- [x] 8. P4: add failing tests for attention policy, notification Outbox,
      webhook rendering and failure isolation.
- [x] 9. P4: implement Feishu notification delivery and channel health.
- [x] 10. P5: add failing tests for Decision authorization, version binding,
      idempotency, stale links, step-up and automatic resume.
- [x] 11. P5: implement the shared Decision Service and Web management actions.
- [x] 12. P6: add failing tests for Outcome facts, DeliveryRecord schema 3 and
      customer-acceptance separation.
- [x] 13. P6: implement Outcome generation and DeliveryRecord evolution.
- [x] 14. P7: run focused suites, `npm test`, lint, format, package smoke and
      controlled integration scenarios.
- [x] 15. P7: perform code review, document residual risks and stop before
      commit, push or archive pending user confirmation.
- [x] 16. P8: add failing tests for a project-bound Codex MCP configuration,
      bounded child environment and command availability diagnostics.
- [x] 17. P8: implement portable Codex launch isolation and graceful daemon stop.
- [x] 18. P8: add failing tests for DeliveryRecord-linked customer acceptance
      and implement the two-store retry-safe acceptance flow.
- [x] 19. P8: add failing tests for Feishu resolution follow-ups and implement
      idempotent handled/superseded notices.
- [x] 20. P8: rerun the real Feishu and cross-environment smoke, update
      verification evidence, and commit only the async-control change set.
