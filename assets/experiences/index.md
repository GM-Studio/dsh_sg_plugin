# SpecGate Knowledge Asset Index

> This directory stores the project's knowledge assets, including tool research, best practices, pitfall records, and architecture decisions.
> 
> **Maintainer**: the knowledge maintainer flow  
> **Update mechanism**: Automatic (after tool research is completed, a bug is resolved, or a technical decision is made)

---

## 📚 Knowledge Categories

### 1. Tool Research Reports (`tool-research/`)

Records findings from research into the official documentation of tools, frameworks, and platforms.

**Use cases**: technology selection, tool configuration, exploring capability boundaries

### 2. Best Practices (`best-practices/`)

Records effective approaches and recommended solutions validated in the project.

**Use cases**: process conventions, development patterns, configuration strategy

### 3. Pitfall Records (`pitfall-records/`)

Records typical problems encountered in the project, their root-cause analysis, and solutions.

**Use cases**: troubleshooting, avoiding repeated mistakes, anti-pattern identification

### 4. Architecture Decisions (`decisions/`)

Records the context of important technical decisions, the comparison of options, and the final choice (ADR format).

**Use cases**: architecture design, technology selection, solution review

---

## 📋 Knowledge Entry List

### Latest Entries

| ID | Title | Type | Date | Path |
|----|-------|------|------|------|
| _No entries yet_ | - | - | - | - |

### Counts by Category

| Category | Count | Latest entry |
|----------|-------|--------------|
| tool-research | 0 | - |
| best-practices | 0 | - |
| pitfall-records | 0 | - |
| decisions | 0 | - |

---

## 🔍 Quick Retrieval Guide

### Method 1: Semantic search (recommended)

Use the DSH `grep` tool to search the `.specgate/experiences/` directory:

```
grep:
  pattern: "keyword"
  path: ".specgate/experiences/"
```

### Method 2: Index lookup

Browse this index file directly and find relevant entries by category.

### Method 3: Keyword search

Use DSH `grep` to search for keywords in `.specgate/experiences/`:

```
grep:
  path: ".specgate/experiences/"
  pattern: "keyword"
```

### Method 4: Delegate to the Knowledge Engineer

For complex scenarios, delegate to a subagent acting as knowledge engineer for comprehensive retrieval and conflict detection.

---

## 🎯 Retrieval Trigger Guide

When you receive a task, first consult [trigger-guide.md](trigger-guide.md) to determine which knowledge to retrieve.

**Quick reference**:

| Scenario | Knowledge to retrieve | Retrieval path |
|----------|-----------------------|----------------|
| Agent division decisions | When to use the main Agent vs. a subagent | `best-practices/*agent-subagent*` |
| Experience capture | When the main Agent/KE should capture experience | `best-practices/*experience-scenario*` |
| Configuring DSH write guards | Plugin `ctx.tools.guard` / `tools/post-execute` mechanisms | `tool-research/*dsh-guard*` |
| Creating a new feature branch | SpecGate Git workflow conventions | `best-practices/*git-workflow*` |
| Technology selection | Relevant tool research reports | `tool-research/` |
| Encountering an error | Pitfall records, anti-patterns | `pitfall-records/` |
| Architecture design | ADR decision records | `decisions/` |

---

## 📊 Knowledge Asset Health

### Coverage

- [ ] Core toolchain components researched (DSH, SpecGate, Git workflow)
- [ ] Common development scenarios covered by best practices
- [ ] Past pitfalls archived

### Currency

- [ ] All knowledge entries have a last-verified date
- [ ] Outdated content is marked or archived

### Consistency

- [ ] No contradictions between knowledge entries
- [ ] Consistent with AGENTS.md rules

---

## 🔄 Maintenance Rules

1. **Adding knowledge**: capture it through the KE Agent following the experience-summarization process
2. **Updating knowledge**: update the original file and preserve version history
3. **Conflict handling**: the KE detects conflicts and adjudicates; escalate undecidable cases to the user
4. **Periodic review**: review the index weekly to keep knowledge assets healthy

---

**Created**: {{date}}  
**Maintained with**: the knowledge maintainer flow
