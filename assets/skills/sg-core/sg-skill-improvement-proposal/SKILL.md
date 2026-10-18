---
name: sg-skill-improvement-proposal
description: "SpecGate Tool Improvement Proposal - Deeply diagnose SpecGate behavior problems and produce structured improvement recommendations, distinguishing universal defects from project-specific problems"
---

# Improvement Proposal

## Purpose

Use this when the user finds that SpecGate tool behavior does not match expectations (gates failing, process violations, configuration defects, rule contradictions, etc.) and needs to submit systematic improvement recommendations to the SpecGate project.

**Core task**: Read the SpecGate codebase and the user project context in depth, produce a structured improvement report, and distinguish universal problems from project-specific problems.

## Trigger Conditions

- The user reports abnormal SpecGate process/rule/Skill behavior
- The user asks to "retrospect" a SpecGate usage problem
- The user explicitly requests "improvement suggestions for SpecGate"
- The user sends a problem report and asks for analysis

## Execution Process

### Phase 1: Understand the Problem

1. **Read the user's problem description in full** and extract:
   - Which stage went wrong (gates, classification, review, execution)
   - The gap between actual behavior and expected behavior
   - The user's project type and context

2. **Interaction retrospective** (mandatory):

   Reconstruct the interaction timeline between both parties from the conversation history, covering at least the following nodes:

   | Retrospective Dimension | Questions to Ask |
   |----------|------------|
   | User instruction | What did the user actually say at each step? Was it an explicit instruction or a vague response (such as "continue")? |
   | AI judgment | What was the AI thinking at each key decision point? (if the AI's internal reasoning is available) Why did it choose to proceed instead of pausing? |
   | Gate trigger | Did the AI notice every gate that should have triggered? After noticing, why did it not pause? |
   | Deviation accumulation | After the first skipped gate, did subsequent gates fail as a passive chain reaction or were they actively skipped? |
   | User feedback | When did the user discover the problem? What exactly did they say? |

   Output format: timeline table + analysis of AI misjudgments

3. **Follow-up clarification** (if needed):
   - What should the expected behavior be?
   - Are there reference cases or comparison scenarios?

### Phase 2: Deep Analysis on the SpecGate Side

**You must read the following files in full**:

| File | Purpose |
|------|------|
| `assets/rules/*.md` | Check whether rule definitions are missing or contradictory |
| `AGENTS.md` | Check whether behavior instructions cover the scenario |
| The relevant Skill's `SKILL.md` | Check whether the Skill process has defects |
| `.specgate/config.yaml` | Check whether the configuration is complete |
| `src/guards.js` + `src/runtime.js` | Check the DSH guards and write gate mechanism |

**Analysis dimensions**:

1. **Change scope confirmation**: Do the files involved fall within SpecGate's own modifiable scope?
   - ✅ SpecGate itself: `assets/`, `src/`, `index.js`, `AGENTS.md`, `CONTEXT.md`, `.specgate/`
   - ❌ External installations: `openspec-*` Skills (distributed by the OpenSpec CLI), third-party Skills other than sg-skill-*, DSH profile / other plugin configuration
   - If the root cause lies in an external tool, mark it ↗️ Escalate upstream and do not produce modification recommendations on the SpecGate side
2. **Rule coverage analysis**: Does the current rule system cover the scenario?
3. **Trigger condition analysis**: Are the rules' trigger conditions clear and actionable?
4. **Enforcement analysis**: Are the rules "advisory" or "mandatory"? Is enforcement lacking?
5. **Configuration completeness analysis**: Are the relevant Skills/Agents enabled?

### Phase 3: Analysis on the User Project Side

- Is the user project's configuration correct? (`.specgate/*.yaml`)
- Did the user follow the prescribed process? (for example, skipping required confirmation steps)
- Was the problem triggered by the user project's particularities? (for example, a non-standard directory structure)

### Phase 4: Problem Classification

**Classify each defect along two intersecting dimensions**:

#### Dimension 1: Nature of the Problem (affects the choice of fix)

| Type | Definition | Typical Characteristics | Direction of Change |
|------|------|----------|----------|
| 🔵 Requirement-layer addition | SpecGate lacks a capability; the current system does not cover the scenario | No related rule/Skill; the user's need is reasonable but the tool does not support it | Add rule files, create new Skills, extend configuration items |
| 🟠 Architecture-design-layer modification | SpecGate has the capability but the structure/design is wrong and needs reorganization | Rules exist but are in the wrong place; responsibilities are coupled; process order is wrong | Refactor existing files, split/merge modules, adjust dependencies |
| 🟢 Execution deviation | SpecGate's design and rules are correct, but the AI did not follow them | Rules are defined but trigger conditions are vague; enforcement is weak; the AI skipped them on its own | Strengthen trigger conditions, add hard gates, raise rule priority |

> Multiple defects in one proposal may belong to different types. Label each defect independently.

#### Dimension 2: Scope of Impact (four quadrants)

```
                Universality (affects all users)
                    │
     Quadrant I     │     Quadrant II
  SpecGate config defect │ SpecGate design defect
   (easy to fix)    │ (needs design discussion)
────────────────────┼────────────────────
    Quadrant III    │     Quadrant IV
  User config problem │ External tool limitation
 (guidance-based fix)│ (requires upstream fix)
                    │
             Specificity (affects only the current project)
```

### Phase 5: Produce the Improvement Report

Align the output format with the user feedback report structure:

```markdown
# SpecGate Tool Improvement Report

> **Report date**: YYYY-MM-DD
> **Problem type**: {process compliance/configuration defect/missing rule/...}
> **Severity**: {🔴High / 🟡Medium / 🟢Low}

## 1. Problem Background
- Project context
- Task description
- Expected process vs actual process

## 2. Problem Retrospective

### 2.1 Interaction Timeline
| Step | What the user said | What the AI did/judged | Gate should have triggered? | Actually paused? | Deviation |
|------|-------------|-----------------|-------------|---------------|------|
| 1 | ... | ... | G{X} | ❌ Skipped | ... |

### 2.2 List of Bypassed Gates
| # | Gate | Should have occurred at | Actually occurred at | Rule violated |
|---|--------|--------|--------|----------|
| 1 | ... | ... | ... | ... |

### 2.3 Analysis of AI Misjudgments
| Moment | Actual AI judgment | Correct approach | Root cause category |
|------|---------------|----------|----------|
| ... | ... | ... | Misunderstood instruction/efficiency trap/1% rule failure/... |

## 3. Root Cause Analysis
### Direct Causes (AI behavior level)
### Root Causes (SpecGate configuration/rule defects)
- Defect 1: {description} (location, problem, impact)
  - Problem type: 🔵Requirement-layer addition / 🟠Architecture-design-layer modification / 🟢Execution deviation
  - Impact quadrant: Quadrant I / II / III / IV
- Defect 2: ...

## 4. Optimization Recommendations
### P0 (fix immediately, rule/configuration level)
### P1 (next version, Skill level)
### P2 (future version, mechanism level)
- Label each recommendation with its problem type and quadrant classification

## 5. Priority and Impact Assessment
- Scope and severity of impact
- Recommended implementation order

## 6. Appendix
- List of related files
- List of affected artifacts
```

## Relationship with improvement-audit

- This Skill produces an **improvement proposal**
- `sg-skill-improvement-audit` performs an **independent audit** of this Skill's output
- Proposal + audit = SpecGate's self-improvement loop

## Red Lines

- ❌ Drawing conclusions without fully reading SpecGate rules/configuration/code
- ❌ Misjudging project-specific problems as universal defects
- ❌ Misjudging universal defects as project-specific problems (the reverse error)
- ❌ Recommending changes to external tools (OpenSpec, DSH platform) without marking them as "requires upstream fix"
- ❌ Skipping root cause analysis and jumping straight to recommendations
