# SpecGate v2.1 Agent Orchestration Design

Status: Implemented in v2.1.0. The design was approved and implemented; see CHANGELOG and tests.
Date: 2026-10-18
Scope: `dsh-plugin-specgate` v2.1 orchestration; the v2.0 requirement model and test-agent model remain unchanged.

> **Historical design record (v2.1 era).** This document is kept as a record of a design that has since been
> superseded. The `sg-agent-*` Agent catalog it describes, the `G1`–`G11` gates (including `G7.5`), the
> `L1`/`L2`/`L3` classification, and the `/sg-*` command set were all removed or replaced in v3.6. The current
> surface is 5 slash commands (`/sg-init`, `/sg-change`, `/sg-status`, `/sg-context`, `/sg-skill`) and 6 tools
> (`sg_init`, `sg_change`, `sg_status`, `sg_skill`, `sg_run`, `sg_approve`), gates `H0`–`H3` plus `M1`/`M2`,
> and 22 skills that ship as plugin assets and are injected into subagent prompts — they are **not** registered
> in the DSH session skill catalog.

## 1. Goals

1. Infer a development role automatically when `tasks.md` omits `role:`.
2. Run a dedicated formatter/lint Agent in an independent worktree, touching only files changed by the change.
3. Run a dedicated reviewer Agent as a read-only, independent review.
4. Make `sg-apply` advance exactly one stage per invocation and stop at the corresponding gate.
5. Format before testing; review after testing.
6. Give every stage a hard budget of two repair rounds.
7. Keep the main Agent as the only merger; quality Agents never merge.
8. Stop and ask the user when role inference is uncertain instead of guessing.

## 2. Non-goals

- Do not change the v2 requirements/version-chain model.
- Do not allow an autonomous merge without gates.
- Do not let formatter or reviewer modify production code.
- Do not replace language-native formatters/linters with a built-in universal formatter.
- Do not silently skip G7.5 when no formatter/lint command exists.

## 3. Current baseline (v2.0)

| Capability | Status |
|---|---|
| Dev task waves by `[P]`/`depends` | Implemented |
| Per-task dev worktree | Implemented |
| Explicit `role:` | Implemented |
| Automatic role inference | Not implemented |
| Dedicated tester + independent test worktree | Implemented |
| Dedicated formatter/lint Agent | Not implemented |
| Independent read-only reviewer | Not implemented (only the reviewer asset exists) |
| Stage orchestration in `sg-apply` | Not implemented (dev only) |
| Test/review/format evidence gates | Partial: G5/G8 only |

## 4. Gate model

New order:

```text
G1 requirements
G2 classification
G3 requirement delta + version snapshot
G4 design
G5 test plan/cases freeze
G6 tasks
G7 implementation entry
G7.5 format/lint
G8 test execution
G9 code review + commit
G10 acceptance
G11 branch handling
```

| Gate | Name | Prerequisite | Required artifact |
|---|---|---|---|
| G7.5 | Format/Lint | G7 | `format-report.md` with pass and clean lint |
| G8 | Test execution | G7.5 | `test-report.md` with P0/P1/P2 and coverage pass |
| G9 | Code review + commit | G8 | `review-report.md` with pass and no blocking items |

- Formatting runs before tests, so G7.5 precedes G8.
- G9 is the review-and-commit gate; a blocking review item prevents confirmation.
- `GATE_ORDER`, `GATE_REQUIRES`, gate text, status/next-step and tests must be updated.
- Legacy v1 projects keep the old gate meanings and are not converted automatically.

## 5. Dynamic development-role inference

### 5.1 Scope

Only development-side tasks are inferred. Candidates:

```text
architect
ddd
developer
```

Quality roles are fixed by the orchestration stage:

```text
tester
formatter
reviewer
```

They are never inferred from a dev task.

### 5.2 Precedence

1. Explicit `role:` in `tasks.md` wins.
2. If absent, infer from task content.
3. If confidence is insufficient, stop before creating any Agent, list candidates and require the user to add `role:`.

### 5.3 Inputs and scoring

Inputs:

- Task id, title and body.
- Optional `files:` list in the task line.
- Referenced paths in the task text.
- Requirement/acceptance/design keywords for the change.
- Skill hints from requirements/design.
- Task `depends`/`[P]` are scheduling inputs, not role inputs.

Candidate signals:

