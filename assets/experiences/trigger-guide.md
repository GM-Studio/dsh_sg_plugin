# Knowledge Retrieval Trigger Guide

> This document guides Agents on which knowledge assets to retrieve in different task scenarios.
> 
> **Scope**: all SpecGate project Agents

---

## 🎯 Retrieval Decision Tree

```
Task received
  ↓
Determine task type
  ↓
├─ Tool/framework research → retrieve tool-research/
├─ Coding implementation → retrieve best-practices/ (domain:coding)
├─ Troubleshooting → retrieve pitfall-records/
├─ Architecture design → retrieve decisions/
└─ Configuration changes → retrieve best-practices/ (domain:config)
```

---

## 📋 Scenario-to-Knowledge Mapping

| Scenario | Directory to retrieve | Keyword filter | Priority |
|----------|-----------------------|----------------|----------|
| Choosing a new tool/framework | `tool-research/` | `tool:<tool-name>` | P0 |
| Writing new feature code | `best-practices/` | `domain:coding` | P1 |
| Hitting a bug/error | `pitfall-records/` | `type:pitfall` | P0 |
| Making a technical decision | `decisions/` | `type:adr` | P1 |
| Modifying configuration files | `best-practices/` | `domain:config` | P1 |
| Writing tests | `best-practices/` | `domain:testing` | P2 |
| Code review | `best-practices/` | `domain:review` | P2 |

---

## 🔑 Keyword Conventions

### Role tags
- `agent:developer` - developer-related
- `agent:architect` - architect-related
- `agent:reviewer` - reviewer-related
- `agent:shared` - shared knowledge

### Domain tags
- `domain:coding` - coding implementation
- `domain:testing` - testing-related
- `domain:config` - configuration management
- `domain:review` - code review
- `domain:architecture` - architecture design

### Type tags
- `type:tool-research` - tool research
- `type:best-practice` - best practice
- `type:pitfall` - pitfall record
- `type:adr` - architecture decision

### Frequency tags
- `frequency:high` - high-frequency use
- `frequency:medium` - medium-frequency use
- `frequency:low` - low-frequency use

---

## 💡 Retrieval Tips

1. **Prefer high-frequency knowledge**: experiences tagged `frequency:high` have been validated repeatedly
2. **Narrow the scope by task type**: filter with `domain:` tags
3. **Widen the scope when retrieval fails**: drop the domain tags and keep only the type
4. **Check ADRs on conflict**: architecture decision records carry the highest authority

---

## ⚠️ Cautions

- ❌ Do not retrieve outdated knowledge (check the `lastVerified` date)
- ❌ Do not apply experiences that don't match the current tech stack
- ✅ Verify the applicability of the knowledge after retrieval
- ✅ Trigger the KE Agent for adjudication when a knowledge conflict is found

---

**Maintainer**: {{projectName}} Knowledge Engineer  
**Update timing**: when adding knowledge categories or adjusting the retrieval strategy
