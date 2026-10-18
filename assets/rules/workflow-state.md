# OpenSpec Workflow State Management Rules

> **Loading**: Materialized into `.specgate/templates/rules/` by `dsh-plugin-specgate`; DSH does not inject it automatically, so the AI must consult it proactively when handling the corresponding task (the core summary is inlined into `AGENTS.md`).
> **Trigger**: Active when the project has an `openspec/changes/` directory or the user issues commands such as `/status`, `/next-step`, or `/unblock`.

---

## Three-Layer State Model

- **Artifact state**: `not-started` / `drafting` / `completed` / `needs-revision`
- **Change state**: `proposing` / `specing` / `designing` / `tasking` / `implementing` / `testing` / `reviewing` / `ready-to-archive` / `archived`
- **Project state**: `idle` / `planning` / `developing` / `reviewing` / `completed`

State is **always inferred in real time from the latest file contents** (`always-refresh`) and never relies on a cache.

---

## State Query Rules

**Trigger**: the user enters `/status`, `/next-step`, or a session starts.

**Steps**:
1. Scan the `openspec/changes/` directory and list all Changes
2. For each Change, analyze artifact completeness:
   - `proposal.md`: does it contain `## Intent` and `## Scope`
   - `specs/*/spec.md`: does it contain `## Requirements` and `Scenario:`
   - `design.md`: does it contain `## Architecture`
   - `tasks.md`: the proportion of `- [x]`
3. Infer the three-layer state and output it

**Output format**:
```
📊 Project Status Overview

Project: {projectState} ({activeChanges} active Changes)

Change states:
  {changeDetails}

💡 Suggested actions:
  {suggestedActions}
```

---

## State Rollback Rules

**Trigger**: the user says "architecture adjustment", "requirements change", "redesign", "the approach is wrong", or "needs rollback".

**Steps**:
1. Identify the layer to roll back to:
   - Technical design problem → roll back to `designing`
   - Requirements specification problem → roll back to `specing`
   - Wrong direction → roll back to `proposing` or create a new Change
2. Tell the user which downstream artifacts are affected:
   - `designing` → affects tasks.md
   - `specing` → affects design.md and tasks.md
   - `proposing` → affects all downstream artifacts
3. Recommend an update order: rollback layer → dependent layers
4. Offer command suggestions:
   - Update design: `/sg-continue <change> design`
   - Update specs: `/sg-continue <change> specs`
   - Update proposal: `/sg-continue <change> proposal`

**Prohibited**:
- Prohibited: rolling back silently without telling the user about the impact
- Prohibited: skipping downstream artifact updates
- Prohibited: recommending edits to the original Change during a major direction shift (create a new Change instead)

---

## Conflict Avoidance (Relies on Git)

**Core principles**:
1. State is always based on the latest file contents
2. Use Git branches/merge to resolve conflicts
3. Do not implement your own locking (Git already provides a complete solution)

**Prohibited**:
- Prohibited: editing a Change directly on the master/main branch (use a `feat/` branch)
- Prohibited: skipping Git commits (commit frequently to keep history clear)
- Prohibited: manually modifying the state field in `workflow-state.yaml`
- Prohibited: implementing your own locking mechanism

**Best practices**:
- One Git branch per Change
- Commit when each phase is complete
- Resolve conflicts with the standard Git flow
- Merge into the main branch on archive

---

## 🔴 Incremental Modification Review Gate (Hard Rule)

> **Added on 2026-05-14** to fix the problem where the review gate was bypassed after incremental artifact modifications.
> **Companion**: DSH plugin `write/edit` guard + `.specgate/workflow-rules.yaml` `artifact-modification-review-gate`

