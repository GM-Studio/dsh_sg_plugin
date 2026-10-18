# Agent Briefs Storage Directory

This directory stores generated Agent Brief documents.

## Naming Convention

- Use lowercase English
- Separate words with `-`
- Examples: `user-authentication.md`, `order-cancellation.md`

## Generation Timing

After the requirements document passes critical-review, a Brief must be generated if the requirements meet any of the following complexity conditions:

- Estimated implementation time > 2 hours
- Involves modifications to more than 2 modules
- Requires modifying more than 3 files
- Involves API/function signature changes

## Brief Content

Each Brief must include:

1. **Summary** - 1-2 sentences describing what to do + why
2. **Current behaviour** - current state
3. **Desired behaviour** - expected state
4. **Key interfaces** - core interfaces
5. **Acceptance criteria** - Given/When/Then format
6. **Out of scope** - what will explicitly not be done
7. **Reference files** - file paths
8. **Constraints** - constraints

## Relationship to OpenSpec

- A Brief is the **bridge** between the requirements document and implementation
- A Brief focuses on **what to do** (What) and **acceptance criteria** (Acceptance)
- An OpenSpec Spec focuses on **how to design** (How) and **technical details**
- A Brief is generated before the Spec, providing requirements context for the Spec
