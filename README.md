# SpecGate for DSH

> **v3 MVP (current)**: SpecGate v3 replaces gate-by-gate confirmation with an autonomous loop — AI executes, machine evidence decides, humans approve only **H1 (requirements)**, **H2 (plan)** and **H3 (acceptance)**.
>
> - Commands: `/sg-init`, `/sg-change`, `/sg-run`, `/sg-approve`, `/sg-skill`, `/sg-status`, `/sg-abort`
> - Evidence: orchestrator runs the frozen `test:json` command; tasks only become `[x]` after merge
> - Scope: one active change, feature/modify/fix/remove, parallel `[P]` tasks, archive with tag
> - Docs: [`docs/demos/v3-mvp.md`](docs/demos/v3-mvp.md)
>
> The v2.1 documentation below is kept for history; the v2 gate runtime and its tests have been removed.

A Host plugin that brings AgentKit47's gated development workflow to DeepSeek Harness (DSH).

- Source: `templates/qoder/` from `AgentKit47-Qoder` (MIT)
- Target: DSH `0.2.1-rc.2` and above
- Form: workspace bundle, installed into the current DSH profile; **activated per project on opt-in**
- Version: `3.0.0`

## Capabilities

- **Built-in plugin initialization**: `/sg-init` generates `.specgate/`, `openspec/`, `AGENTS.md`, 30 Skills, 11 Agents, templates, docs, and examples in the current directory; by default it runs `git init` and creates an initial commit.
- **Create a new project directory**: `/sg-init --path <dir>` creates the directory and initializes it.
- **Minimal mode**: `--minimal` generates only the skeleton, 30 Skills, `openspec/`, and a condensed AGENTS.md.
- **Full AGENTS.md**: an existing file is backed up first, then the SpecGate sections are merged/replaced without overwriting user content.
- **Git commit discipline**: the working tree must be clean before a gate confirmation; `/sg-commit` commits the current changes.
- G1-G11 gates: hard write blocking + soft phase-advance reminders (hybrid mode).
- L1/L2/L3 change classification: L1 requirements-driven, L2 technical implementation, L3 defect fix.
- Requirements version chain + OpenSpec design/specs/tasks state, project state and next step.
- Deviation log: `.specgate/deviations.log`; skipping a gate must be recorded there.
- **DSH output adaptation**: command results render as persistent command cards; an empty session additionally gets a `notice` context message so the result is not hidden behind the welcome page; tool results render as tool cards. **Synthetic assistant messages are no longer injected into the session**, so the `tool_use` / `tool_result` pairing is never broken.
- **Idempotent mutating commands**: state checks come first; append-type operations are deduplicated for 24h; a concurrency lock prevents duplicate execution; read-only commands write nothing and take no lock.
- **Multi-Agent parallelism**: `/sg-apply` splits `tasks.md` into waves by `[P]` / `depends`, with 11 role Agents, default concurrency 4, an independent dev worktree per task, and independent format/test/review worktrees; `/sg-doctor` runs a four-dimension parallel health check.
- **Requirements version chain**: one current `requirements/REQUIREMENTS.md`; approved changes create immutable `history/vX.Y.Z/` snapshots and change-scoped deltas.
- Commands: `/sg-init`, `/sg-status`, `/sg-next`, `/sg-gate`, `/sg-commit`, `/sg-deviation`, `/sg-classify`, `/sg-doctor`, `/sg-enable`, `/sg-disable`, `/sg-migrate`, `/sg-change`, `/sg-test`, `/sg-requirements-migrate`, `/sg-propose`, `/sg-apply`, `/sg-archive`, `/sg-explore`
- Tools: `sg_status`, `sg_next`, `sg_gate`, `sg_commit`, `sg_deviation`, `sg_classify`, `sg_doctor`, `sg_init`, `sg_enable`, `sg_disable`, `sg_migrate`, `sg_change`, `sg_apply`, `sg_test`, `sg_requirements_migrate`, `sg_propose`, `sg_archive`

## Requirements and test workflow (2.x)

New projects use one canonical requirements document plus a version chain:

