# Plugin Architecture (v0.3)

This document describes the layering, extension points, and data flow of `dsh-plugin-specgate`. For the
requirements baseline, see [requirements-confirmation.md](requirements-confirmation.md).

## 1. Design Goals

- **Host-only first**: Does not depend on Client plugins and does not require a Web UI in order to work.
- **Zero external runtime dependencies**: Uses only Node built-in modules, avoiding network and version risks at install time.
- **Project-level opt-in**: The plugin can be installed into a profile, but it intercepts writes only when `.specgate/` is detected or the plugin is explicitly enabled.
- **Files as the source of truth**: `.specgate/` and `openspec/` are the sources of state; `.specgate/state/` stores only deletable idempotency/dispatch records, which doctor can audit.
- **Removable**: After the plugin is removed, project files remain readable; no required files are generated that only the plugin can parse.

## 2. DSH Extension Points Used

| Extension point | Purpose | Degradation when unavailable |
|-----------------|---------|------------------------------|
| `ctx.tools.register` | Tools such as `sg_status`, `sg_gate`, and `sg_propose` | Plugin unavailable (core capability) |
| `ctx.tools.guard` | Checks gates before `write`/`edit` | Degrades to a soft reminder |
| `ctx.on('tools/post-execute')` | Invalidates downstream gates after a successful write | Gates may become stale, but are never incorrectly allowed through |
| `ctx.systemPrompt.context` | Injects the current Change, gates, and next step | Fewer hints only; tools unaffected |
| `ctx.commands.register` | `/sg-*`, `/sg-*` commands | Commands unavailable; tools still usable |
| `ctx.skills.register` | 30 built-in Skills (runtime fallback) | Relies on project `.dsh/skills/specgate/` |
| `ctx.userQuestions.ask` | Structured questions for gate confirmation/waiving | Cannot confirm safely; fail closed |
| `ctx.agents.create` | `/sg-apply` worktree sub-agents; `/sg-doctor` parallel health check | Degrades to serial / local doctor |
| `ctx.inject` | Waits for the `commands`/`skills`/`systemPrompt` services to be ready | Skips the corresponding capability when the service is missing |

## 3. Modules

```text
index.js                 Plugin entry: apply + registration/cleanup
src/
├── constants.js         Gate definitions, write requirements, paradigm exemptions, source/test detection
├── util.js              Files, YAML subset, paths, frontmatter
├── project.js           Project root, .specgate/config.yaml, enablement and paradigm
├── gates.js             confirmed/waived markers, missing/invalid
├── openspec.js          Change/Artifact state inference, propose/archive
├── status.js            Status summary, next step, hint text, cache
├── deviations.js        append-only deviation log
├── classify.js          L1/L2/L3 heuristics
├── doctor.js            Integrity/contradiction/format checks
├── init.js              Initialization, enable/disable, new directories, AGENTS.md merge
├── assets.js            Skill/Agent/template/doc/example materialization and content adaptation
├── git.js               Git repository initialization, status, commit
├── runtime.js           cwd resolution, write gating, post-write invalidation
├── gate-actions.js      Gate status/confirm/waive
├── idempotency.js       Operation keys, state records, 24h dedupe, concurrency lock
├── mutations.js         Idempotent execution of mutating commands and project integrity checks
├── task-graph.js        [P]/depends/role parsing and waves for tasks.md
├── worktree.js          Git worktree create/merge/cleanup/conflict
├── dispatch.js          Agent dispatch, worktree orchestration, parallel doctor
├── tools.js             Tool registration
├── commands.js          Command registration
├── prompt.js            System prompt injection
├── guards.js            guard + post-execute
└── skills.js            Runtime Skill registration
```

## 4. Gate Model

Gate order (`GATE_ORDER`):

```text
G1 Requirements → G2 Classification → G3 proposal → G4 design → G5 specs → G6 tasks
→ G6.5 Brief (optional) → G7 Implementation → G8 Review → G9 Commit → G10 Acceptance → G11 Branch
```

Write preconditions (`ARTIFACT_REQUIREMENTS`):

| Target | Prerequisite gates |
|--------|--------------------|
| `proposal.md` | G1, G2 |
| `design.md` | G1, G2, G3 |
| `specs/**` | G1, G2, G3, G4 |
| `tasks.md` | G1, G2, G3, G4, G5 |
| Test files | G1-G6 |
| Source code | G1-G7 |

