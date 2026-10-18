---
name: sg-skill-experience-summarization
description: "SpecGate experience summarization Skill, identifying, distilling, structuring, and archiving reusable experience from practice"
---

# Experience Summarization Skill

## Purpose

After key project milestones are completed, load this Skill to precipitate experience from practice into reusable knowledge assets.

## Four-Step Methodology

### Step 1: Identify

Identify reusable experience patterns from the following scenarios:
- Retrospectives after completing L1/L2 changes
- Root cause analysis of P0-level Bugs
- Key findings from technical research
- Typical problems found during review
- **Completeness checks after batch modifications** (such as path changes, API renames)

**Identification criterion**: Could this pattern recur in other scenarios/projects?

### Step 2: Distill

Remove project-specific details and abstract them into a general rule:
- ❌ "Use Redis in . to cache order data"
- ✅ "In hot-read scenarios, a cache layer can reduce database load by 80%"

### Step 3: Structure

Use the standard format for each experience:

```markdown
## Scenario
Under what circumstances the problem was encountered or the pattern discovered

## Problem
The specific problem description or challenge

## Solution
The solution adopted and its key steps

## Effect
Quantified or qualitative improvement results

## Applicable Conditions
The prerequisites and boundaries under which this experience applies (tech stack, scale, version, etc.)
```

### Step 4: Archive

- General experience → write into the Skill template directory (such as anti-patterns, harness-design)
- Project-specific experience → write into the `.specgate/experiences/` directory
- Technical decisions → write into `documents/decisions/ADR-{number}.md`
- **Process improvements** → update the checklist of the corresponding Skill

## Output Format

```yaml
experience_record:
  id: "EXP-YYYYMMDD-{number}"
  title: "One-sentence summary"
  type: "anti-pattern" | "best practice" | "pitfall record" | "recommended approach"
  source: "{change ID} / {Bug ID} / user request"
  version: "v1"
  date: "YYYY-MM-DD"
  structured_content:
    scenario: "..."
    problem: "..."
    solution: "..."
    effect: "..."
    conditions: "..."
```

## Red Lines

- ❌ Not removing project details = cannot be reused
- ❌ Missing applicable conditions = risk of misuse
- ❌ Recording only conclusions without the reasoning process = hard to update
