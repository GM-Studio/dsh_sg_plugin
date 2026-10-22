---
name: sg-codex
description: Use for SpecGate project readiness, existing-project adoption, change delivery, independent verification, DeliveryRecord, incremental redelivery, recovery and explicit archive.
---

# SpecGate Codex workflow

Use the packaged `specgate` MCP tools as the authoritative project, change,
evidence and delivery state layer. Do not write `.specgate/codex/state.json`,
event logs, frozen hashes or delivery records manually.

## Host boundary

Codex owns code understanding, file edits, command execution and project
subagents. SpecGate owns project readiness, acceptance contracts, evidence
sufficiency, DeliveryRecords and incremental lineage.

Project setup installs these agents under `.codex/agents/`:

- `specgate_test_designer`
- `specgate_frontend`
- `specgate_backend`
- `specgate_tester`
- `specgate_formatter`
- `specgate_reviewer`

If required agents are missing, stop and ask the user to run:

```text
node scripts/codex-source-setup.mjs --project <absolute-project-path>
```

Do not perform a requested subagent role in the main thread and label it as a
subagent result.

## Async control mode

When `SPECGATE_CONTROL_MODE=1`, the session is managed by the detached SpecGate
supervisor and `SPECGATE_WORK_ITEM_ID` identifies the durable WorkItem.

1. Read `sg_work_item_status` for the current WorkItem.
2. Use the same project, Change, evidence and delivery tools as interactive
   mode.
3. At H1 or H3, call the normal gate tool. A `WAITING_FOR_USER` result means the
   approval was durably queued.
4. Stop immediately after `WAITING_FOR_USER`. Do not retry the gate, invent
   approval, ask for routine progress confirmation or keep a connection open.
5. When the supervisor resumes the session after a Decision, re-read
   `sg_work_item_status` and `sg_state`, verify the current artifact/version and
   continue from the recorded gate.

The supervisor, not this Skill, owns heartbeat, lease and process recovery.

### Control modes

The control plane runs in one of two modes, chosen per project and defaulting to
`aggregate`:

- `aggregate` (default): one shared control home and management port serve every
  registered project, and the console shows the cross-project attention queue.
- `isolated`: the project gets its own control home under
  `<controlRoot>/projects/<projectId>` and a deterministic per-project
  management port, so its daemon, queue and state stay separate.

### Host capability probe and degradation

`doctor` (`node scripts/specgate-control.mjs doctor`) probes the host Codex
read-only and reports each capability state as `available`, `missing` or
`not-probed`, together with the resulting mode, the degradations, the blocked
features and a version-gate hint. Never assume a capability is usable:

- `exec --json` is required; when it is missing or unconfirmed, delivery cannot
  start.
- A missing native plugin routes work through the project-level MCP + skill path
  (`project-mcp-skill`).
- Missing native subagents block subagent dispatch; do not simulate the roles in
  the main thread.
- Missing MCP elicitation leaves interactive gates pending rather than
  fabricating an answer.
- A `not-probed` capability is treated as unavailable until it is confirmed.

## 1. Establish project readiness

Read `sg_project_status` first.

### Existing project

1. Run `sg_adopt_preview`.
2. If the preview is dirty, show the exact file list and proposed commit.
3. Run `sg_adopt_commit_dirty` only after the native user approves the bound
   preview and exact paths.
4. Run `sg_adopt_apply` with the preview hash.
5. Treat `sg_adopt_apply` as the start of a detached baseline job. Poll
   `sg_project_status` until `projectReady` is true or `baselineRun.status` is
   `failed`. The worker survives a Codex turn ending.
6. Do not run `sg_init` on an existing project.

The baseline runs in a temporary Git worktree. Build commands may create or
delete files there without changing the main worktree. The worker removes the
temporary worktree after success or failure and clears successful job state.

### New project

1. Run `sg_init_preview` with explicit lowercase `company` and `business`
   values. The generated Java base package is `com.<company>.<business>`.
2. Run `sg_init` with the current preview hash and the same values.
3. Run `sg_verify`.
4. Run `sg_project_finalize_new` only after verification succeeds.
5. `sg_project_finalize_new` commits only stable ProjectProfile and Baseline
   metadata with explicit paths. Runtime evidence remains ignored.

Generation alone is not verification. Do not start a change until
`sg_project_status` reports a ready ProjectProfile and Baseline.

For every generated or changed source file:

- Place backend code under the configured package and source directory.
- Never add new code under `com.example.*`.
- Follow the frozen style examples in `.specgate/examples/`.
- Add Chinese comments to Java, TypeScript and Vue source.
- Use frontend i18n keys for display text. `zh-CN` is the default and `en-US`
  must remain supported.

### Generated stack and admin scaffold

`sg_init` generates a Java/Vue management scaffold, not a bare skeleton. Treat
the generated code as the reference implementation for the stack:

- Backend admin modules live under `com.<company>.<business>.sys` for `users`,
  `roles`, `departments`, `menus`, `audits` (read-only) and `dashboard`, routed
  under `/api/sys/**`.