```text
requirements/
├── REQUIREMENTS.md                 # current approved requirements
├── history/vX.Y.Z/REQUIREMENTS.md  # immutable snapshots
└── changes/<change>/
    ├── change.md / change.json     # intent, scope and machine-readable delta
    ├── design.md / tasks.md
    ├── tests/cases.md / matrix.md
    ├── approval.md
    ├── format-report.md
    ├── test-report.md
    └── review-report.md
```

- `/sg-change <id>` creates a change package; G3 approves the delta and writes the next version.
- `/sg-apply <change>` advances exactly one stage: dev roles → formatter/lint → tester → reviewer, then stops at the gate.
- Dev roles are inferred from task text/files when `role:` is absent; explicit `role:` wins; low confidence stops before dispatch.
- `/sg-test <change> plan` writes/freezes tests; `/sg-test <change> run` executes them in an independent test worktree.
- G7.5 format/lint runs on changed files only; no command means stop, never skip.
- G8 requires a passing test report and P0/P1 100%, P2 ≥90%, line ≥80%, branch ≥70%.
- G9 requires a read-only independent review with no blocking findings.
- Dev/format/test/review use independent worktrees; the main agent is the only merger.
- Legacy projects keep the old flow until `/sg-requirements-migrate` is run explicitly.

## Installation

SpecGate is distributed as a public Git repository; a publish to the npm registry is optional. The repository is a complete plugin with no build step.

### Method A: GitHub dependency in the DSH profile (recommended, tested)

Add the bundle and the GitHub dependency to the active profile's `package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-specgate"
      ]
    }
  },
  "dependencies": {
    "dsh-plugin-specgate": "github:GM-Studio/dsh_sg_plugin#v2.1.0"
  }
}
```

Then install and restart DSH:

```powershell
cd C:\Users\<user>\.dsh\profiles\desktop
pnpm install
```

Use `#main` for the latest commit, or `#<commit-sha>` for a pinned build. Profiles that use npm can run `npm install` instead.

### Method B: `plugin_manager` install from GitHub (tested against the DSH plugin-manager source)

Call the DSH `plugin_manager` tool with:

```json
{
  "action": "install_bundle",
  "target": "github:GM-Studio/dsh_sg_plugin#v2.1.0"
}
```

The equivalent shorthand is:

```text
plugin_manager install_bundle target=github:GM-Studio/dsh_sg_plugin#v2.1.0
```

The manager accepts `github:`, `git+https://...`, a Git repository URL, a `.tgz` URL, or an **absolute** local directory. It runs `pnpm add`, selects the bundle, and reloads the profile. DSH may ask for `danger-full-access` approval because the change persists across sessions and installs Host code.

If the manager reports `already-installed`, remove the bundle first or use Method A.

### Method C: local checkout

```text
plugin_manager action=install_bundle target=D:\plugins\specgate
```

The local path must be absolute. Alternatively, use a `link:` dependency in the profile:

```json
"dependencies": {
  "dsh-plugin-specgate": "link:D:/plugins/specgate"
}
```

### Method D: npm registry (only if published)

```text
plugin_manager action=install_bundle target=dsh-plugin-specgate
```

### Verify the installation

After a restart, open a new DSH session and run:

```text
/sg-status
```

If the command is missing:

1. Confirm `dsh-plugin-specgate` is in the profile's `dsh.profile.bundles`.
2. Confirm the dependency resolves (`pnpm install` in the profile directory).
3. Restart DSH.
4. Check `~/.dsh/logs` for load errors.
5. Confirm DSH `>= 0.2.1-rc.2` and Node `>= 20.19.0`.

### Project-level start / stop

The plugin is a Host plugin; it has no background daemon. "Start" and "stop" operate at two levels:

- **Global**: enable/disable/uninstall the `dsh-plugin-specgate` bundle in the DSH plugin manager.
- **Project**: `/sg-enable` and `/sg-disable` in the current project. These only toggle gating and prompts; `.specgate/` and `openspec/` files are preserved.

After installation the plugin line `include:specgate` appears in the profile. The plugin does **not** intercept every project: it activates only after a project-root `.specgate/` is detected or `/sg-enable` is run.

