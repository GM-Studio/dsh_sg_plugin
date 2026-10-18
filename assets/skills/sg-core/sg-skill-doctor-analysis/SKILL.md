---
name: sg-skill-doctor-analysis
description: "SpecGate project health check analysis Skill. Load when the user asks for a health check or project health, wants to see project status, or when a comprehensive assessment is needed before or after an upgrade. The Skill instructs the Agent to orchestrate `specgate doctor --json` + `git diff` and output actionable improvement recommendations."
---

# Project Health Check Analysis Skill

## Purpose

Combine the deterministic evidence produced by `specgate doctor` with the project's current local modifications (`git diff`) to produce actionable improvement recommendations for this project.

**Responsibility layering** (following the project's "CLI and LLM responsibility layering" decision):

| Layer | Performed by | Output |
|------|--------|------|
| Evidence collection | `specgate doctor --json` (TS, deterministic) | Structured health snapshot |
| Diff retrieval | `git status` + `git diff` (Git, deterministic) | List of user's local modifications |
| Synthesis and interpretation | Agent + this Skill (LLM, creative) | Improvement recommendations for this project |

## Trigger Conditions

- The user says "health check", "project health", "see how the project is doing now", "check before upgrading", "what else needs handling after the upgrade"
- The main Agent needs to understand project status before a heavy modification
- The Reviewer Agent needs a project-wide background during review

## Execution Steps

### 1. Collect Evidence (must be executed in order)

```bash
# 1.1 Run the health check
specgate doctor --json > /tmp/sg-doctor.json

# 1.2 Query uncommitted local modifications
git status --porcelain
git diff --stat
git diff --unified=3 -- '.specgate' '.qoder' 'AGENTS.md' 'package.json'
```

- If `specgate doctor` is unavailable (project not initialized), fall back directly to guiding the user through `specgate init`.
- If not inside a git repository, skip the git steps and base recommendations solely on the doctor JSON.

### 2. Analyze the JSON Structure

`DoctorReport` top-level fields:

- `overall`: `pass` / `warn` / `fail` (corresponding to overall health)
- `sections[]`: 6 fixed sections (environment/project structure/snapshot consistency/pending upgrades/custom assets/upgrade conflict residue)
- `summary`: pass/warn/fail counts
- `meta`: project/CLI/Node versions

Each `check` contains: `id`, `title`, `severity`, `message`, and optional `hint` and `details`.

### 3. Interpretation and Recommendation Mapping

For every **non-pass** check, make a recommendation in the three-part form "root cause → risk → concrete action":

| check.id | Common root cause | Recommended action |
|----------|----------|----------|
| `struct.specgate-dir` fail | Project not initialized | `specgate init` |
| `struct.config` fail | YAML corrupted by manual edits | Restore from `.specgate/backups/` or run `specgate init --force` |
| `struct.snapshot` warn | Never upgraded since initialization | Run `specgate upgrade --dry-run` to establish a baseline |
| `snapshot.missing` fail | File accidentally deleted | Use `git log -- <path>` to decide whether to restore it |
| `snapshot.modified` warn | Deliberate user customization | Confirm whether it is customization or an oversight → capture it as experience or roll it back as appropriate |
| `upgrade.pending` warn | Template updated | Run `specgate upgrade --dry-run` to review the details before deciding |
| `custom.qoder` pass | User has custom Agents/Skills | Suggest putting them under version control so upgrade does not overwrite them |
| `conflict.residue` warn | Previous upgrade left .new files unmerged | Compare `<path>` vs `<path>.new` one by one and keep the better one |

### 4. Correlate with `git diff` for Relevance Determination

- If the file flagged by `snapshot.modified` **appears in `git diff`**: this is an in-progress user customization, so there is no need to worry; remind the user to "remember to commit".
- If the file flagged by `snapshot.modified` **is already committed** and deviates from the template: warn that "the next upgrade will produce a .new conflict".
- If a `.new` file from `conflict.residue` **is not covered by any diff**: the user genuinely forgot to handle it; recommend merging first.
- If an add item under `upgrade.pending` relates to new functionality in `git diff`: advise the user to run `specgate upgrade` before continuing development, to avoid conflicts.

### 5. Output Format

Output strictly in the following Markdown structure so the user can scan it quickly:

```markdown
## 🩺 Project Health Check Results

**Overall**: {pass|warn|fail} ({summary})

### ❗ Needs Immediate Action
- {one line per item: severity icon + issue description + recommended command}

### ⚠️  Worth Watching
- ...

### ✅ All Clear
- ...

### 💡 Observations from Local Modifications
- {targeted insight based on git diff}

### 🎯 Recommended Next Steps
1. {at most 3 actionable items, ordered by priority}
```

## Key Red Lines

- ❌ Do not skip `specgate doctor --json` and give conclusions from guesswork
- ❌ Do not fabricate `check.id` values (they must correspond to the real ids produced by the CLI)
- ❌ Do not recommend irreversible commands such as `rm -rf`
- ✅ Any "file missing" recommendation must first check history with `git log` / `git show`
- ✅ Do not over-alert at warn level, to avoid alert fatigue

## Output Constraints

- Keep the length within 40 lines and emphasize what is actionable
- Do not repeat the `message` from the JSON; output only "what it means in your project"
- If `overall=pass` and there is no `git diff`, a single-sentence answer suffices: "Health check passed, nothing pending"
