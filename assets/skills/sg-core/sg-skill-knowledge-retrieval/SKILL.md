---
name: sg-skill-knowledge-retrieval
description: "SpecGate knowledge retrieval Skill - Systematically retrieve project knowledge assets to support decisions"
---

# Knowledge Retrieval Skill

## Purpose

Before executing a task, load this Skill to retrieve knowledge assets in `.specgate/experiences/`, avoiding repeated pitfalls and reusing existing experience.

## When to Retrieve

**You must retrieve** knowledge assets in the following scenarios:

| Scenario | Retrieval Target |
|------|---------|
| Agent role decision | Usage scenarios for the main Agent vs subagents |
| Experience capture | When the main Agent/KE should capture experience |
| Architecture decisions | ADR decision records, architecture principles |
| Creating document templates | Template management best practices, naming conventions |
| Encountering errors | Pitfall records, anti-patterns, solutions |
| Starting a new task | Check whether relevant experience can be reused |

## Retrieval Methods

### Method 1: Semantic Retrieval (Recommended)

Use the DSH `grep` tool:
```
grep:
  path: ".specgate/experiences/"
  pattern: "keyword1|keyword2|keyword3"
```

### Method 2: Index Retrieval

Read `.specgate/experiences/index.md`:
- Review the list of knowledge entries
- Follow the link to a relevant entry and read it directly

### Method 3: Keyword Retrieval

Use DSH `grep`:
```
grep:
  path: ".specgate/experiences/"
  pattern: "keyword"
```

### Method 4: File Discovery

Use DSH `glob` to list knowledge files:
```
glob:
  path: ".specgate/experiences/"
  pattern: "**/*.md"
```

Then use `read` to read the matched files. DSH does not provide the `search_memory` / `grep_code` tools.

## Knowledge Asset Structure

```
.specgate/experiences/
├── index.md                      # Knowledge asset index
├── trigger-guide.md              # Knowledge retrieval trigger guide
├── best-practices/               # Best practices
│   ├── BP-agent-subagent-decision-strategy.md
│   ├── BP-architectural-decision-evolution-methodology.md
│   └── ...
├── decisions/                    # Architecture decisions (ADR)
│   ├── ADR-001-template-directory-location.md
│   ├── ADR-002-experience-summarization-boundary.md
│   └── ...
├── pitfall-records/              # Pitfall records
│   └── ...
└── tool-research/                # Tool research
    └── ...
```

## Retrieval Process

1. **Determine the scenario**: Which retrieval scenario does the current task belong to?
2. **Choose a method**: Prefer semantic retrieval; use index retrieval when the file name is known
3. **Read the content**: Retrieve the relevant knowledge entries
4. **Apply the knowledge**: Apply the knowledge to the current decision
5. **Record gaps**: If no relevant knowledge exists, mark it as needing capture

## Related Usage

- **Experience capture**: `experience-summarization` Skill (after completing a task)
- **Knowledge research**: `knowledge-research` Skill (external research)
- **Terminology management**: `terminology-management` Skill (terminology consistency)
