# Skills Directory Index

> The complete capability system of the specgate DSH plugin, organized by usage scenario.

---

## 📂 Directory Structure

```
skills/
├── sg-core/            # specgate core Skills (12)
├── engineering/          # Day-to-day code work (11 Skills)
├── productivity/         # Non-code workflows (4 Skills)
├── misc/                 # Occasional use (3 Skills)
└── README.md             # This file
```

> All 30 Skills are registered by the plugin when a DSH session starts; `/sg-init` additionally materializes them into the project's `.dsh/skills/specgate/`.

---

## 🎯 Quick Lookup

| Scenario | Recommended Skill | Location |
|------|-----------|------|
| **Starting a new feature** | `sg-skill-requirements-definition` → `sg-skill-architecture-design` | [engineering/](engineering/README.md) |
| **Before writing code** | `sg-skill-test-driven-development` | [engineering/](engineering/README.md) |
| **When an error occurs** | `sg-skill-systematic-debugging` | [engineering/](engineering/README.md) |
| **Before merging** | `sg-skill-code-review` | [engineering/](engineering/README.md) |
| **Before archiving docs** | `sg-skill-critical-review` | [engineering/](engineering/README.md) |
| **Planning a complex task** | `sg-skill-writing-plans` → `sg-skill-executing-plans` | [productivity/](productivity/README.md) |
| **Git branch management** | `sg-skill-using-git-worktrees` → `sg-skill-finishing-a-development-branch` | [productivity/](productivity/README.md) |
| **Validating an approach** | `sg-skill-prototype` | [misc/](misc/README.md) |
| **Knowledge capture** | `sg-skill-experience-summarization` | [sg-core/](sg-core/) |
| **Entry triage** | `sg-skill-entry-guard` | [sg-core/](sg-core/) |
| **Spec-driven development** | `/sg-propose` command → OpenSpec workflow | DSH commands |

---

## 📊 Category Counts

| Category | Skill Count | Description |
|------|------------|------|
| [sg-core/](sg-core/) | 12 | Entry triage, change classification, anti-patterns, architecture design, knowledge research, experience summarization, etc. |
| [engineering/](engineering/README.md) | 11 | Requirements analysis, architecture design, TDD, debugging, code review, etc. |
| [productivity/](productivity/README.md) | 4 | Git workflow, plan management, etc. |
| [misc/](misc/README.md) | 3 | Prototyping, terminology management, big-picture perspective, etc. |
| **Total** | **30** | - |

---

## 📚 Usage

### Full Guide

- [sg-using-skills](sg-core/sg-using-skills/SKILL.md) - How to find and use Skills

### Constitutional Safeguards

specgate uses a **dual safeguard mechanism**:

1. **First line of defense**: author self-check (`sg-skill-requirements-definition` / `sg-skill-architecture-design`)
2. **Second line of defense**: independent reviewer (`sg-skill-critical-review`)
3. **Both lines of defense pass** → the document can be archived

### Skills That Must Be Used

According to `AGENTS.md`, the following scenarios **must** use the corresponding Skill:

- ✅ Before creative work → `sg-skill-requirements-definition`
- ✅ After requirements are approved → `sg-skill-architecture-design`
- ✅ Before archiving docs → `sg-skill-critical-review`
- ✅ Before writing code → `sg-skill-test-driven-development`
- ✅ When an error occurs → `sg-skill-systematic-debugging`
- ✅ Before merging → `sg-skill-code-review`

---

## 🔗 Related Resources

- `AGENTS.md` - AI behavior instructions and Skill usage rules
- `CONTEXT.md` - Domain context and glossary
- `.specgate/experiences/index.md` - Captured knowledge assets
- `.specgate/agents/` - Available Agent role texts
