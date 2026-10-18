# Engineering Skills

Skills related to day-to-day code work, covering core engineering capabilities such as requirements analysis, architecture design, development process, and code quality.

---

## 📋 Skills List

### SpecGate Core Skills

> **Note**: SpecGate core Skills have moved to the `../sg-core/` directory; only index references remain here.

| Skill | Description | Trigger Scenario |
|-------|-------------|------------------|
| [sg-skill-requirements-definition](sg-skill-requirements-definition/SKILL.md) | Requirements Definition - Conduct in-depth requirements interrogation before creative work | Creating a new feature, building a component, adding functionality, changing behavior |
| [sg-skill-architecture-design](sg-skill-architecture-design/SKILL.md) | Architecture Design - Design the technical solution after requirements are approved | Requirements document complete, ready to enter the implementation phase |
| [sg-skill-critical-review](sg-skill-critical-review/SKILL.md) | Critical Review - Independently review document quality | Document complete, before archiving |
| [sg-skill-code-review](sg-skill-code-review/SKILL.md) | Code Review - Verify code quality before merging | Task complete, major feature implemented, before merging |
| [sg-skill-domain-modeling](sg-skill-domain-modeling/SKILL.md) | Domain Modeling - Establish the domain language and model | Complex business logic design |
| [sg-skill-improve-architecture](sg-skill-improve-architecture/SKILL.md) | Architecture Improvement - Discover opportunities for architectural deepening | Regular runs, architectural problems found during debugging |
| [sg-skill-triage-brief](sg-skill-triage-brief/SKILL.md) | Task Triage - Generate a structured Agent Brief | Task assignment, Issue creation |
| [sg-skill-vertical-slicing](sg-skill-vertical-slicing/SKILL.md) | Vertical Slicing - Decompose tasks into deliverable slices | Implementation plan decomposition |

**Moved to sg-core/**:
- `sg-skill-anti-patterns` → [../sg-core/sg-skill-anti-patterns.md](../sg-core/sg-skill-anti-patterns.md)
- `sg-skill-change-classification` → [../sg-core/sg-skill-change-classification.md](../sg-core/sg-skill-change-classification.md)
- `sg-skill-harness-design` → [../sg-core/sg-skill-harness-design.md](../sg-core/sg-skill-harness-design.md)

### Engineering Practice Skills

| Skill | Description | Trigger Scenario |
|-------|-------------|------------------|
| [sg-skill-test-driven-development](sg-skill-test-driven-development/SKILL.md) | TDD - Test-Driven Development | Before implementing any feature or bug fix |
| [sg-skill-systematic-debugging](sg-skill-systematic-debugging/SKILL.md) | Systematic Debugging - Root cause tracing and fixing | Any error or test failure |
| [sg-skill-writing-skills](sg-skill-writing-skills/SKILL.md) | Writing Skills - Create/edit Skill documentation | Creating a new Skill, editing an existing Skill |

---

## 🎯 Usage Guide

### Typical Workflow

```
Requirements Definition (requirements-definition)
  ↓ Produces requirements document
  ↓
Critical Review (critical-review)
  ↓ Review passed
  ↓
Architecture Design (architecture-design)
  ↓ Produces architecture document
  ↓
Critical Review (critical-review)
  ↓ Review passed
  ↓
Vertical Slicing Decomposition (vertical-slicing)
  ↓ Produces implementation plan
  ↓
TDD Development Loop (test-driven-development)
  ↓ RED → GREEN → REFACTOR
  ↓
Code Review (code-review)
  ↓ Fix issues
  ↓
Verification Before Completion (verification-before-completion)
  ↓ Tests pass
  ↓
Merge ✅
```

### Constitutional Safeguards

SpecGate uses a **dual safeguard mechanism** to ensure document quality:

1. **First line of defense**: Designer self-check (requirements-definition / architecture-design)
2. **Second line of defense**: Independent reviewer (critical-review)
3. **Both lines of defense pass** → The document can be archived

---

## 📚 References

- [AGENTS.md](../../../../AGENTS.md) - AI behavior directives and Skill usage conventions
- [CONTEXT.md](../../../../CONTEXT.md) - Domain context and glossary