## Migration from `.ak47/`

```text
/sg-migrate --dry-run     # show the plan; no files are changed
/sg-migrate               # back up .ak47/, migrate to .specgate/, rewrite managed assets
/sg-migrate --force       # re-migrate when .specgate/ already exists (backs up the target)
```

- The old directory is renamed to `.ak47.backup-<timestamp>`; it is never deleted.
- Gates, deviations, config, state, agents, skills, rules and docs are migrated.
- `AGENTS.md`, `.dsh/skills/**`, `openspec/**` and related managed files have their old command/path references rewritten.
- Existing `ak47/*` worktrees and branches are **not moved**; the migration report lists them.
- A report is written to `.specgate/reports/migrate-<timestamp>.md`.

## Configuration

Global defaults live in the DSH profile's plugin config:

```yaml
- id: specgate
  name: 'dsh-plugin-specgate'
  config:
    defaultEnabled: true
    enforcement: hybrid
    maxConcurrency: 4
    git: true
    language: zh
    materializeSkills: true
    materializeAgents: true
```

Project config lives in `.specgate/config.yaml` and overrides global defaults for that project:

```yaml
version: 1
workflowVersion: 2
enabled: true
enforcement: hybrid
paradigm: null
language: zh
git: true
minimal: false
maxConcurrency: 4
materializeSkills: true
materializeAgents: true
minLineCoverage: 80
minBranchCoverage: 70
formatCommand: ""
lintCommand: ""
```

Precedence: **project config > global plugin config > built-in defaults**. Global defaults seed new projects; they never rewrite an existing project config.

- `language`: `zh` or `en` (default `zh`). It selects the runtime Skill/Agent/docs content and the language of command results/reports.
- `maxConcurrency`: default 4, used by `/sg-apply` and `/sg-doctor`.
- `formatCommand` / `lintCommand`: must contain `{files}` so G7.5 only touches changed files; empty values fall back to `package.json` scripts.
- `materializeSkills` / `materializeAgents`: when false, the project uses runtime registrations only.
- `defaultEnabled`: the initial `enabled` value written by `/sg-init`; default `true`.

## Language

SpecGate ships bilingual assets: English `*.md` files and Chinese `*.zh.md` siblings. Chinese is the authoritative source; English is a complete translation. The runtime selects variants by `language` (`zh` or `en`). Changing an existing project's language requires `/sg-init --force` to re-materialize its Skill/Agent/docs assets.

```text
/sg-init --force
```


## Quick start

```text
/sg-init                       # initialize the current directory; git init + initial commit by default
/sg-init --path my-app         # create a new directory and initialize it
/sg-init --minimal             # minimal skeleton
/sg-init --no-git              # do not create a Git repository
/sg-status                     # project / Change / gate / Git status
/sg-commit "chore: initialize" # commit the current changes
/sg-gate G1                    # inspect G1
/sg-gate G1 confirm --yes      # explicitly confirm G1 (command channel)
/sg-classify new feature ...   # recommend L1/L2/L3 (requires G1 confirmed)
/sg-propose add-login          # legacy: create an OpenSpec change skeleton (requires G1/G2)
/sg-apply add-login --plan     # infer roles and show the next stage
/sg-apply add-login            # advance one stage: dev/format/test/review, then stop at the gate
/sg-migrate --dry-run          # preview migration from an existing .ak47/ project
```

Parallel notation in `tasks.md`:

```markdown
- [ ] T1 Implement the login API [P]
- [ ] T2 Implement the login page [P]
- [ ] T3 Integrate the login flow depends: T1,T2 role: reviewer
```

Without `[P]` / `depends` tasks default to serial; `/sg-apply` executes the implementation by default, while `--plan` only inspects the plan.

The `sg_init` tool also accepts the same parameters: `path`, `minimal`, `force`, `git`, `example`, `docs`, `disabled`.

## Gates, Git, and writes

