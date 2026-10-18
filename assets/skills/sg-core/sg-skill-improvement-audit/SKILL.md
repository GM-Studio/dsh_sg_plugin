---
name: sg-skill-improvement-audit
description: "SpecGate Improvement Audit - Review tool improvement proposals and cross-check the soundness of SpecGate design principles against user project needs"
---

# Improvement Audit

## Purpose

Independently review improvement proposals produced by `sg-skill-improvement-proposal` to decide whether each recommendation should be accepted and how to implement it.

The core of the audit is cross-validation: examine whether the change is sound from the perspective of SpecGate design principles, and confirm from the user project's perspective whether the problem really exists and whether the recommendation addresses it.

## Trigger Conditions

- An improvement proposal is complete and needs an independent audit
- The user asks to "gatekeep" the improvement recommendations
- The SpecGate project maintainer needs to make an acceptance decision on the proposal

## Prerequisites

The reviewer must read the following in full:

### SpecGate Side (understand the tool's design intent and constraints)

| File | Purpose |
|------|------|
| `AGENTS.md` | AI behavior instructions and design philosophy |
| `assets/rules/*.md` | Complete definition of the rule system |
| `docs/design/architecture/01-system-overview.md` | System architecture overview |
| `docs/design/decisions/` | Existing architecture decision records |
| `PROJECT-INTRO.md` | Project introduction and core positioning |
| `.specgate/config.yaml` | Current project configuration |

### User Project Side (understand the user's specific needs)

- The "Problem Background" and "User Project Context" sections of the improvement proposal
- The user project's configuration and usage scenarios
- The specific workflow in effect when the problem occurred

### The Proposal Itself

- The complete improvement proposal report
- The root cause analysis and quadrant classification for each recommendation

## Audit Process

### Step 1: Understand the Proposal

1. Read the complete improvement proposal
2. Build an understanding of each defect and recommendation:
   - What problem does it describe?
   - What is the root cause?
   - How does it propose to fix it?

### Step 2: Cross-Validation on the SpecGate Side

For each recommendation, answer from the SpecGate design perspective:

1. **Change scope boundary check** (hard rule, takes precedence over other dimensions):

   | ✅ SpecGate's own configuration | ❌ Externally installed configuration |
   |---|---|
   | `assets/rules/*.md` | `openspec-propose/SKILL.md` |
   | `assets/skills/sg-core/**/*.md` | `openspec-apply-change/SKILL.md` |
   | `assets/skills/engineering/**/*.md` | `openspec-archive-change/SKILL.md` |
   | `assets/skills/productivity/**/*.md` | `openspec-explore/SKILL.md` |
   | `src/guards.js` + `src/runtime.js` | `sg-skill-*/SKILL.md` |
   | `AGENTS.md`, `CONTEXT.md` | DSH profile / other plugin configuration |
   | `.specgate/*.yaml` | OpenSpec CLI configuration files |
   | SpecGate source code under the `src/` directory | `node_modules/` |
   | Other templates under the `templates/` directory | Skills under `.dsh/` that were not created by SpecGate |

   **Ruling rule**: If a recommendation involves modifying externally installed configuration → rule it ↗️ Escalate upstream or ❌ Reject (stating that it must be implemented by the upstream project).

2. **Design consistency check**: Does this change align with SpecGate's design philosophy?
   - Consult the core principles in `AGENTS.md`
   - Consult existing architecture decision records
   - Flag any conflict with historical decisions

2. **Impact analysis**:
   - Which modules does the change affect? (templates, rules, Skills, CLI)
   - Does it affect already-deployed user projects? (backward compatibility)
   - Does it overlap with external tool responsibilities? (OpenSpec, DSH platform)

3. **Implementation feasibility**:
   - Difficulty assessment
   - Is there a simpler alternative?
   - Can it be implemented in phases?

### Step 3: Cross-Validation on the User Project Side

Answer from the user project perspective:

1. **Necessity check**: Does this problem really exist in the user project?
   - Is it "genuinely blocking work" or "acceptable friction"?
   - Is there a lighter-weight solution?

2. **Quadrant correction**: Is the quadrant classification in the proposal accurate?
   - Quadrant I (SpecGate configuration defect) → easy to fix; is the assessment correct?
   - Quadrant II (SpecGate design defect) → assess whether a design discussion is needed?
   - Quadrant III (user configuration problem) → is guidance needed rather than a code change?
   - Quadrant IV (external tool limitation) → should it be raised upstream?

