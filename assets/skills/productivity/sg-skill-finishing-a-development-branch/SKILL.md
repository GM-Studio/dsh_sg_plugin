---
name: sg-skill-finishing-a-development-branch
version: 0.1.0
description: "Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides the completion of development work by presenting structured options for merge, PR, or cleanup"
---

# Finishing a Development Branch

## Overview

Guide the completion of development work by presenting clear options and handling the chosen workflow.

**Core principle:** Verify tests → present options → execute the choice → clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## Process

### Step 1: Verify Tests

**Before presenting options, verify the tests pass:**

```bash
# Run the project's test suite
npm test / cargo test / pytest / go test ./...
```

**If tests fail:**
```
Tests failing (<N>). Must fix before continuing:

[show failure information]

Cannot proceed to merge or create a PR until tests pass.
```

Stop. Do not continue to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Determine the Base Branch

```bash
# Try the common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch came off main — is that right?"

### Step 3: Present Options

Present exactly these 4 options:

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as is (I'll handle it later)
4. Discard this work

Which option?
```

**Do not add explanations** — keep the options concise.

### Step 4: Execute the Choice

#### Option 1: Merge Locally

```bash
# Switch to the base branch
git checkout <base-branch>

# Pull the latest
git pull

# Merge the feature branch
git merge <feature-branch>

# Verify the tests on the merge result
<test command>

# If the tests pass
git branch -d <feature-branch>
```

Then: clean up the worktree (Step 5)

#### Option 2: Push and Create a PR

```bash
# Push the branch
git push -u origin <feature-branch>

# Create the PR
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullet points of changes>

## Test Plan
- [ ] <verification steps>
EOF
)"
```

Then: clean up the worktree (Step 5)

#### Option 3: Keep as Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Do not clean up the worktree.**

#### Option 4: Discard

**Confirm first:**
```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for the exact confirmation.

If confirmed:
```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then: clean up the worktree (Step 5)

### Step 5: Clean Up the Worktree

**For options 1, 2, and 4:**

Check whether you are in a worktree:
```bash
git worktree list | grep $(git branch --show-current)
```

If so:
```bash
git worktree remove <worktree-path>
```

**For option 3:** Keep the worktree.

## Quick Reference

| Option | Merge | Push | Keep Worktree | Clean Up Branch |
|--------|-------|------|---------------|-----------------|
| 1. Merge locally | ✓ | - | - | ✓ |
| 2. Create PR | - | ✓ | ✓ | - |
| 3. Keep as is | - | - | ✓ | - |
| 4. Discard | - | - | - | ✓ (force) |

## Common Mistakes

**Skipping test verification**
- **Problem:** Merging broken code and creating a failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**
- **Problem:** "What should I do?" → vague
- **Fix:** Present exactly the 4 structured options

**Automatically cleaning up the worktree**
- **Problem:** Removing the worktree when it may still be needed (options 2, 3)
- **Fix:** Clean up only for options 1 and 4

**Discarding without confirmation**
- **Problem:** Accidentally deleting work
- **Fix:** Require typing "discard" to confirm

## Red Flags

**Never:**
- Continue when tests are failing
- Merge without verifying the test results
- Delete work without confirmation
- Force push without an explicit request

**Always:**
- Verify tests before presenting options
- Present exactly the 4 options
- Get typed confirmation for option 4
- Clean up the worktree only for options 1 and 4

## Integration

**Called by:**
- **subagent-driven-development** (Step 7) — after all tasks complete
- **executing-plans** (Step 5) — after all batches complete

**Pairs with:**
- **using-git-worktrees** — cleans up the worktree created by that skill