| Write target | Prerequisite gates |
|--------------|--------------------|
| `requirements/REQUIREMENTS.md` via `change.json` | G1 requirements, G2 classification, G3 requirement delta |
| `design.md` | G3 change delta approved |
| `specs/**` (optional downstream) | G4 design approved |
| `tests/cases.md`, `tests/matrix.md` | G4 design approved; reviewed and frozen at G5 |
| `tasks.md` | G5 test plan frozen |
| Source code | G1-G7 (under L3, G1/G3/G4/G5 may be skipped) |
| `format-report.md` | G7.5: formatter and lint pass on changed files |
| `test-report.md` | G8: P0/P1/P2 and coverage pass |
| `review-report.md` | G9: independent review pass, no blocking |
| Commit | G9 after review |

Gate confirmation has two DSH-native paths:

- the `sg_gate` tool (model-invoked) uses a structured question and offers "Approve / Needs changes";
- the `/sg-gate <Gx> confirm --yes` command uses explicit command-line confirmation. Without `--yes` it only returns "pending confirmation" plus an operational hint and **does not** open a possibly invisible question in the command channel.

Skipping a gate requires both a reason and `--yes`, for example `/sg-gate G4 waive --yes user explicitly requested to skip`.

## Output display (DSH adaptation)

| Entry point | Display | History |
|-------------|---------|---------|
| `sg_*` tools | Tool result card (success/error text) | Persisted in the session log |
| `/sg-*` commands | DSH persistent command card, expandable to the full text | `command/run` + `command/done` |
| First command in a new session | Additionally writes a `notice` context message, ensuring the session leaves the welcome page and shows the result | `user/message` (source.kind=`specgate`) |

Design constraints:

- Append the `notice` only when the agent is idle and the session has no messages yet; an active session only shows the command card and does not write history again.
- Never append a message between a tool call and its tool result. Earlier versions injected a synthetic `assistant/message`, which left `tool_use` without an adjacent `tool_result` and made subsequent requests fail with 400 outright.
- Command exceptions also produce output: they return `kind: 'error'`, and an empty session also gets an error `notice`.

## Idempotency protection

| Type | Commands | Behavior |
|------|----------|----------|
| State mutation | init / enable / disable / gate confirm / gate waive / classify --apply / sg-propose / sg-archive | Checks the target state first; if already reached, returns "idempotent skip" and does not rewrite files |
| Append | deviation | `.specgate/state/idempotency.json` records for 24h; the same command + arguments is not appended again; `--force` allows an explicit repeat |
| Git commit | commit | Returns "no changes to commit" when there are none; concurrent commits take a lock |
| Read-only | status / next / doctor / classify (without --apply) / gate status / sg-apply (without name) / sg-explore | No state files, no lock |

- Locks live in the system temporary directory to avoid polluting the project workspace; state files live in `.specgate/state/`, which is automatically added to `.gitignore`.
- Failures do not record a success state; after fixing the problem you can retry directly.
- When identical operations run concurrently only one executes; the rest return "the same operation is already running".

## Multi-Agent parallelism

- `/sg-apply <change>`: advances one stage — dev tasks → formatter/lint → tester → reviewer — and stops at the corresponding gate.
- The 11 roles come from `.specgate/agents/`; a task can specify `role: reviewer|architect|ddd|...`; otherwise the role is inferred or defaults to `developer`.
- Each wave is merged sequentially after it completes; on conflict, merging stops and all worktrees/branches are kept, and the conflicting files are returned.
- Successful tasks are automatically checked off in `tasks.md` and committed as `chore(specgate): mark <change> tasks done`; failed tasks remain unchecked.
- Non-Git projects or a dirty working tree: automatically degrade to a serial single writer, with the reason stated in the result.
- `/sg-doctor`: the reviewer Agent checks four dimensions in parallel — structure/Git, gates/artifacts, deviations/idempotency, Skills/Agents — and then summarizes.
- Results are emitted to the command card, the `notice` (empty session), and `.specgate/reports/<timestamp>-dispatch-<change>.md`.

**Commit discipline (gate-level mandatory clean)**:

