# Agent Brief Template

**Purpose**: Provide AI sub-agents with a structured task description so requirements stay clear, boundaries stay explicit, and outcomes stay verifiable.

**When to use**: After requirements grilling is complete and before implementation starts.

---

## Brief Template

```markdown
# Agent Brief: <short task description>

## Category
bug | enhancement

## Summary
<1-2 sentences describing what to do, including the motivation>

## Current behaviour
<what happens now>

## Desired behaviour
<what should happen>

## Key interfaces
- `functionOrMethod()` — the core function to modify/add
- `ClassName` — the class involved
- `configKey` — the relevant configuration key

## Acceptance criteria
- [ ] **Given** <precondition>, **When** <action>, **Then** <expected result>
- [ ] **Given** <precondition>, **When** <action>, **Then** <expected result>
- [ ] Test coverage reaches XX%
- [ ] All existing tests pass

## Out of scope
- Parts that will not be modified
- Features that will not be added
- Scenarios explicitly excluded

## Implementation hints
<optional: technical suggestions, reference files, caveats>

## Reference files
- `path/to/file1.ts` — file to modify
- `path/to/file2.ts` — reference file
- `path/to/test.ts` — test file

## Constraints
- Keep backward compatibility
- Do not break existing APIs
- Follow the project coding conventions

## Success metrics
- Functional verification: all Acceptance criteria are met
- Quality verification: 100% test pass rate
- Performance verification: no significant performance regression
```

---

## Usage Guide

### 1. When to Generate a Brief

**Scenarios that require a Brief**:
- After requirements grilling is complete
- Before developing a complex feature (> 2 hours of work)
- Cross-module changes
- Changes involving multiple files

**Scenarios where a Brief is optional**:
- Simple bug fixes (< 30 minutes)
- Single-file changes
- Documentation updates

### 2. Brief Quality Checklist

Self-check after generating a Brief:

- [ ] **Summary** can be stated in 1-2 sentences
- [ ] **Current/Desired** behaviour contrast is clear
- [ ] **Acceptance criteria** are verifiable (not subjective judgement)
- [ ] **Out of scope** explicitly excludes out-of-boundary content
- [ ] **Key interfaces** list the core change points
- [ ] **Reference files** paths are accurate

### 3. Brief Examples

#### Example 1: Bug Fix

```markdown
# Agent Brief: Fix path resolution error during template rendering

## Category
bug

## Summary
Template rendering fails to resolve paths on Windows because a Unix path separator is hardcoded. It needs to use `path.join()` instead.

## Current behaviour
```
Error: Cannot find template 'components\button.mustache'
```

## Desired behaviour
Template paths resolve correctly on Windows/Linux/macOS.

## Key interfaces
- `resolveTemplatePath(templateName)` — the core function to modify
- `TemplateRenderer` — template renderer class

## Acceptance criteria
- [ ] **Given** a Windows environment, **When** rendering `components\button.mustache`, **Then** the template file is located correctly
- [ ] **Given** a Linux environment, **When** rendering `components/button.mustache`, **Then** the template file is located correctly
- [ ] All existing tests pass
- [ ] A new cross-platform path test case is added

## Out of scope
- Template rendering logic will not be modified
- New template syntax will not be added
- The Mustache engine will not be modified

## Implementation hints
- Use `path.join()` instead of string concatenation
- Refer to the Node.js `path` module documentation
- Windows tests need to be configured in CI

## Reference files
- `src/core/generator/template-path.ts` — to modify
- `tests/core/generator/template-path.test.ts` — tests to add

## Constraints
- Keep backward compatibility (existing path formats still work)
- Do not break existing APIs

## Success metrics
- Functional verification: cross-platform path resolution is correct
- Quality verification: 100% test pass rate
```

#### Example 2: New Feature