**Trigger**: modifying any of the reviewed-and-approved files proposal / design / tasks / specs/*/spec.md.

**Mandatory behavior**:
1. Immediately invoke `sg-skill-critical-review` to run the incremental review
2. Present the review conclusions (challenge list + coverage check)
3. Wait for explicit user approval

**Prohibited**:
- Prohibited: deciding on your own that "the change is small so no review is needed"
- Prohibited: scanning and fixing on your own and then passing it through (even if you found and fixed problems, that does not replace the review)
- Prohibited: skipping silently (at minimum record a deviation in deviations.log)

**Standard route**: modify artifact → plugin invalidates downstream gates → incremental review → user approval → continue

**Exception**: Only purely formatting changes (no semantic change) or typo fixes (< 5 characters) may request a skip. A skip must be recorded as a deviation in `.specgate/deviations.log` and approved by the user.

**Why this rule is needed**: Current SpecGate gates are **point-in-time** (they fire only once, when all artifacts are first completed) and do not cover incremental modifications. This means that after modifying already-reviewed tasks/specs during the apply phase, nothing prevents the AI from skipping a second review. This rule upgrades the gate from a "one-time initial gate" to a "continuous gate".

---

## Parallel Multi-Change Rules

**Trigger**: more than one directory under `openspec/changes/`.

**Steps**:
1. List all active Changes and their states
2. Identify priorities:
   - Closest to completion (implementing with a high task completion rate)
   - Blocked (not updated for more than 2 days)
   - Just started (proposing/specing)
3. Focus strategy: advance the Change closest to completion first, and avoid frequent context switching
4. Detect resource conflicts: whether multiple Changes modify the same file

**Output format**:
```
📊 {count} Changes are in parallel development:

  - change-A    implementing  (progress: 6/8 tasks)
  🔄 change-B    specing       (waiting for requirements to be clarified)
  ⏳ change-C    proposing     (waiting for review)

Suggested strategy:
  1. Prioritize change-A (closest to completion)
  2. Continue change-B once its requirements are clear
  3. Wait for review feedback on change-C
```

---

## Blockage Detection Rules

**Trigger**: at session start or during a state query.

**Steps**:
1. Check every Change in `implementing` state:
   - Last activity time (file mtime)
   - Task completion progress (proportion of `- [x]` in `tasks.md`)
2. If not updated for more than 2 days and completion rate < 50%:
   - Proactively flag the blocked state
   - Ask whether the user has run into problems
   - Suggest the `/unblock` command

---

## Proactive Notifications at Key Points

| Scenario | Trigger |
|----------|---------|
| Session start | Read the workflow state and summarize current progress |
| Change state change | On detecting an artifact update, suggest the next step |
| Task completion | After marking a task `[x]`, suggest the next task |
| tasks.md completion | When all tasks are complete and the change size exceeds the threshold, suggest generating an Agent Brief |
| Artifact modification | When a reviewed-and-approved artifact is modified, prompt for an incremental review |
| Blockage detection | Proactively remind when inactive for more than 2 days |

**Notification format**:
```
💡 Suggested next step:
  Current: {currentState}
  Suggested: {nextAction}
  Command: {command}
```

---

## 🔴 TDD Execution Order Guidance

> **Added on 2026-05-14 to fix the failure of the TDD gate during the apply phase.**
> **Companion**: DSH plugin `write/edit` guard + `tdd-enforcement-gate`

**Core rule**: Regardless of the numbering order in tasks.md, within each Task group the **test subtasks must be executed before the corresponding implementation subtasks**.

### Understanding the Order in tasks.md Correctly

The linear numbering in tasks.md (5a.1 implementation → 5a.2 implementation → 5a.3 test) is for **organizational convenience**, not an **execution-order constraint**. The TDD execution order is:

```
For each Task group:
  1. Complete the test subtasks first (write tests → RED)
  2. Confirm the tests fail (verify RED is correct)
  3. Then complete the implementation subtasks (write code → GREEN)
  4. Confirm the tests pass
  5. Refactoring subtasks (REFACTOR)
```

### Prohibited

- Prohibited: executing strictly in tasks.md numbering order (implementation before tests)
- Prohibited: deferring all tests to the end and writing them in one batch
- Prohibited: skipping TDD on the excuse that "configuration files don't need tests"
- Prohibited: loading openspec-apply-change in the apply phase without checking whether the TDD Skill is loaded

### Correct Approach

> "Task 5a in tasks.md contains 5a.1 implementation, 5a.2 implementation, and 5a.3 test. Following the TDD rule, I'll run the 5a.3 test first (RED), confirm it fails, and then do the 5a.1-5a.2 implementation (GREEN)."

---

## Brief Integration

An **Agent Brief** is an intermediate artifact that complex changes must generate after tasks are complete and before critical review begins (see `gate-control.md` G6.5). It ensures the implementation phase does not miss key requirements information.

### Trigger

Once tasks.md is fully complete, evaluate the following metrics (any one triggers):
- Effort > 2 hours
- 2 or more modules
- More than 3 files
- Involves API/function signature changes

### 🔴 Brief Gate (Hard Rule)

> **Added on 2026-05-14** to fix the problem of missed Briefs.
> **Companion**: `sg-next` / DSH plugin hints + `.specgate/workflow-rules.yaml` `brief-generation-gate`

**Prohibited**:
- Prohibited: the AI deciding on its own that "no Brief is needed" and skipping it
- Prohibited: skipping the Brief without telling the user
- Prohibited: skipping the Brief without recording a deviation
- Prohibited: skipping it on the excuse that "the change is simple" (requires user confirmation)

**Correct**:
> "This change meets the conditions for Brief generation (more than 10 tasks / 2 or more modules / more than 3 files). Calling sg-skill-triage-brief to generate the Agent Brief…"

**Incorrect**:
> "This change isn't very complex, no Brief is needed — let's go straight to review."
> ↑ This is bypassing the Brief gate

### Decision Flow

```
tasks.md fully complete
  ↓
Evaluate change size
  ↓
Meets Brief conditions?
  ├─ Yes → Call sg-skill-triage-brief to generate brief.md
  │         ↓
  │       Brief generated + information-loss check
  │         ↓
  │       User confirmation
  │         ↓
  │       Proceed to critical-review (G7)
  │
  └─ No → Record the reason: "change size is small, skipping Brief"
            ↓
          Ask the user: "Do you confirm skipping?"
            ↓
          User confirms → Proceed to critical-review (G7)
```

### Brief Storage Location

`.specgate/briefs/<change-name>.md`

### Relationship to the OpenSpec Workflow

| Stage | OpenSpec artifact | Brief status |
|-------|-------------------|--------------|
| proposing | proposal.md | — |
| specing | specs/*.md | — |
| designing | design.md | — |
| tasking | tasks.md | — |
| **briefing** | **brief.md** | Generated (complex changes) |
| reviewing | audit-report.md | Confirmed (entering G7) |
| implementing | Code changes | Used as implementation reference |

### Prohibited

- Prohibited: complex changes skipping the Brief and going straight to critical-review
- Prohibited: skipping the Brief without telling the user
- Prohibited: skipping the Brief without recording a deviation
- Prohibited: the AI deciding on its own that "no Brief is needed" and skipping it (added 2026-05-14)

---

## Legacy Project Adoption Strategy

**Trigger**: the project has code but `openspec/specs/` is empty.

**Three strategies (user choice)**:

**Strategy 1: Incremental adoption (recommended)** — new features go through the full OpenSpec flow; existing features are left for now and specs accumulate gradually.

**Strategy 2: Baseline snapshot** — reverse-engineer a Spec baseline for the existing code (Change name: `baseline-current-state`); subsequent changes build on the baseline.

**Strategy 3: Hybrid mode** — put already-specified modules in `openspec/specs/` and modules pending specification in `openspec/legacy/`, and create `legacy/migration-plan.md`.

**Prohibited**:
- Prohibited: forcing a legacy project through a one-time full migration
- Prohibited: stopping new feature development during migration
- Prohibited: ignoring migration progress tracking

---

## New-Cycle Rules for Completed Projects

**Trigger**: Project state is `completed` and the user asks to "adjust a feature / add a new feature / handle a new requirement".

**Steps**:
1. Identify the intent and suggest a Change name:
   - Adjust an existing feature → `adjust-<feature>`
   - Add a new feature → `add-<feature>`
   - Refactor code → `refactor-<scope>`
   - Major version update → `v2.0-<description>`
2. Explain the state transition: `completed` → `planning` → `developing` → `completed`
3. Guide the user to `/sg-propose <change-name>`

**Important**: `completed` is not a terminal state but a temporary state meaning "no active work right now". A project can enter a new cycle from `completed` an unlimited number of times.

**Prohibited**:
- Prohibited: treating `completed` as a terminal state
- Prohibited: modifying code directly without creating a Change
- Prohibited: accumulating tasks across multiple versions without resetting

---

## Spec Review and Human Confirmation Gates

**Rule definitions**: per-artifact gate points, confirmation format, deviation handling → `gate-control.md`

**Responsibility of this file (workflow-state.md)**: tracking rules for artifact creation order and state transitions. Human confirmation breakpoints are defined centrally in `gate-control.md` to avoid duplication.

**Key references**:
- `gate-control.md` G3-G7: per-artifact gates in the OpenSpec phase
- `gate-control.md` G7: critical review gate (executed after proposal/design/specs/tasks have all passed review)
- `gate-control.md` G6.5: Brief generation gate
- `gate-control.md` Deviation handling: logging conventions for skipped gates
- **"Incremental Modification Review Gate" in this file**: the continuous extension of G7 — triggers an incremental review after an artifact is modified during the apply phase
