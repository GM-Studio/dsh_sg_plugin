# Human Confirmation Gate Rules

> **Loading**: Materialized into `.specgate/templates/rules/` by `dsh-plugin-specgate`; DSH does not inject it automatically, so the AI must consult it proactively when handling the corresponding task (the core summary is inlined into `AGENTS.md`).
> **Purpose**: Defines every gate at which the AI must wait for user confirmation. Violating it is a process violation.
> **Priority**: Hard rule (must be followed every time), non-negotiable, cannot be skipped.

---

## Core Principle

**Every stage output must pass a human confirmation gate before advancing to the next stage. Automatic accumulation or implicit advancement is prohibited.**

A single "continue" from the user only authorizes continuing the current discussion; it does not authorize skipping any gate.

---

## Gate Checklist

### Phase 1: Requirements Clarification

- G1 (Requirements understanding confirmation): when requirements questioning/competitive analysis is complete, ask "Is the requirements understanding correct? Can we proceed to change classification?". Release condition: explicit user confirmation.
- G2 (Change classification confirmation): when change classification is complete, ask "This change is classified as L{X} with process rigor {intensity}; do you confirm?". Release condition: explicit user confirmation.

### Phase 2: OpenSpec Creation (per-artifact gates)

- G3 (proposal review): when `proposal.md` is complete, ask "The proposal has been created; does it pass review?". Release condition: the user replies "pass".
- G4 (design review): when `design.md` is complete, ask "The design has been created; does it pass review?". Release condition: the user replies "pass".
- G5 (specs review): when `specs/` is complete, ask "Are the specs organized as vertical slices? Do they cover all requirements? Do they need additions?". Release condition: the user replies "pass".
- G6 (tasks review): when `tasks.md` is complete, ask "Is the task breakdown reasonable? Is the granularity appropriate?". Release condition: the user replies "pass".
- G6.5 (Brief generation check): when the tasks review passes and the change size exceeds the threshold (effort > 2h / more than 2 modules / more than 3 files / interface changes), ask "This change meets the conditions for Brief generation; should an Agent Brief be generated now?". Release condition: the user confirms generating the Brief or confirms skipping it (a deviation must be recorded).
- G7 (Critical review): after the tasks review passes (complex changes must first pass G6.5), automatically start the critical review, then ask "Do you confirm entering the implementation phase?". Release condition: explicit user approval.

### Phase 3: Implementation

- G8 (Code review): when code writing is complete, ask "Should code review start?". Release condition: user confirmation.
- G9 (Review passed): when code review is complete, ask "The review passed; should the code be committed?". Release condition: user confirmation.

### Phase 4: Wrap-up

- G10 (Feature acceptance): when feature development is complete, ask "Should acceptance testing start?". Release condition: user confirmation.
- G11 (Branch handling): when tests pass, ask "Should the branch be merged / a PR be created?". Release condition: user confirmation.

---

## Paradigms and Gate Rigor

Gate rigor under each paradigm:

- G1 Requirements confirmation: mandatory for L1, mandatory for L2, skippable for L3
- G2 Change classification: mandatory for L1/L2/L3
- G3 proposal: mandatory for L1/L2, may be merged into G2 for L3
- G4 design: mandatory for L1/L2, skippable for L3
- G5 specs: mandatory for L1/L2, skippable for L3
- G6 tasks: mandatory for L1/L2/L3
- G6.5 Brief generation: mandatory for L1/L2, skippable for L3
- G7 Critical review: mandatory for L1/L2, simplified review for L3
- G8-G11 Implementation/wrap-up: mandatory for L1/L2/L3

> ● = mandatory 　　　○ = optional/simplified

**L3 simplification**: A pure defect fix may, after change classification, go straight to tasks creation, skipping proposal/design/specs/Brief generation. However, tasks review and code review cannot be skipped.

---

## Confirmation Format Rules

### Required

- Must: use an explicit interrogative form that states the current status and the next step
- Must: wait for an explicit user reply ("pass" / "confirm" / "yes" / "needs changes")
- Must: when the user says "needs changes", go back, revise, and then ask again
- Must: wait for confirmation of only one gate at a time

### Prohibited

- Prohibited: substituting a statement for a question ("I'll go ahead and create the design now")
- Prohibited: assuming user consent ("if there's no problem I'll continue")
- Prohibited: inferring global approval from several partial confirmations
- Prohibited: interpreting "continue" as "skip all reviews and finish"
- Prohibited: bundling multiple artifacts of the same gate into one question ("proposal and design are both done — approve them together?")

---

## Deviation Handling

If any gate is to be skipped, you must:

1. Explain why it is being skipped (limited to urgent fixes / explicit user request)
2. Clearly tell the user which gate was skipped
3. Record it in `.specgate/deviations.log`
4. Skip it only after obtaining explicit user approval

**Example record format**:

```yaml
- timestamp: "2026-05-13T10:30:00Z"
  deviation: "Skipped G4 design review"
  reason: "User explicitly requested to proceed directly to implementation"
  approved_by: "user"
```

---

## Relationship to workflow-state.md

- `workflow-state.md` defines artifact creation order and state transitions
- This file defines the **human confirmation breakpoints** between artifacts
- After completing each artifact, the AI must first consult this file to determine whether a gate has been reached