3. **Problem type correction**: Is the problem type marked in the proposal accurate?

   | Proposal Label | Checkpoints | Common Misjudgment |
   |----------|----------|----------|
   | 🔵 Requirement-layer addition | Does SpecGate really lack this capability? Or does it exist but was never triggered? | Misjudging "the rule did not take effect" as "the rule is missing" |
   | 🟠 Architecture-design-layer modification | Is the existing structure really flawed? Or is this a symptom of execution deviation? | Misjudging "the AI did not follow the process" as "the process is designed wrong" |
   | 🟢 Execution deviation | Are the rules clear enough? Are the trigger conditions actionable? | Misjudging "the rule itself is unreasonable" as "enforcement is insufficient" |

   **Correction output**: Mark each recommendation with its post-audit problem type, and explain the reason for any adjustment.

### Step 4: Overall Ruling

Issue a ruling for each recommendation:

| Ruling | Meaning | Follow-up Action |
|------|------|----------|
| ✅ Accept | The recommendation is sound; include it in implementation | Create the corresponding task |
| 🔄 Accept with modifications | The direction is right but the approach needs adjustment | Provide modification feedback |
| ⏸️ Defer | Valuable but currently low priority | Mark as backlog |
| ❌ Reject | Does not match design principles or is not a universal problem | State the reason for rejection |
| ↗️ Escalate upstream | Requires external tool support | Note the target upstream project |

### Step 5: Produce the Audit Report

## Audit Report Format

```markdown
# Improvement Proposal Audit Report

> **Auditor**: AI (loads sg-skill-improvement-audit)
> **Audit date**: YYYY-MM-DD
> **Audit target**: {proposal title/path}

## 1. Audit Summary

- The proposal contains {N} recommendations
- Accept {X} / Accept with modifications {Y} / Defer {Z} / Reject {W}
- Escalate upstream {V}

## 2. Item-by-Item Audit

### Recommendation 1: {recommendation title}

- **Proposal problem type**: {type labeled in the proposal}
- **Post-audit problem type**: {corrected type; explain the reason for any adjustment}
- **Proposal quadrant**: {classification in the proposal}
- **Post-audit quadrant**: {corrected classification; explain the reason for any adjustment}
- **Ruling**: {✅Accept / 🔄Accept with modifications / ⏸️Defer / ❌Reject / ↗️Escalate upstream}
- **SpecGate perspective**:
  - Design consistency: {consistent/partially consistent/inconsistent}, reason: ...
  - Impact: {which modules are involved}
  - Implementation difficulty: {high/medium/low}
- **User project perspective**:
  - Necessity: {real pain point/acceptable friction/excessive demand}
  - Alternative: {is there a lighter-weight approach?}
- **Ruling rationale**: {judgment combining both perspectives}

### Recommendation 2: ...
(repeat for each item)

## 3. Final Modification Plan

### Accepted Items (including accept with modifications)

For each accepted recommendation, provide a directly executable modification plan:

| # | Recommendation | Problem type | Files involved | Change | Priority |
|---|------|----------|----------|----------|--------|
| 1 | {recommendation title} | 🔵/🟠/🟢 | `path/to/file` | {how exactly to change: add a section, replace a passage, delete a line} | P0 |

### Deferred Backlog

| # | Recommendation | Reason for deferral | Re-evaluation timing |
|---|------|----------|--------------|
| 1 | ... | {why not do it now} | {under what conditions to reconsider} |

### Rejected Items

Every rejection must state a clear reason; vague wording is prohibited:

| # | Recommendation | Rejection reason | Suggested alternative direction |
|---|------|----------|--------------|
| 1 | {recommendation title} | {specific reason: not a universal problem/conflicts with design principles/external tool responsibility/...} | {if the problem does exist, how to solve it} |

### Escalated Upstream

| # | Recommendation | Target project | Problem description |
|---|------|----------|----------|
| 1 | ... | OpenSpec/DSH | {what upstream support is needed} |

## 4. Audit Statement

"This audit completes cross-validation from two perspectives: SpecGate design principles and the actual needs of the user project.
All rulings are accompanied by explicit reasons."
```

## Red Lines

- ❌ Making judgments without fully reading the SpecGate design documents
- ❌ Drawing conclusions without reading the user project context
- ❌ Accepting all recommendations uniformly (people-pleasing audit)
- ❌ Rejecting all recommendations uniformly (defensive audit)
- ❌ Rulings without reasons
- ❌ Labeling requirements within external tools' capability boundaries as SpecGate defects
