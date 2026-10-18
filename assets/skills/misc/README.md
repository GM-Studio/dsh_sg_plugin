# Misc Skills

Occasionally used skills covering auxiliary capabilities such as prototyping, knowledge research, experience summarization, and terminology management.

---

## 📋 Skills List

| Skill | Description | Trigger Scenario |
|-------|-------------|------------------|
| [sg-skill-prototype](sg-skill-prototype/SKILL.md) | Prototyping - quickly validate a solution | Logic/state model validation, UI solution exploration |
| [sg-skill-terminology-management](sg-skill-terminology-management/SKILL.md) | Terminology management - unify the domain language | Detecting terminology conflicts, updating CONTEXT.md |
| [sg-skill-zoom-out](sg-skill-zoom-out/SKILL.md) | Zoom out - macro-level analysis | Architecture decisions, systemic issues |

**Moved to sg-core/**:
- `sg-skill-entry-guard` → [../sg-core/sg-skill-entry-guard.md](../sg-core/sg-skill-entry-guard.md)
- `sg-skill-experience-summarization` → [../sg-core/sg-skill-experience-summarization.md](../sg-core/sg-skill-experience-summarization.md)
- `sg-skill-knowledge-research` → [../sg-core/sg-skill-knowledge-research.md](../sg-core/sg-skill-knowledge-research.md)

---

## 🎯 Usage Guide

### Prototyping Flow

```
Clarify the validation goal
  ↓
Choose the prototype type
  ├─ LOGIC prototype: is the logic/state model correct?
  └─ UI prototype: what should it look like?
  ↓
Follow the 6 iron rules
  1. Disposable from day one
  2. Run with one command
  3. No persistence by default
  4. Skip polish (no tests, no error handling)
  5. Show the full state after every operation
  6. Delete or absorb it when done
  ↓
Capture knowledge
  └─ Record the prototype answer in a durable place (commit message, ADR, issue)
```

### When to Capture Experience

- ✅ After completing a complex feature
- ✅ After solving a thorny problem
- ✅ When discovering a new best practice
- ✅ When encountering important lessons and pitfalls

---

## 📚 References

- [AGENTS.md](../../../../AGENTS.md) - AI behavior instructions and skill usage rules
- [Experience document index](../../../../.specgate/experiences/index.md) - Captured knowledge assets
