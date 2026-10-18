---
name: sg-skill-entry-guard
description: "SpecGate entry judgement Skill, classifying user requests as Q&A/light modification/heavy modification"
---

# Entry Judgement Skill

## Purpose

Every time the main Agent receives user input, it first loads this Skill to perform entry judgement, distinguishing Q&A, light modification, and heavy modification.

## Judgement Rules

```
User input received
    ├─ Pure Q&A? (no file modification involved) → answer directly, done
    ├─ Light modification? (version number/typo/minor configuration tweak/adding a unit test) → delegate to Developer
    └─ Heavy modification? (business logic/new feature/architecture adjustment) → load change-classification → L1/L2/L3
```

## Quick Reference

| User phrasing | Judgement | Handling |
|---------|------|------|
| "How do I use this framework?" | Q&A | Answer directly |
| "Update the version number to 1.2.0" | Light modification | Delegate to Developer |
| "Help me change the login logic" | Heavy modification | Classify → standard workflow |
| "review this PR" | Delegate to Reviewer | Start the Reviewer |
| "capture experience" | Delegate to KE | Start the Knowledge Engineer |

## Output Format

```yaml
classification: "Q&A" | "light modification" | "heavy modification"
reason: "Rationale (one sentence)"
next_action: "Answer directly / delegate to sg-agent-developer / load change-classification"
```

## Key Red Lines

- ❌ The main Agent must never modify files itself
- ❌ Never let a heavy modification bypass change-classification
- ❌ Never skip judgement on the grounds that "the change is very small"

## Division of Labor with change-classification

| | entry-guard | change-classification |
|---|---|---|
| Responsibility | Decide whether it is a modification | Assign the modification to L1/L2/L3 |
| Timing | First step for any input | After entry-guard determines a "heavy modification" |
| Output | Q&A / light / heavy | L1 / L2 / L3 |

The two run back to back and never substitute for each other.

## Gate State Awareness (P1 enhancement)

After judging a request to be a heavy modification, check the current gate state before escalating to change-classification:

1. Check the gate marker files under the `.specgate/gates/` directory:
   - `G1.confirmed` — requirement confirmed
   - (subsequent gate marker files are added as needed)

2. Gate prompting rules:
   - If `.specgate/gates/G1.confirmed` does not exist and the user's intent involves operations at G2 or later stages (such as proposal, design, coding) → prompt the user
   - Tell the user: "G1 requirement confirmation has not been completed yet; complete the requirement interrogation and critical-review first"
   - If `.specgate/gates/G1.confirmed` exists → escalate to change-classification normally
   - Note: at the Skill level this is only a prompt; actual pre-write blocking is enforced by the DSH plugin's `write/edit` guard

3. Gate state is checked by file existence, not by conversation history. The marker files are created by the corresponding Skill (such as requirements-definition) after the user explicitly confirms.
