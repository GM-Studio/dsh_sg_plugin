---
name: sg-codex
description: Use for SpecGate initialization, change delivery, native Codex subagents, isolated worktrees, quality gates, formatting, Review, recovery and archive.
---

# SpecGate Codex workflow

Use the packaged `specgate` MCP tools as the authoritative state and evidence
layer. Do not write `.specgate/codex/state.json`, event logs or frozen hashes
manually.

## Host boundary

Codex owns subagent creation. MCP cannot spawn a Codex subagent by itself. The
main Codex agent MUST call the phase-specific MCP prepare tool, spawn the
specific project agents requested below, wait for their results, and then call
the MCP validation/advance tool. Never perform a role in the main thread and
label it as a subagent result.

Project setup installs these agents under `.codex/agents/`:

- `specgate_test_designer`
- `specgate_frontend`
- `specgate_backend`
- `specgate_tester`
- `specgate_formatter`
- `specgate_reviewer`

If the agents are missing, stop and ask the user to run the plugin's
`scripts/codex-source-setup.mjs --project <project>` command. Do not silently
fall back to serial main-thread simulation.

## Required order

1. Initialize and verify:
   - `sg_init_preview`
   - `sg_init`
   - `sg_verify`
   - Do not start a change until verification is current.
2. Requirements:
   - `sg_change_add`
   - `sg_change_propose`
   - `sg_change_critique`
   - `sg_request_h1`
   - A missing trusted approval leaves `H1_PENDING`. Never fabricate approval.
3. Freeze plan:
   - `sg_plan_generate`
   - `sg_plan_freeze_contracts`
4. Test-first handoff:
   - `sg_test_design_prepare`
   - Spawn `specgate_test_designer` with the returned worktree, branch, plan,
     contract, model and exact manifest rules. `--tests` is the absolute test
     root that directly contains `runner.mjs`.
   - Wait for its commit.
   - `sg_test_design_freeze`; do not accept model-supplied test success.
5. Development:
   - `sg_development_prepare`
   - Spawn `specgate_frontend` and `specgate_backend` at the SAME TIME, in the
     returned independent worktrees. They must not touch tests or each other's
     tree.
   - Wait for both. Then call `sg_development_run`, which validates commits,
     paths and ancestry before sequential integration merges.
6. Test Agent:
   - Spawn `specgate_tester` with the current state version and integration/test
     worktrees.
   - The Tester calls `sg_quality_run`; frozen cases must all pass with real
     command logs and Java/Vue verification.
   - If the failure is confined to frozen test formatting or the runner
     contract, return it to `specgate_test_designer`; use
     `sg_test_replace_assets` to preserve v1 and record a versioned v2. Do not
     send test-only defects to product developers.
   - If quality fails, call `sg_development_repair`, spawn the owning
     frontend/backend agents in the returned round worktrees with the exact
     defects, then repeat development, testing, formatting and Review.
7. Formatter Agent:
   - Only after quality passes, spawn `specgate_formatter`.
   - The Formatter calls `sg_format_run`. It runs in the dedicated format
     worktree and may change only files changed by the change. Test files are
     immutable.
8. Reviewer Agent:
   - Only after formatting merges, spawn `specgate_reviewer`.
   - It calls `sg_review_prepare`, inspects the fixed integration commit
     read-only, then submits `sg_review_run` with a structured report.
9. Rework:
   - If Review returns a blocking result, immediately call
     `sg_development_rework`.
   - Spawn `specgate_frontend` and `specgate_backend` concurrently with the
     returned round-specific worktrees and the exact Review findings.
   - Repeat `sg_development_run -> sg_quality_run -> sg_format_run ->
     sg_review_prepare/run` until the Review passes or the retry ceiling blocks.
10. H3 and archive:
    - Request H3 through the native user-visible approval channel.
    - Run archive only after a consumed H3 approval. Never force push or retry a
      failed push automatically.

## Evidence rules

- Link every report to a fixed commit and content hash.
- Treat missing commands, skips, generated-only reports, timeouts and cancelled
  runs as not passed.
- Preserve worktrees, branches, logs and failed Review reports.
- A subagent's prose is only a summary. MCP-owned Git and command evidence decide
  whether the phase advances.
- Test replacements always preserve the previous immutable manifest and require
  a bounded reason; never edit a frozen test path in place.
- Keep main, review and test worktrees clean. Never bypass a rejected role path.