| Role | Signals |
|---|---|
| architect | architecture, module, interface, boundary, system design, 架构, 模块, 接口, 边界, 系统设计 |
| ddd | domain, aggregate, bounded context, entity, value object, 领域, 聚合, 限界上下文, 实体, 值对象 |
| developer | implement, code, fix, feature, page, API, 实现, 开发, 修复, 功能, 页面, 接口 |

File signals:

| Path | Signal |
|---|---|
| `docs/`, `*.md` | architect/design leaning |
| `domain/`, `model/`, `aggregate/` | ddd |
| `src/`, `lib/`, `app/`, `tests/` | developer |

Confidence rule:

- Top score must be at least 2.
- Top score must exceed the second score by at least 1.
- Otherwise stop with:

```text
T1 cannot determine a role.
Candidates: architect (score), ddd (score), developer (score)
Add role: architect|ddd|developer to T1 in tasks.md
```

No Agent is created for an unresolved task.

### 5.4 `sg-apply --plan`

`--plan` prints:

- Inferred or explicit role per task.
- Confidence and reason.
- Low-confidence tasks.
- Waves and concurrency.
- Next stage and gate.

`--plan` never starts an Agent.

## 6. `sg-apply` stage machine

`sg-apply <change>` advances one stage per invocation:

```text
1. If open dev tasks:
     validate roles -> dispatch dev waves -> stop at G7.
2. Else if G7.5 not confirmed:
     run formatter Agent -> stop at G7.5.
3. Else if G8 not confirmed:
     run tester Agent -> stop at G8.
4. Else if G9 not confirmed:
     run reviewer Agent -> stop at G9.
5. Else:
     report that the change is ready for G10/G11.
```

Rules:

- Gate confirmation does not auto-start the next stage.
- The user runs `sg-apply` again after confirming the gate.
- Every stage is idempotent: valid reports are reused; completed tasks are skipped.
- `--plan` only prints the plan.
- `sg-apply` is exposed both as `/sg-apply` and as the `sg_apply` tool.
- `/sg-test` and `sg_test` remain for explicit test authoring/execution.
- The main Agent is the only merger.

## 7. Formatter Agent

New role:

```text
sg-agent-formatter
```

### 7.1 Worktree

```text
.specgate/worktrees/<change>/format
branch: specgate/<change>/format
```

Created from the integrated change commit after development.

### 7.2 Scope

Only files changed by the change:

```text
git diff --name-only <baseCommit>..HEAD
```

`baseCommit` is recorded in `change.json` at `/sg-change` time.

- No whole-repository formatting.
- No touching files outside the change diff.
- If no changed files, write a skipped report; G7.5 may pass only when lint has nothing to check.

### 7.3 Commands

Config keys in `.specgate/config.yaml`:

```yaml
formatCommand: "npx prettier --write {files}"
lintCommand: "npx eslint {files}"
```

- `{files}` is replaced by the changed-file list.
- If commands are absent, auto-detect `package.json` scripts named `format`, `lint`, `check`.
- If no command is available, stop G7.5 and require configuration; never silently skip.
- Commands must run only against the change's changed files.

### 7.4 Execution

1. Create format worktree.
2. Run formatter; allow auto-fix.
3. Run lint; lint errors that cannot be auto-fixed are blocking.
4. Commit formatting changes on the format branch.
5. Write `requirements/changes/<change>/format-report.md`:

```text
verdict: pass|fail
lint: pass|fail
changed_files:
  - ...
fixed_files:
  - ...
skipped: false
```

6. Main Agent merges the format branch if it has a commit.
7. G7.5 preflight requires verdict pass and lint pass.

### 7.5 Failure budget

- Maximum 2 formatter attempts per change.
- Formatting fixes do not need a dev round if formatter can fix them.
- Unfixable lint/source defects return to the developer.
- After 2 failures, block and preserve the worktree/report.

## 8. Tester integration

The existing v2 tester flow is reused, moved to G8 after G7.5:

1. G5 freezes tests.
2. G7 development.
3. G7.5 formatter.
4. G8 tester executes the frozen suite.
5. `test-report.md` must pass P0/P1/P2 and coverage.
6. Test failure returns to developer; max 2 attempts per stage.
7. Tester never modifies production code.

`sg-apply` invokes the tester at the G8 stage. `/sg-test` remains available for explicit plan/run.

## 9. Reviewer Agent

Reuse `sg-agent-reviewer` as an independent, read-only role.

### 9.1 Worktree

```text
.specgate/worktrees/<change>/review
branch: specgate/<change>/review
```