- The `users` and `roles` modules provide CSV import/export (`/import`,
  `/import/validate`, `/import/template`, `/export`) with bounded row and byte
  limits.
- The frontend ships matching `views/sys/*` pages, an `api/sys.ts` client,
  router and sidebar entries and `zh-CN`/`en-US` i18n keys.
- `docs/style.md` in the generated project is the enforceable style baseline:
  follow it, and expect Review to report any unjustified deviation from it.
- `README.md` requires reading `docs/style.md` before changing the project;
  compliance is judged against the generated scaffold, not a prose summary.

## 2. Confirm the change contract

Use `sg_change` with:

- `request`
- `type`: `feature`, `modify` or `fix`
- type-specific `details`
- optional `parentDeliveryId` (with a required `impact` object) for customer
  feedback on an accepted delivery

`sg_change_add` remains a feature-compatible alias.

Then:

1. `sg_change_propose`
2. `sg_change_questions` only for unresolved blocking questions
3. `sg_change_critique`
4. `sg_request_h1`

A missing trusted approval leaves `H1_PENDING`. Never fabricate approval.
In async control mode, a durable AttentionRequest may be created and the
supervisor will release the execution lease.

## 3. Freeze plan and tests

1. `sg_plan_generate`
2. `sg_plan_freeze_contracts`
3. `sg_test_design_prepare`
4. Spawn `specgate_test_designer` in the returned worktree with the frozen
   contract, model and exact manifest instructions.
5. Wait for its commit, then call `sg_test_design_freeze`.

Do not accept model-supplied test success as frozen evidence.

## 4. Implement serially

1. Run `sg_development_prepare`.
2. Spawn only the frontend implementation agent if the plan requires frontend.
3. Wait for it to commit.
4. Spawn only the backend implementation agent if the plan requires backend.
5. Wait for it to commit.
6. Call `sg_development_run` to validate commits, paths, ancestry and sequential
   integration.

Never spawn frontend and backend implementation at the same time in the MVP.
Never let an implementation agent edit frozen tests or another role's tree.

## 5. Verify independently

Spawn `specgate_tester` only after integration. Give it a clean verification
context with:

- the current expected version;
- the fixed integration and test worktrees;
- the frozen AC and test manifest;
- no implementation-agent self-assessment as proof.

The Tester calls `sg_quality_run`.

Requirements:

- every frozen case executes and passes;
- adopted projects verify through their ProjectProfile commands;
- unchanged baseline known failures remain explicit and new failures block;
- command logs and runtime evidence bind to the current commit;
- skips, timeouts, cancellations and not-run checks remain explicit;
- flaky retries remain visible;
- Red-risk changes still require fixed-commit Review.

If quality fails, call `sg_development_repair`, spawn only the owning
implementation agent in its new round worktree, then repeat testing,
formatting and Review.

## 6. Format and Review

1. After quality passes, spawn `specgate_formatter`.
2. The Formatter calls `sg_format_run`.
3. After formatting merges, spawn `specgate_reviewer`.
4. The Reviewer calls `sg_review_prepare`, inspects the fixed integration commit
   read-only and submits `sg_review_run`.

Blocking Review findings return to the owning implementation agent through
`sg_development_rework`. Do not let the Reviewer edit code.

## 7. Accept and deliver

Request H3 through the native user approval channel.
In async control mode, the same request creates a durable AttentionRequest and
returns `WAITING_FOR_USER`; stop rather than bypassing it.

After a consumed H3 approval:

- `sg_release_preview` shows the exact commit, files, evidence and delivery
  preview.
- `sg_release_archive` performs the local merge and archive.
- Push remains disabled unless the user explicitly calls the tool with
  `push: true`.
- A remote URL alone never authorizes a push.
- Force push is forbidden.

For projects with a ProjectProfile, archive produces:

- an immutable DeliveryRecord;
- a local delivery tag;
- an internal engineering pack;
- a customer-readable delivery pack.

Do not treat technical verification, customer acceptance, push and deployment
as the same state.

## 8. Incremental redelivery

When a customer responds to an accepted delivery:

1. Read the parent DeliveryRecord.
2. Create a new `sg_change` with `parentDeliveryId` naming that accepted
   delivery, plus an `impact` object.
3. Set `impact.affectedAcIds` to the accepted parent criteria this change
   affects (required and non-empty), and `impact.reusedAcIds` to the affected
   criteria whose historical verification you reuse; reused IDs must be affected
   and accepted by the parent.
4. Unknown or inconsistent acceptance-criterion references are rejected at
   intake, and an `impact` is required whenever a `parentDeliveryId` is given.
5. Run targeted regression plus required historical regression.
6. Generate a new DeliveryRecord without overwriting the parent.

## Evidence rules

- Link every report to a fixed commit and content hash.
- Treat missing commands, skips, generated-only reports, timeouts and cancelled
  runs as not passed.
- Preserve worktrees, branches, logs and failed Review reports.
- A subagent's prose is only a summary.
- MCP-owned Git and command evidence decide whether a phase advances.
- Test replacements preserve the previous immutable manifest and require a
  bounded reason.
- Keep the main, review and test worktrees clean.
