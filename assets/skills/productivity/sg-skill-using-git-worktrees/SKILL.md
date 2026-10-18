---
name: sg-skill-using-git-worktrees
version: 0.2.0
description: "Use when starting feature work that needs to be isolated from the current workspace, or before executing an implementation plan - creates an isolated git worktree with smart directory selection and safety verification"
---

# Using Git Worktrees

## Overview

Git worktrees create isolated workspaces that share the same repository, letting you work on multiple branches at once without switching.

**Core principle:** Systematic directory selection + safety verification = reliable isolation.

**Announce at start:** "I'm using the using-git-worktrees skill to set up an isolated workspace."

## Directory Selection Flow

Follow this priority order:

### 1. Check for Existing Directories

```bash
# Check in priority order
ls -d .worktrees 2>/dev/null     # preferred (hidden)
ls -d worktrees 2>/dev/null      # alternative
```

**If found:** use that directory. If both exist, `.worktrees` wins.

### 2. Check CLAUDE.md

```bash
grep -i "worktree.*director" CLAUDE.md 2>/dev/null
```

**If a preference is specified:** use it directly, no need to ask.

### 3. Ask the User

If the directory does not exist and CLAUDE.md has no preference:

```
No worktree directory found yet. Where should I create worktrees?

1. .worktrees/ (project-local, hidden)
2. ~/.specgate/worktrees/<project-name>/ (global location)

Which do you prefer?
```

## Safety Verification

### For Project-Local Directories (.worktrees or worktrees)

**You must verify that the directory is ignored before creating the worktree:**

```bash
# Check whether the directory is ignored (honors local, global, and system gitignore)
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

**If it is not ignored:**

Per Jesse's rule "fix broken things immediately":
1. Add the appropriate line to .gitignore
2. Commit the change
3. Continue creating the worktree

**Why this matters:** it prevents accidentally committing worktree contents into the repository.

### For Global Directories (~/.specgate/worktrees)

No .gitignore verification needed — entirely outside the project.

## Creation Steps

### 1. Detect the Project Name

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
```

### 2. Create the Worktree

```bash
# Determine the full path
case $LOCATION in
  .worktrees|worktrees)
    path="$LOCATION/$BRANCH_NAME"
    ;;
  ~/.specgate/worktrees/*)
    path="~/.specgate/worktrees/$project/$BRANCH_NAME"
    ;;
esac

# Create the worktree with a new branch
git worktree add "$path" -b "$BRANCH_NAME"
cd "$path"
```

### 3. Run Project Setup

Auto-detect and run the appropriate setup:

```bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

### 4. Verify a Clean Baseline

Run the tests to make sure the worktree starts clean:

```bash
# Example — use the command appropriate to the project
npm test
cargo test
pytest
go test ./...
```

**If tests fail:** report the failures and ask whether to continue or investigate.

**If tests pass:** report that it is ready.

### 5. Report the Location

```
Worktree ready at <full-path>
Tests passing (<N> tests, 0 failures)
Ready to implement <feature-name>
```

## Quick Reference

| Situation | Action |
|-----------|--------|
| `.worktrees/` exists | Use it (verify it is ignored) |
| `worktrees/` exists | Use it (verify it is ignored) |
| Both exist | Use `.worktrees/` |
| Neither exists | Check CLAUDE.md → ask the user |
| Directory is not ignored | Add to .gitignore + commit |
| Baseline tests fail | Report the failures + ask |
| No package.json/Cargo.toml | Skip dependency installation |

## Common Mistakes

### Skipping Ignore Verification

- **Problem:** Worktree contents get tracked, polluting git status
- **Fix:** Always use `git check-ignore` before creating a project-local worktree

### Assuming the Directory Location

- **Problem:** Creates inconsistency and violates project conventions
- **Fix:** Follow the priority: existing > CLAUDE.md > ask

### Continuing When Tests Fail

- **Problem:** Cannot distinguish new bugs from pre-existing ones
- **Fix:** Report the failures, get explicit permission, then continue

### Hardcoding Setup Commands

- **Problem:** Fails on projects that use different tooling
- **Fix:** Auto-detect from project files (package.json, etc.)

## Example Workflow

```
You: I'm using the using-git-worktrees skill to set up an isolated workspace.

[Check .worktrees/ - exists]
[Verify it is ignored - git check-ignore confirms .worktrees/ is ignored]
[Create worktree: git worktree add .worktrees/auth -b feature/auth]
[Run npm install]
[Run npm test - 47 passing]

Worktree ready at /Users/jesse/myproject/.worktrees/auth
Tests passing (47 tests, 0 failures)
Ready to implement the auth feature
```

## Red Flags

**Never:**
- Create a worktree without verifying it is ignored (project-local)
- Skip baseline test verification
- Continue when tests fail without asking
- Assume when the directory location is ambiguous
- Skip the CLAUDE.md check

**Always:**
- Follow the directory priority: existing > CLAUDE.md > ask
- Verify that the project-local directory is ignored
- Auto-detect and run project setup
- Verify a clean test baseline

## Integration

**Called by:**
- **requirements-grilling** (Phase 4) — required when the design is approved and implementation follows
- **subagent-driven-development** — required before executing any task
- **executing-plans** — required before executing any task
- Any skill that needs an isolated workspace

**Pairs with:**
- **finishing-a-development-branch** — required for cleanup after the work is complete
