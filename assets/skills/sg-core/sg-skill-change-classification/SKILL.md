---
name: sg-skill-change-classification
description: "SpecGate change classification Skill, determining which paradigm (L1/L2/L3) a heavy modification falls into"
---

# Change Classification Skill

## Purpose

After entry-guard determines that a request is a "heavy modification", load this Skill to perform paradigm grading and map the change onto the L1/L2/L3 workflow.

## Decision Tree

```
Heavy modification request received
    │
    ├─ Q1: Has the user-visible requirement changed?
    │       ├─ Yes → L1 (requirement-driven change)
    │       └─ No → continue
    │
    ├─ Q2: Has the technical approach/architecture design changed?
    │       ├─ Yes → L2 (technical implementation change)
    │       └─ No → continue
    │
    └─ Q3: Pure code fix/optimization, with neither the requirement nor the approach changed?
            ├─ Yes → L3 (defect fix/code optimization)
            └─ No → escalate to the main Agent for human judgement
```

## Decision Signal Quick Reference

| Decision signal | Typical phrasing | Paradigm |
|---------|---------|------|
| Requirement change | "Add a new feature" / "The user flow needs to change" / "UI adjustment" | L1 |
| Technical implementation | "Switch to microservices" / "Refactor the module" / "Introduce a cache layer" | L2 |
| Defect fix | "Fix a Bug" / "Resolve a memory leak" / "Optimize performance" | L3 |
| Ambiguous boundary | Involves both requirement and technical approach changes | Take the highest level → L1 |

## Output Format

```yaml
paradigm: "L1" | "L2" | "L3"
confidence: "high" | "medium" | "low"
reasoning: "Rationale (one sentence stating which signal the decision is based on)"
next_action: "Start the L1 workflow / Start the L2 workflow / Start the L3 workflow"
```

## Key Red Lines

- ❌ Never classify a requirement change as L2/L3 (underestimating the impact)
- ❌ Never classify a pure code fix as L1/L2 (excessive process)
- ❌ Never downgrade a classification on the grounds that "the change is small"

## Division of Labor with entry-guard

| | entry-guard | change-classification |
|---|---|---|
| Responsibility | Decide whether it is a modification | Assign the modification to L1/L2/L3 |
| Timing | First step for any input | After entry-guard determines a "heavy modification" |
| Output | Q&A / light / heavy | L1 / L2 / L3 |

The two run back to back and never substitute for each other.
