---
name: sg-skill-vertical-slicing
version: 0.1.0
description: "Vertical slicing task breakdown - break a plan, Spec, or PRD into independently implementable vertical slices (tracer bullets). Each slice cuts through all integration layers and can be demonstrated and verified independently."
---

# Vertical Slicing Task Breakdown

Use vertical slicing (tracer bullets) to break a plan into independently grabbable slices.

## Core concepts

### Vertical slicing vs horizontal slicing

**Vertical slicing (✅ correct)**:
- Thin slices that cut through all layers (schema → API → UI → tests)
- Each slice can be demonstrated independently
- A narrow but complete path

**Horizontal slicing (❌ wrong)**:
- Doing only one layer ("do all the API first", "then all the UI")
- Cannot be demonstrated independently
- High integration risk

### HITL vs AFK slices

- **HITL** (Human-In-The-Loop): requires human interaction, such as architecture decisions or design reviews
- **AFK** (Away From Keyboard): can be implemented and merged fully automatically, with no human interaction
- **Prefer AFK**: choose AFK slices wherever possible

## Process

### 1. Gather context

Work from the conversation context. If the user passes a requirements document reference (file path or content), read the full content.

### 2. Explore the codebase (optional)

If the codebase has not been explored yet, explore it to understand the current state of the code. Slice titles and descriptions should use the project's domain vocabulary and respect the ADRs for the relevant areas.

### 3. Draft the vertical slices

Break the plan into **tracer bullet** slices. Each slice is a thin vertical slice that cuts end-to-end through **all** integration layers, **not** a horizontal slice of one layer.

**Vertical slicing rules**:
- Each slice provides a narrow but **complete** path through every layer (schema, API, UI, tests)
- A finished slice can be demonstrated or verified independently
- Prefer multiple thin slices over a few thick slices

**Slice design principles**:

1. **End-to-end behavior**: describe end-to-end behavior, not layer-by-layer implementation
2. **Independently verifiable**: each slice can be tested independently once complete
3. **Explicit dependencies**: clearly identify dependencies between slices
4. **User value**: each slice should deliver a portion of user value

**Example**:

❌ **Horizontal slicing (wrong)**:
```
Slice 1: Create the database schema
Slice 2: Implement the API endpoints
Slice 3: Build the UI components
Slice 4: Write the tests
```

✅ **Vertical slicing (correct)**:
```
Slice 1: A user can create an order (complete path: schema → API → UI → tests)
Slice 2: A user can view the order list
Slice 3: A user can cancel an order
Slice 4: An administrator can process orders in bulk
```

### 4. Present to the user and confirm

Show the proposed breakdown as a numbered list. For each slice, show:

- **Title**: a short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must be completed first
- **User stories covered**: which user stories this resolves (if the source material has them)

**Ask the user**:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependencies correct?
- Should any slices be merged or split further?
- Are the right slices marked HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Generate the slice documents

For each approved slice, generate a slice document. Use the slice template below. These slices are considered ready for implementation, so generate them in dependency order (blockers first).

**Slice template**:

```markdown
# Slice {N}: {Title}

**Type**: AFK | HITL  
**Blocked by**: {numbers of blocking slices, or "None - can start immediately"}  
**User stories covered**: {user story description}

## What to build

A concise description of this vertical slice. Describe end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets—they go stale quickly. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose (state machine, reducer, schema, type shape), inline it here and note briefly that it came from the prototype. Trim to the decision-rich parts—not a working demo, just the parts that matter.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Technical layers involved

- **Schema**: {database/schema changes}
- **API**: {API endpoints/changes}
- **UI**: {UI components/changes}
- **Tests**: {test scope}

## Edge cases

- {edge case 1 and its handling strategy}
- {edge case 2 and its handling strategy}

## References

- Related requirements document: {link}
- Related ADR: {link}
- Prototype output: {if any}
```

### 6. Slice execution order

Execute the slices in dependency order:

1. **Identify blocking relationships**: which slices must be completed first
2. **Order**: produce the execution order (independent slices first)
3. **Parallel opportunities**: identify slices that can be executed in parallel
4. **Milestones**: each completed slice is a milestone

**Example execution order**:

```
Slice 1: A user can create an order (no dependencies)
  ↓
Slice 2: A user can view the order list (depends on slice 1)
Slice 3: A user can cancel an order (depends on slice 1)
  ↓ (slices 2 and 3 can run in parallel)
Slice 4: An administrator can process orders in bulk (depends on slices 2 and 3)
```

## Anti-patterns

### Anti-pattern 1: horizontal slicing

**Wrong**:
```
"We'll do the backend first, then the frontend"
```

**Right**:
```
"We'll do one complete user story first, from the database to the UI"
```

---

### Anti-pattern 2: slices that are too thick

**Wrong**:
```
"This slice implements all order management features"
```

**Right**:
```
"This slice only implements order creation; the other features come in later slices"
```

---

### Anti-pattern 3: slices that cannot be demonstrated independently

**Wrong**:
```
"This slice only does the database schema"
```

**Right**:
```
"This slice implements the complete order creation flow and can be demonstrated"
```

---

### Anti-pattern 4: unclear dependencies

**Wrong**:
```
Dependencies between slices are not identified
```

**Right**:
```
Clearly identified: slice 2 depends on slice 1
```

## Relationship to other Skills

| Skill | Relationship | Explanation |
|-------|------|------|
| **/sg-propose** | Predecessor | Slices are based on the OpenSpec tasks.md |
| **prototype** | Optional predecessor | Slice after prototype-validating the OpenSpec (optional) |
| **subagent-driven-development** | Successor | Slices can be distributed to sub-agents in parallel |
| **executing-plans** | Successor | Slices are executed as part of the plan |

## Red lines

- ❌ Creating horizontal slices (only one layer)
- ❌ Slices that cannot be demonstrated independently
- ❌ Unclear dependencies
- ❌ Slices that are too thick (should be split into multiple thin slices)
- ❌ Generating slices without user confirmation

---

**The final state is a set of approved slice documents, executed in dependency order.** Each slice is an independent, demonstrable, end-to-end delivery of user value.