```markdown
# Agent Brief: Add periodic architecture review reminders

## Category
enhancement

## Summary
Add periodic architecture review reminders that prompt when the architecture has not been reviewed for more than 7 days, helping actively control architecture entropy.

## Current behaviour
There is no architecture review reminder mechanism, so architecture problems are only discovered once they accumulate to a severe level.

## Desired behaviour
- Prompt before using a tool when more than 7 days have passed since the last review
- The prompt does not block tool usage
- Support manually triggered reviews

## Key interfaces
- `checkArchitectureReviewNeeded()` — checks whether a review is needed
- `preToolUseHook` — hook script template
- `.specgate/architecture-review-last.txt` — records the last review time

## Acceptance criteria
- [ ] **Given** more than 7 days without a review, **When** a tool is used, **Then** a reminder is shown but does not block
- [ ] **Given** a review within the last 7 days, **When** a tool is used, **Then** no reminder is shown
- [ ] **Given** first-time use, **When** a tool is used, **Then** a guidance prompt is shown
- [ ] The hook script runs on both macOS/Linux

## Out of scope
- Reviews will not be enforced
- The review logic itself will not be modified
- No Web UI will be added

## Implementation hints
- Use file timestamps to record the last review time
- The hook script needs to be compatible with the `date` command on macOS and Linux
- Reminder messages should be friendly and non-blocking

## Reference files
- `templates/git-hooks/pre-tool-use-architecture-check.sh.mustache` — to create
- `utils/paths.ts` — reference path utilities

## Constraints
- Reminders do not block tool usage
- Compatible with macOS/Linux
- No noticeable performance overhead

## Success metrics
- Functional verification: the reminder mechanism works
- Quality verification: hook script tests pass
- User feedback: reminder frequency is appropriate
```

---

## Best Practices

### Best Practices

**Must do**:

1. Define boundaries clearly: Out of scope matters more than Acceptance criteria
2. Verifiable criteria: every Acceptance criterion can be verified by a test
3. Accurate references: verify that Reference files paths exist
4. Clear motivation: Summary includes why this change is needed
5. Keep it concise: keep the Brief within one page (~500 words)

**Must not do**:

1. Vague descriptions: "improve performance" (wrong) → "response time < 200ms" (correct)
2. Missing boundaries: no explicit Out of scope
3. Over-detailed: including implementation details (the AI should decide those)
4. Non-existent references: incorrect Reference files paths
5. Subjective criteria: "good user experience" (wrong) → "≤ 3 interaction steps" (correct)

---

## Integration with Existing Workflows

### requirements-grilling Integration

```
Request raised
  ↓
requirements-grilling (grilling)
  ↓
Requirements clear?
  ├─ Yes → Generate Agent Brief
  └─ No → Continue grilling
  ↓
Brief confirmed
  ↓
Implementation (TDD + systematic-debugging)
```

### Out-of-Scope Integration

```
Request raised
  ↓
Assess whether it is in scope
  ├─ In scope → Generate Agent Brief
  └─ Out of scope → Record in Out-of-Scope
       ↓
       Create .specgate/out-of-scope/<feature-name>.md
       ↓
       Inform the user and explain the rationale
```

### OpenSpec Workflow Integration

**Generation timing**: After tasks.md is complete and before critical-review starts (see `gate-control.md` G6.5).

```
OpenSpec workflow                        Brief workflow
─────────────────                        ──────────────
proposal.md (Why/What)
  ↓
specs/*.md (Requirements/Scenarios)
  ↓
design.md (Architecture)
  ↓
tasks.md (Task breakdown)
  ↓
  ├────────────────────────────────→  Assess change size
  │                                    ↓
  │                                  Meets criteria?
  │                                    ├─ Yes → Generate brief.md
  │                                    │        ├─ Summary
  │                                    │        ├─ Acceptance criteria
  │                                    │        ├─ Out of scope
  │                                    │        ├─ Reference files  
  │                                    │        └─ Information loss check
  │                                    │         ↓
  │                                    │       User confirms Brief
  │                                    │         ↓
  │                                    └─ No → Record the skip reason
  │                                              ↓
  └←─────────────────────────────────────────────┘
  ↓
critical-review (G7)
  ↓
apply (implementation)
```

**Input sources** (Brief content is extracted from the following OpenSpec artifacts):
- `proposal.md` → Summary (Why/What)
- `specs/*.md` → Acceptance criteria, Key interfaces, Constraints
- `design.md` → Reference files, Implementation hints
- `tasks.md` → Effort estimate (decides whether a Brief is needed)

**Output destinations**:
- Reference material for the AI agent during the apply phase (as implementation guidance)
- Baseline for the information loss check (executed automatically by triage-brief)
- Stored in `.specgate/briefs/<change-name>.md`

---

## Version History

- **v1.0** (2026-05-08): Initial version, adapted from AGENT-BRIEF.md in mattpocock-skills