Created from the integrated commit after G8.

### 9.2 Review scope

- Diff from `baseCommit` to HEAD.
- Requirement IDs/version and change delta.
- Design, test cases, coverage and test report.
- Boundary conditions, error paths, security and regression risks.
- Test quality: whether tests actually cover the claimed behavior.

No production edits and no merge.

### 9.3 Report

`requirements/changes/<change>/review-report.md`:

```text
verdict: pass|fail
blocking:
  - id: RV-001
    file: ...
    reason: ...
non_blocking:
  - id: RV-002
    file: ...
    reason: ...
summary: ...
```

- Any blocking item prevents G9 confirmation.
- Non-blocking items are recorded and do not block.
- A failed review returns to the developer; after two rounds, block.

## 10. Failure/retry state

`.specgate/state/quality.json`:

```json
{
  "change": "add-login",
  "format": { "attempts": 0, "lastVerdict": null },
  "test": { "attempts": 0, "lastVerdict": null },
  "review": { "attempts": 0, "lastVerdict": null }
}
```

- Each stage counts separately.
- Max 2 failed attempts per stage.
- A pass resets the relevant stage attempt count.
- On block, worktrees and reports are preserved.
- The main Agent can clear the block only after user approval.

## 11. Worktrees and merge order

```text
dev:       specgate/<change>/<task>-dev
format:    specgate/<change>/format
test:      specgate/<change>/test
review:    specgate/<change>/review  (read-only)
```

Merge order:

1. Dev task branches → integration.
2. Format branch → integration.
3. Test branch (tests/cases only) already merged at G5; test run does not merge production.
4. Review branch has no production changes; report is copied back.
5. Main Agent commits/merges only after gates.

Conflict handling: stop, preserve worktrees/branches and report files.

## 12. Commands, tools and assets

New/changed:

```text
/sg-apply <change>            stage machine (dev → format → test → review)
sg_apply (new tool)           same stage machine for Agent use
/sg-test <change> plan|run    existing tester path
/sg-format <change>           optional explicit formatter rerun
/sg-review <change>           optional explicit reviewer rerun
```

Tools:

```text
sg_apply
sg_test
sg_format (optional)
sg_review (optional)
```

Agent assets:

```text
sg-agent-formatter.md / .zh.md
sg-agent-reviewer.md (existing)
sg-agent-tester.md (existing)
```

Total Agents: 11.

## 13. Compatibility

- v2.0 projects keep their requirement/test data.
- New G7.5 appears for v2 projects; G8/G9 meanings change.
- Existing confirmed G8/G9 markers are preserved with a warning; the user must explicitly reset/reconfirm for the new orchestration.
- Legacy v1 projects remain on the old gate model.
- Plugin version: 2.1.0.
- Docs and AGENTS instructions updated bilingually.

## 14. Tests and acceptance

New tests:

- Role inference: explicit, high confidence, low-confidence stop, file signals.
- Gate order: G7.5 before G8 before G9; prerequisites.
- Stage machine: dev → format → test → review; one stage per call.
- Formatter: changed files only, config commands, no-command stop, report validation, merge.
- Reviewer: read-only, blocking/non-blocking report, G9 preflight.
- Failure budget: two rounds then block.
- Worktree naming and cleanup.
- Legacy compatibility.
- Existing 99 tests remain green.

Acceptance:

1. Low-confidence task causes `sg-apply` to stop before creating an Agent.
2. Explicit `role:` always wins.
3. G7.5 cannot be confirmed without a passing format/lint report.
4. G8 cannot be confirmed without a passing test report.
5. G9 cannot be confirmed with a blocking review item.
6. Formatter only touches changed files.
7. Reviewer never edits production code.
8. `sg-apply` advances one stage, then stops at the gate.
9. All worktrees are independent; main Agent is the only merger.
10. Bilingual docs and full test suite pass.

## 15. Implementation plan (after approval)

1. Add `G7.5` to constants/gates/status/next-step.
2. Add role-inference module and task `files:` parsing.
3. Add formatter/reviewer dispatch modules and worktree/report handling.
4. Add `sg_apply` tool and stage state machine.
5. Add `sg-agent-formatter` asset and formatter/reviewer report templates.
6. Add `formatCommand`/`lintCommand`, quality state and failure budget.
7. Update AGENTS/docs/README/CHANGELOG for 2.1.0.
8. Add tests; run full suite; commit/push/tag.

No code changes are made until this design is approved.
