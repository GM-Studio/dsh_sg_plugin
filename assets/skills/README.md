# Skills Directory Index

> The complete capability system of the specgate DSH plugin, organized by usage scenario.

> 22 skills ship as plugin assets: 17 `sg-skill-*` under `assets/skills/` and 5 `sp-skill-*` under `assets/sp/`. They are **not** registered in the DSH session skill catalog and are never materialized into a project's `.dsh/skills/`. `src/v3/skills.js` injects the matching bodies into subagent prompts by role/phase; to read one directly, use the `sg-skill` tool or `/sg-skill <name>`.

---

## 📂 Directory Structure

```
skills/
├── sg-core/            # specgate core Skills (1)
├── engineering/          # Day-to-day code work (10 Skills)
├── productivity/         # Non-code workflows (4 Skills)
├── misc/                 # Occasional use (2 Skills)
└── README.md             # This file
```

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

---

## 📊 Category Counts

| Category | Skill Count | Description |
|------|------------|------|
| [sg-core/](sg-core/) | 1 | Anti-patterns |
| [engineering/](engineering/README.md) | 10 | Requirements analysis, architecture design, TDD, debugging, code review, etc. |
| [productivity/](productivity/README.md) | 4 | Git workflow, plan management, etc. |
| [misc/](misc/README.md) | 2 | Prototyping, big-picture perspective, etc. |
| **Total** | **22** | - |

---

## 📚 Usage

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
- [experiences/index.md](../experiences/index.md) - Captured knowledge assets