1. Check `git status` before `sg_gate confirm` / `waive`; refuse if the working tree has uncommitted changes.
2. Confirming a gate writes `.specgate/gates/<Gx>.confirmed`; that marker is itself a change, so it must be committed before the next gate.
3. Commit with `/sg-commit <message>` or the `sg_commit` tool; messages follow Conventional Commits.
4. Skipping a gate additionally requires: the user explicitly choosing "skip", a provided reason, and writes to `.specgate/deviations.log` and `.specgate/gates/<Gx>.waived`.

## File layout

```text
.specgate/
├── config.yaml
├── gates/G1.confirmed
├── deviations.log
├── state/                  # idempotency.json / dispatch.json / .gitignore
├── worktrees/              # Git worktrees for parallel tasks
├── reports/                # parallel dispatch reports
├── agents/
├── templates/
├── rules/                  # CLI / core / tests / types / docs module rules
├── briefs/
├── out-of-scope/
├── experiences/            # index + trigger-guide + four knowledge categories
└── backups/                # AGENTS.md backups taken before merging
.dsh/skills/specgate/<skill>/SKILL.md
openspec/changes/<change>/{proposal.md,design.md,tasks.md,specs/**}
docs/prd/vision.md
docs/architecture/01-system-overview.md
docs/specgate/examples/example-change/
CONTEXT.md
.git/
```

## Verification

- Installed successfully in the current DSH profile (`application: applied`).
- All 30 Skills appear in the session skill catalog; all 13 `sg_*` tools are callable.
- Real blocking: writing `design.md` while G1/G2/G3 are unconfirmed is rejected; once the markers are written it is allowed.
- Real initialization: an empty project yields 30 Skills / 11 Agents / OpenSpec / full AGENTS.md / docs / examples / initial Git commit.
- Gate clean: after G1 confirmation the marker makes the working tree dirty, so G2 confirmation is rejected; after committing it passes.
- Output regression: a command in a new session writes a `notice`; an active session does not duplicate history; a running agent writes no messages; failed commands also produce output; automated tests cover "never inject synthetic assistant messages".
- Idempotency regression: state commands do not replay the cache, append commands deduplicate for 24h, force allows repeats, concurrency locks are mutually exclusive, read-only commands write nothing to disk.
- Parallel regression: worktree parallelism/waves/dependencies, duplicate dispatch skipping, merge conflicts preserving branches, non-Git degradation, doctor parallel summary.
- Automated tests: `node --test` → **113 passed / 0 failed**.

See [verification.md](docs/design/verification.md) for the full record.

## Known limitations

- Write interception covers the `write` / `edit` tools; writing files directly through shell commands is not intercepted.
- Initialization requires Git to be available by default; in environments without Git use `--no-git`, but commit discipline then does not apply.
- The gate clean check leaves uncommitted changes after a marker is written, and this is deliberate: every gate produces at least one commit.
- `commands` / `skills` / `systemPrompt` are optional services: the plugin waits for them via `ctx.inject`; when a composed environment lacks one of them, only the corresponding capability is skipped — tools and gates still work.
- Parallel worktrees require a clean working tree; dirty or non-Git projects automatically degrade to serial and do not isolate uncommitted changes.
- Merge conflicts are not resolved automatically; the worktree and branch are kept, and you must merge manually and re-run `/sg-apply`.
- 11 Agents running in parallel consume more model calls and tokens; default concurrency is 4 and can be adjusted via `maxConcurrency` in `.specgate/config.yaml`.
- Idempotent `--force` is available only for append-type commands (deviation); state-type commands are naturally re-run by deleting the target file/marker.
- Does not replace the AgentKit47 CLI's `init/upgrade/doctor/validate`; SpecGate is a DSH Host plugin, not a standalone CLI.
- G6.5 Brief is an optional gate and is not in the "pending confirmation" list by default.
- The plugin provides no MCP server or MCP tools; MCP capabilities on the DSH side are independent of this plugin.
- **Upgrade note**: the predecessor plugin's early 0.2.0 `ak47_selftest_append` polluted the session log; continue in a new session and do not reuse old sessions that already show `tool_use` / `tool_result` 400 errors.

## Development

```bash
node --test
```

## License

MIT, derived from the templates and workflow design of AgentKit47-Qoder.
