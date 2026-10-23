# Tasks

Status: core implementation, focused regressions and real dual-platform command
acceptance passed. Native Codex session acceptance is not complete.

- [x] 1. Clarify and approve the functional scope, non-functional constraints,
      platform matrix, domestic mirror policy and real acceptance environment.
- [x] 2. Record the approved requirements and OpenSpec change artifacts.
- [x] 2a. Align the confirmed in-session preflight, reuse, on-demand installation
      and mandatory workflow gate across the requirements and OpenSpec files.
- [x] 2b. Remove external scripts, platform bootstrap entry points and full-setup
      mode from scope; specify in-session runtime recovery instead.
- [x] 2c. Record the four task Skills, shared router, compatibility alias,
      read-only status, task-control ownership and acceptance scenarios.
- [x] 3. Audit existing uncommitted installer prototypes against the approved
      requirements without overwriting unrelated user work.
- [x] 4. Add failing tests for bounded discovery, reuse, install planning,
      multi-JDK coexistence, mirror isolation, integrity failure, idempotency,
      structured reporting, temporary cleanup, stack-scoped missing tools and
      refusal to enter workflows before readiness.
- [x] 4a. Add focused tests for entry routing, read-only status on incomplete
      environments, project/env handoff, alias dispatch and task-control gates.
- [x] 5. Implement the shared in-session environment core, with `$sg-codex-env`
      as the entry and `$sg-codex` using the same gate. Cover missing Node recovery
      coordinated by the loaded Skill and MCP reconnection inside Codex.
- [x] 6. Implement pinned component metadata, domestic/official/custom source
      selection and checksum or signature verification.
- [ ] 7. Implement safe environment persistence, Codex readiness layers and
      SpecGate plugin or project MCP + Skill readiness checks. Bind gate results
      to the project, stack and tool fingerprint and recheck changed inputs.
- [x] 8. Add the env/project/change/status Skills and reduce `$sg-codex` to
      shared navigation; retain `$sg-codex-setup` as a preparation alias.
- [x] 9. Wire status aggregation through existing read-only project/change/
      WorkItem sources and keep mutations within their explicit task entries.
- [x] 10. Align plugin onboarding metadata, Skill UI metadata, generated project
      Skill copies and user documentation. Check optional command-menu parity.
- [x] 11. Document check/install modes, permissions, mirrors, proxies,
      in-session recovery and manual Codex authentication, with no external
      installation scripts or full-toolchain entry point.
- [x] 12. Run focused tests, `npm test`, `npm run lint`,
      `npm run format:check`, `npm run pack:check` and plugin smoke.
- [ ] 13. Run the first-install, failure, cleanup and idempotent-rerun scenarios
      through the in-session Skill on real supported Windows, including stack
      changes, unneeded-JDK omission and blocked-workflow scenarios.
- [ ] 14. Run the same scenarios plus the Java/Vue/React matrix in the VMware
      Workstation Ubuntu VM against the same Git commit.
- [ ] 15. Verify AC-012 through AC-014, record actual entry/alias/control results
      and any unexecuted platform variants or risks; mark the change verified
      only when required Windows and Ubuntu evidence passes.

## Evidence and remaining acceptance

- Focused regression: 47 passed. Windows and VMware Ubuntu frozen-snapshot
  repository checks: 473 passed, 0 failed, 1 skipped on each platform; lint,
  formatting and package dry-run exited 0 on each platform.
- Each platform passed all six JDK 8/17/21 × Vue/React combinations, real pinned
  archive downloads/integrity checks, idempotent ready rerun and stdio smoke.
  Temporary toolchains and generated verification projects were cleaned.
  See `docs/verification/codex-environment-20261023/README.md` for the frozen
  source hash, post-freeze UI-only edits, raw reports and remaining conditions.
- New external installer prototypes were preserved as unrelated work but removed
  from package entry points. Only internal runtime modules and in-session Skills
  implement the approved user entry.
- Item 7 is partial: user-cache discovery, project/stack/tool fingerprints and
  fresh workflow checks are implemented. Codex authentication/capabilities are
  separate real diagnostic evidence; version probes must not certify native
  approval, subagent dispatch or full delivery readiness.
- Items 13–15 remain open until actual host-session invocation, missing-Node
  recovery/reconnection and native human approval/control interactions are
  exercised. Command-level matrix acceptance is not a substitute.
- User confirmed host-driven Linux execution on 2026-10-23: Codex authentication
  stays on Windows, and existing VMware Guest Tools executes commands in Ubuntu.
  The fresh guest stdio smoke passed with `platform=linux`, exit 0 and temporary
  project cleanup. No guest login is required for this selected mode; native
  Ubuntu CLI/session acceptance is deferred, not passed. No credentials are
  copied and no new listeners or SSH services are configured.
- The existing read-only help-surface capability
  probes do not advertise elicitation on either host; actual peer support still
  requires a host-session test, not a guessed pass/fail from CLI version.
- Evidence was generated before committing. Both command runs use the same
  frozen source hash, not a newly committed release. The same-Git-commit release
  criterion remains open. The user subsequently authorized commit and push;
  this does not turn pending acceptance items into passed results.