L3 (defect fix) exempts `G1`, `G3`, `G4`, `G5`, and `G6.5`; therefore writing source code requires only `G2`, `G6`, and `G7`.

Gate markers:

```text
.specgate/gates/G3.confirmed     # Confirmed (file content is an ISO timestamp)
.specgate/gates/G3.waived        # Waived (JSON: { at, reason })
```

`invalidateFrom(gate)` deletes that gate and all of its downstream gates. For example, after `proposal.md` is
modified, `G3`-`G11` are all invalidated and must be reviewed again.

## 4.1 Initialization and Git

```text
/sg-init [--path <dir>] [--minimal] [--no-git]
  → Resolve the target directory (current directory or a new directory)
  → A non-empty --path requires --force
  → git init by default (skipped with --no-git)
  → Generate .specgate / .dsh/skills/specgate / openspec / AGENTS.md / agents / templates / docs / examples
  → Workspace clean before init: git add -A + commit "chore(specgate): initialize workflow project"
  → Workspace dirty before init: skip the initial commit and report, avoiding unrelated changes
```

Gate confirmation:

```text
sg_gate tool
  → Prerequisite gate check
  → Git repository check (projects using --no-git skip this and warn)
  → Workspace clean check (reject when dirty; do not write the marker)
  → Structured question (askTimed, timeout fails closed)
  → Write marker

/sg-gate <Gx> confirm --yes
  → Same prerequisite/Git/clean checks
  → Without --yes: return only a pending-confirmation hint; do not ask, do not write the marker
  → With --yes: write the marker directly
```

- `sg_commit` tool/command: `git add -A` (or the specified paths) + `git commit -m`; does not create empty commits.
- Every gate confirmation writes a marker, and the marker is a change; it must be committed before the next gate, so each gate produces at least one commit.
- `sg_status` / `sg_doctor` show the branch, dirty count, and most recent commit.

## 4.2 Idempotency Model

```text
mutating command / tool
  → operationKey = sha256(projectRoot + command + normalizedArgs + target)
  → acquire lock in <tmp>/sg-locks/<key>.lock (wx; stale 10min)
  → state check (check target state)
      → already satisfied: return "idempotent skip"
  → append dedupe only (ttlMs > 0): .specgate/state/idempotency.json
      → success record 24h; --force bypasses
  → execute effect
  → record on success (append only)
  → release lock
```

- Read-only commands do not enter this flow.
- `.specgate/state/` and `.specgate/reports/` are added to `.gitignore` automatically, so they do not pollute the gate clean check.
- Failures do not write success records; the lock is released in `finally`.
- State checks for individual commands are in `src/commands.js` / `src/tools.js`; shared logic is in `src/mutations.js`.

## 4.3 Multi-Agent Parallelism

```text
/sg-apply <change> [--plan]
  → Parse tasks.md: [P] + depends: + role:
  → buildWaves(maxConcurrency=4)
  → For each wave:
      → git worktree add .specgate/worktrees/<change>/<task> for each task
      → Create 9 role Agents concurrently (developer / reviewer by default)
      → Collect results
      → Merge sequentially with --no-ff; on conflict, stop and keep
      → Record .specgate/state/dispatch.json (contentHash + commit)
  → Write .specgate/reports/<timestamp>-dispatch-<change>.md
```

- Non-Git or dirty: degrade to a serial single writer.
- `/sg-doctor`: 4 reviewer Agents check in parallel, then merge checks/issues.
- Agent runner: `ctx.agents.create({ parentAgent, meta.cwd, setup })` + `followup` + `whenIdle`; when the agents service is missing, degrade to local doctor / report an error.

## 5. Write Flow

```text
write/edit call
  → tools.guard
     → Resolve file_path (relative to session cwd)
     → Not under the project root / project not enabled / enforcement=advisory → allow
     → classifyWrite:
          proposal | design | specs | tasks | test | source | null
     → requiredGatesFor(kind, paradigm)
     → missingGates
        → Missing: return rejection text (including the next step)
        → None missing: allow
  → Tool executes
  → tools/post-execute
     → Success and a controlled path: invalidateFrom(downstream gates)
```

