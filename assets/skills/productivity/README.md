# Productivity Skills

Skills related to non-code workflows, covering productivity tools such as Git workflows, plan management, and parallel execution.

---

## 📋 Skills List

| Skill | Description | Trigger Scenario |
|-------|-------------|------------------|
| [sg-skill-using-git-worktrees](sg-skill-using-git-worktrees/SKILL.md) | Git worktrees - create an isolated development environment | Starting new feature development, executing an implementation plan |
| [sg-skill-finishing-a-development-branch](sg-skill-finishing-a-development-branch/SKILL.md) | Finish a development branch - merge/PR/cleanup | Implementation complete, tests passing |
| [sg-skill-writing-plans](sg-skill-writing-plans/SKILL.md) | Writing plans - planning multi-step tasks | Before touching code, complex tasks |
| [sg-skill-executing-plans](sg-skill-executing-plans/SKILL.md) | Executing plans - execute according to a written plan | After a written implementation plan exists |

---

## 🎯 Usage Guide

### Git Workflow

```
Start a new feature
  ↓
Use Git Worktree (using-git-worktrees)
  ↓ create an isolated branch
  ↓
Write the plan (writing-plans)
  ↓ task breakdown
  ↓
Execute the plan (executing-plans)
  ↓ show progress, execute in batches
  ↓
Subagent development (subagent-driven-development) [optional]
  ↓ parallel independent tasks
  ↓
Finish the branch (finishing-a-development-branch)
  ↓ merge/PR/cleanup
  ↓
Integration complete ✅
```

### Parallel Execution Strategy

When there are 2+ independent tasks:
1. Use `dispatching-parallel-agents` to dispatch the tasks
2. Each task runs independently with no shared state
3. Aggregate the results after all tasks complete

---

## 📚 References

- `AGENTS.md` - AI behavior instructions and skill usage rules
- DSH plugin `src/guards.js` - write guards and gate checks (no Git Hook dependency)
