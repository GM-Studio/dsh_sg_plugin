# Spec Vertical Slicing Rules

> **Loading**: Materialized into `.specgate/templates/rules/` by `dsh-plugin-specgate`; DSH does not inject it automatically, so the AI must consult it proactively when handling the corresponding task (the core summary is inlined into `AGENTS.md`).
> **Purpose**: Enforces how OpenSpec specs are sliced; horizontal slicing is prohibited.
> **Priority**: Hard rule (must be followed every time specs are created or reviewed).

---

## Core Principle

**Each Spec must describe one end-to-end user-value path that can be demonstrated and verified independently; slicing horizontally by technical component/layer is prohibited.**

---

## Mandatory Requirements

### 1. Definition of a Vertical Slice

- Must: slice specs vertically by "end-to-end user value": from input to output, crossing every technical layer
- Must: each spec describes one complete behavior path that can be compiled, tested, and verified independently
- Must: each spec has one explicit "demo scenario": what the user does → what the system returns

### 2. Horizontal Slicing Is Prohibited

- Prohibited: creating a separate spec per technical component (e.g., Fetcher, Extractor, Classifier)
- Prohibited: creating a separate spec per technical layer (e.g., API layer, Service layer, DAO layer)
- Prohibited: creating a separate spec per module/package name (e.g., pipeline-core, entity-matching)

---

## Vertical Slicing Example

### Correct: slicing by user value

| Spec | User scenario | End-to-end path |
|------|---------------|-----------------|
| V1: Basic site type detection | Input a URL → return the site type | URL → Fetch → Extract → Classify → type result |
| V2: Full classification of video sites | Input a video site URL → return the full classification | URL → Fetch → Extract → compliance check → entity matching → multi-dimensional classification → result |
| V3: Batch site classification | Input a list of URLs → return batch results | URLs → concurrent Fetch → per-site classification → aggregated result |

### Incorrect: horizontal slicing by component

| Spec | Problem |
|------|---------|
| H1: Fetcher implementation | Covers only one layer; cannot independently verify end-to-end user value |
| H2: Extractor implementation | Same as above |
| H3: Entity Matcher implementation | Same as above |

---

## Review Checkpoints

`sg-skill-critical-review` must check the following during execution:

- [ ] Does each Spec describe an end-to-end demonstrable user value?
- [ ] Are the specs sliced horizontally by technical component/layer? (If so, this is a fatal problem and the specs must be re-sliced)
- [ ] Can each Spec be compiled, tested, and verified independently?
- [ ] Do the specs differ by clear user value (rather than by technical implementation)?

---

## Relationship to /sg-propose

- The `/sg-propose` command is a neutral template generation tool and does not decide the slicing strategy
- The slicing strategy is governed by this rule and takes effect when the AI generates specs
- The problem is not that "the openspec command doesn't work", but that this constraint rule was missing