**Known boundary**: Writing files directly through the shell (`pwsh` / `bash`) bypasses `write`/`edit` and is not
intercepted by guard. This matches the coverage of the SpecGate Qoder Hook.

## 6. State Inference

- **Artifact**
  - proposal: exists and contains `## Intent` + `## Scope` → completed; exists → drafting.
  - design: exists and contains `## Architecture` + `## Technical Approach` → completed.
  - specs: `specs/**/spec.md` exists and contains `## Requirements` + `Scenario:` → completed.
  - tasks: exists, has `- [x]`, and has no `- [ ]` → completed.
- **Change**
  - tasks completed → implementing
  - design completed → tasking
  - specs completed → designing
  - proposal completed → specing
  - proposal drafting → proposing
- **Project**
  - No active Change and archive has content → completed
  - Any implementing → developing
  - Otherwise has a Change → planning
  - No Change and archive empty → idle

State is inferred in real time on every query, with a 400ms in-process cache; it is actively invalidated after writes.

## 7. Dual-Track Skills

- **Built-in**: `assets/skills/**/SKILL.md`, registered via `ctx.skills.register` when the plugin starts,
  serving as a global fallback.
- **Materialized**: `/sg-init` copies them to `<project>/.dsh/skills/specgate/<name>/SKILL.md`, auditable and editable.
- Project files take precedence over runtime registration; on upgrade, `init` skips existing files by default to avoid overwriting customizations.

## 8. Failures and Degradation

| Situation | Behavior |
|-----------|----------|
| `commands` service loads after the plugin | `ctx.inject` waits for the service and then registers; nothing is silently lost |
| `skills` service loads after the plugin | Same as above; when the service is missing, only runtime skills are skipped |
| `userQuestions` missing | `confirm`/`waive` return a failure and no marker is written (fail closed) |
| `userQuestions` timeout | Return a pending hint; no marker is written |
| `systemPrompt` missing | No hints injected; gates are still enforced by guard |
| Project not initialized | All interceptions are bypassed; `sg_status` suggests `/sg-init` |
| Git unavailable | Initialization fails and suggests `--no-git`; projects using `--no-git` skip the Git check with a warning |
| Workspace dirty | Gate confirmation/waiving is rejected; suggests `/sg-commit` |
| `.specgate/config.yaml` corrupted | Treated as defaults; `doctor` reports it |
| Command finished (agent idle) | Hands the full output back through `agent.followup`, so the agent presents it in the conversation and asks for the next step |
| Runtime has no `followup`, or the hand-off is rejected | Degrades to appending a `notice` context message (fresh sessions only); the report is never lost |
| Agent is running | Appends no message; only the command card is shown, protecting `tool_use`/`tool_result` pairing |

## 9. Testing

- `test/state.test.js`: state inference
- `test/gates.test.js`: gate confirm/waive/invalidate
- `test/git.test.js`: Git initialization, status, commit
- `test/guard.test.js`: write interception, L3 exemption, post-write invalidation
- `test/init.test.js`: initialization, idempotency, AGENTS.md append
- `test/init-v11.test.js`: `--path`, `--minimal`, `--no-git`, non-empty directory, AGENTS.md backup merge
- `test/next-step.test.js`: next-gate order (G1 → G2 → G3)
- `test/gate-actions.test.js`: three gate interaction branches (pass / needs changes / confirm waive)
- `test/gate-git.test.js`: Git clean check before gates and `--no-git` degradation
- `test/lifecycle.test.js`: a new Change clears G3-G11; archiving clears all gates
- `test/plugin.test.js`: simulates the Cordis context and verifies tool/command/skill/prompt/guard registration, the commit tool, and serializable output
- `test/commands-report.test.js`: command result hand-off to the agent, `notice` degradation, command-level idempotency (init/deviation)
- `test/idempotency.test.js`: operation keys, 24h dedupe, force, concurrency lock, read-only commands write nothing
- `test/task-graph.test.js`: `[P]`/`depends`/`role` parsing, serial default, waves, dependency cycles
- `test/dispatch.test.js`: worktree parallelism/conflicts/non-Git degradation, task checking, parallel doctor aggregation

Run: `node --test` (currently **90 passed / 0 failed**).
