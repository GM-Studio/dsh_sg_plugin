---
name: sg-skill-anti-patterns
description: "SpecGate anti-pattern check Skill, covering quick-reference tables for design, implementation, and process anti-patterns"
---

# Anti-Pattern Check Skill

## Purpose

When writing code, reviewing code, designing architecture, or writing a Spec, load this Skill and check against it to catch and correct common traps early.

## Design Anti-Patterns

| Anti-pattern | Characteristics | Remediation |
|--------|------|---------|
| Over-engineering | Introducing complex architecture for a simple problem | Validate with an MVP first, then enhance incrementally |
| Leaky abstraction | Low-level details seep into upper-layer interfaces | Keep encapsulation boundaries clear and interface semantics complete |
| Premature optimization | Optimizing without verifying the bottleneck | Measure first, then optimize, data-driven |
| God class | One class carries too many responsibilities | Split by single responsibility |
| Circular dependency | Module A depends on B, and B depends on A | Introduce an intermediate layer or interface to decouple |

## Implementation Anti-Patterns

| Anti-pattern | Characteristics | Remediation |
|--------|------|---------|
| Magic number | Hardcoded meaningless constants in code | Extract to named constants or configuration items |
| Duplicate code | The same logic scattered across multiple places | Extract a function/component/utility method |
| Deep nesting | Condition chains indented more than 4 levels | Early return, guard clauses, strategy pattern |
| Empty catch | Catching an exception without handling it | At minimum log it and define an explicit handling strategy |
| Long parameter list | More than 5 function parameters | Wrap into a configuration object or context |

## Process Anti-Patterns

| Anti-pattern | Characteristics | Remediation |
|--------|------|---------|
| Skipping review | Bypassing review on the grounds that "the change is small" | All code changes must be reviewed |
| Ignoring tests | Not writing tests, or inflating test coverage | Test behavior, not implementation |
| Documentation drift | Code changed but docs/Spec not updated | The change workflow enforces documentation sync |
| Requirements gold-plating | Implementing functionality beyond the requirement scope | Develop strictly within the Spec scope |
| **Batch update omissions** | Changing only some files when paths/names/APIs change | **Search all reference points globally before modifying, and search again to verify after modifying** |

## Batch Update Completeness Checklist

This checklist is mandatory when performing the following operations:
- Directory rename/move
- File path changes
- API/interface name changes
- Configuration item renames
- Dependency version upgrades

### Check Steps

1. **Before modifying: global search**
   ```bash
   # Search all reference points
   grep -r "old-name" --include="*.md" --include="*.ts" --include="*.js" --include="*.json" --include="*.yaml" .
   ```

2. **During modification: record the list**
   - List every file that needs modification
   - Group by file type (documentation/code/configuration)
   - Modify one by one and mark each

3. **After modification: search again to verify**
   ```bash
   # Confirm no residual references
   grep -r "old-name" --include="*.md" --include="*.ts" --include="*.js" --include="*.json" --include="*.yaml" .
   # Should return 0 results
   ```

4. **Before committing: final confirmation**
   - Check whether git status includes every modified file
   - Confirm that no configuration/documentation files were missed

### Common Oversights

- ❌ Path references in design documents
- ❌ Source/provenance notes in Skill/Agent READMEs
- ❌ Ignore rules in configuration files
- ❌ Import paths in example code
- ❌ Historical version records/CHANGELOG

## How to Use

1. **While coding**: Self-check item by item against the "Implementation anti-patterns"
2. **While reviewing**: Flag issues against the three anti-pattern lists
3. **While designing**: Focus on the "Design anti-patterns" and "Process anti-patterns"
4. **During batch modifications**: Execute the "Batch Update Completeness Checklist"

## Output Format

```yaml
check_result:
  issues_found: 3
  issues:
    - type: "design anti-pattern"
      name: "over-engineering"
      location: "src/core/orchestrator.ts"
      suggestion: "Simplify the state machine; validate the logic with if-else first"
    - type: "implementation anti-pattern"
      name: "magic number"
      location: "src/utils/config.ts:42"
      suggestion: "Extract to a MAX_RETRY_COUNT constant"
```

## Red Lines

- ❌ Finding an anti-pattern without recording it = not checked
- ❌ Marking something as "fix later" without creating a tracking item = endless deferral
