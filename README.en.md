# SpecGate for DSH

[中文](README.md) | **English**

![version](https://img.shields.io/badge/version-3.6.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)
![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2-purple)

> **v3.6 (current)**: Java backend support — JDK 8/11/17/21 (LTS), Spring Boot 2.7.x/3.x, Maven/Gradle, JUnit XML adapters, Spotless/Checkstyle/SpotBugs gates, plus the existing Node/Vue/React/Python stacks.
>
> - Java details: [`docs/requirements/2026-10-19-v3.6-java-stack-requirements.md`](docs/requirements/2026-10-19-v3.6-java-stack-requirements.md)
> - Design/matrix: [`docs/design/java-support-review.md`](docs/design/java-support-review.md), [`docs/design/java-version-matrix.md`](docs/design/java-version-matrix.md)
> - v3.5 environment preflight: [`docs/requirements/2026-10-19-v3.5-env-preflight-quality-requirements.md`](docs/requirements/2026-10-19-v3.5-env-preflight-quality-requirements.md)
> - v3.4 review/observability: [`docs/requirements/2026-10-19-v3.4-review-observability-requirements.md`](docs/requirements/2026-10-19-v3.4-review-observability-requirements.md)
>
> **v3.0 MVP**: AI executes, machine evidence decides, humans approve the gates they need to approve.
>
> - Commands: `/sg-init`, `/sg-change`, `/sg-status`, `/sg-context`, `/sg-skill`
> - Tools: `sg_init`, `sg_change`, `sg_status`, `sg_skill`, `sg_run`, `sg_approve`
> - Evidence: the orchestrator runs frozen suites; tasks only become `[x]` after merge
> - Docs: [`docs/demos/v3-mvp.md`](docs/demos/v3-mvp.md)

A Host plugin that brings AgentKit47's gated development workflow to DeepSeek Harness (DSH).

| Property | Value |
|----------|-------|
| Source | `templates/qoder/` from `AgentKit47-Qoder` (MIT) |
| Target | DSH `0.2.1-rc.2` and above |
| Form | workspace bundle, installed into the current DSH profile |
| Version | `3.6.0` |

---

## Contents

- [Overview](#overview)
- [Capabilities](#capabilities)
- [Skills](#skills)
- [Workflow and phases](#workflow-and-phases)
- [Commands](#commands)
- [Tools](#tools)
- [Java backend (v3.6)](#java-backend-v36)
- [Installation](#installation)
  - [Method A: GitHub dependency (recommended)](#method-a-github-dependency-recommended)
  - [Method B: plugin_manager from GitHub](#method-b-plugin_manager-from-github)
  - [Method C: local directory](#method-c-local-directory)
  - [Method D: npm registry (only if published)](#method-d-npm-registry-only-if-published)
  - [Method E: offline tgz package](#method-e-offline-tgz-package)
  - [Release artifacts (v3.6.0)](#release-artifacts-v360)
  - [Verify the installation](#verify-the-installation)
  - [Project-level start and stop](#project-level-start-and-stop)
- [Configuration](#configuration)
- [Language](#language)
- [Quick start](#quick-start)
- [Writes and guards](#writes-and-guards)
- [Output display](#output-display)
- [File layout](#file-layout)
- [Verification](#verification)
- [Known limitations](#known-limitations)
- [Code review and formatting gate](#code-review-and-formatting-gate)
- [Development](#development)
- [License](#license)

---

## Overview

SpecGate is a **spec-driven, human-gated** development workflow. It splits "the AI writes code" into an auditable pipeline:

```text
specs (proposal / specs)
   ↓  M1 machine check + H1 human approval
plan (design / tasks / tests)
   ↓  M2 machine check + H2 human approval
execution (worktree parallel / serial fallback)
   ↓  tasks check off only after merge
integration (frozen suite regression)
   ↓  H3 human acceptance
archive (spec delta applied to openspec/specs/)
```

Three hard constraints shape the design:

1. **Explicit entry points only** — five commands and six tools, nothing implicit.
2. **Machines check first, humans approve second** — when `M1`/`M2` fail, `sg_run` refuses to advance and the human gate never appears.
3. **Approval freezes the artifact** — approving hashes the artifact, so any later edit invalidates the approval.

## Capabilities

- **Explicit-only entry points.** Everything the plugin exposes is invoked deliberately: five `/sg-*` commands and six `sg_*` tools. No command auto-runs, and no skill is registered into the session catalog.
- **One automatic surface — the write guard.** `src/v3/guards.js` intercepts the `write` / `edit` tools and rejects writes to orchestrator-owned paths. This is the only thing that acts without being asked (see [Writes and guards](#writes-and-guards)).
- **Project initialization**: `/sg-init` creates `.specgate/`, `openspec/`, and a `.gitignore` block in the current directory. Idempotent — re-running it reports what already exists instead of rewriting it.
- **Change packages**: `/sg-change <name>` scaffolds `openspec/changes/<name>/` and moves the project to `H1_PENDING`.
- **Machine-checked quality gates**: `M1` validates the proposal and spec delta; `M2` validates the design, task graph, acceptance-criteria-to-case mapping, and suite discovery. `sg_run` refuses to advance when either fails.
- **Human gates**: `H0` (context), `H1` (requirements), `H2` (plan), `H3` (acceptance). Approval hashes freeze the approved artifact, so any later edit is detected and re-approval is required.
- **Frozen test evidence**: suites are discovered from `.specgate/config.yaml`, hashed into the plan, and re-run by the orchestrator. A task is only checked off after its work is merged.
- **Parallel execution**: tasks marked `[P]`/`depends` run in isolated Git worktrees with a per-repo agent pool, a merge lock, and a circuit breaker; non-Git or dirty trees degrade to a serial single writer.
- **Bilingual assets**: English `*.md` and Chinese `*.zh.md` siblings, selected by the `language` config key.
- **DSH output adaptation**: command results render as persistent command cards; tool results render as tool cards.

## Skills

Skill bodies ship under `assets/` and are **not** registered in the DSH session catalog. `src/v3/skills.js` maps roles, phases, and conditions to skill ids, then injects the matching bodies into **subagent prompts** during dispatch. To read one yourself, use the `sg-skill` tool or `/sg-skill <name>`.

22 skills ship today:

| Category | Skills |
|----------|--------|
| `sg-core/` | `sg-skill-anti-patterns` |
| `engineering/` | `sg-skill-architecture-design`, `sg-skill-code-review`, `sg-skill-critical-review`, `sg-skill-domain-modeling`, `sg-skill-requirements-definition`, `sg-skill-systematic-debugging`, `sg-skill-test-driven-development`, `sg-skill-triage-brief`, `sg-skill-vertical-slicing`, `sg-skill-writing-skills` |
| `productivity/` | `sg-skill-executing-plans`, `sg-skill-finishing-a-development-branch`, `sg-skill-using-git-worktrees`, `sg-skill-writing-plans` |
| `misc/` | `sg-skill-prototype`, `sg-skill-zoom-out` |
| `sp/` (ported from superpowers) | `sp-skill-brainstorming`, `sp-skill-dispatching-parallel-agents`, `sp-skill-requesting-and-receiving-code-review`, `sp-skill-subagent-driven-development`, `sp-skill-verification-before-completion` |

**Role mapping** (`ROLE_SKILLS` in `src/v3/skills.js`):

| Role | Injected skills |
|------|-----------------|
| `planner` | `sg-skill-requirements-definition`, `sg-skill-vertical-slicing` |
| `implementer` | `sg-skill-test-driven-development`, `sp-skill-subagent-driven-development` |
| `tester` | `sg-skill-test-driven-development` |
| `reviewer` | `sg-skill-code-review`, `sp-skill-requesting-and-receiving-code-review` |
| `integrating` | `sp-skill-verification-before-completion` |
| `archive` | `sg-skill-finishing-a-development-branch` |

**Conditional selection**: parallel dispatch adds `sp-skill-dispatching-parallel-agents`; a retry adds `sg-skill-systematic-debugging`; multi-capability changes add `sp-skill-brainstorming`; more than five acceptance criteria adds `sg-skill-triage-brief`.

## Workflow and phases

Phases advance only through explicit `sg_run` calls:

```text
IDLE
 └─ /sg-init (empty project) ──► H0_PENDING ──(H0)──► H1_PENDING
 └─ /sg-change ─────────────────────────────────────► H1_PENDING
                                                         │
        H1_PENDING ──(M1 + H1)──► PLAN ──(M2 + H2)──► EXECUTING
                                                        │
              DONE ◄── ARCHIVING ◄──(H3)── H3_PENDING ◄── INTEGRATING
```

| Phase | What happens | Exit |
|-------|--------------|------|
| `IDLE` | No change in flight | `/sg-change` |
| `H0_PENDING` | New-project context collected (`state.change` is still `null`) | `sg_approve gate="H0"`, then `sg_run` scaffolds |
| `H1_PENDING` | Author `proposal.md` and `specs/**/spec.md` | `sg_run` runs `M1`, then `H1` |
| `PLAN` | Author `design.md`, `tasks.md`, `tests/cases.md`, `tests/mapping.json` | `sg_run` runs `M2`, then `H2` |
| `EXECUTING` | Tasks run in worktrees; completed ones merge and check off | `sg_run` until all merge |
| `INTEGRATING` | Frozen suites re-run; `acceptance.md` generated | `sg_run`, then `H3` |
| `H3_PENDING` | Acceptance awaits a human | `H3` approval |
| `ARCHIVING` | Spec delta applied to `openspec/specs/` | `sg_run` |
| `DONE` / `BLOCKED` / `ABORTED` | Terminal or paused | `sg_run --retry` to resume a block |

Full phase set (`src/v3/state.js`): `IDLE`, `H0_PENDING`, `H1_PENDING`, `PLAN`, `H2_PENDING`, `EXECUTING`, `INTEGRATING`, `H3_PENDING`, `ARCHIVING`, `DONE`, `BLOCKED`, `ABORTED`.

`M1` and `M2` are quality gates, not human ones — they are enforced by `sg_run` itself and reported as errors when they fail.

## Commands

| Command | Arguments | Purpose |
|---------|-----------|---------|
| `/sg-init` | none | Initialize `.specgate/` and `openspec/`. For an empty project it first collects context and stops at `H0_PENDING` |
| `/sg-change` | `<name> [--type feature\|modify\|fix\|remove] [--link <changeKey>]` | Create a change package; enters `H1_PENDING` |
| `/sg-status` | `[--path <repo>] [--json] [--verbose]` | Show phase, change, gate, and plan status |
| `/sg-context` | `--reset` | Return to `H0_PENDING` and re-collect context (`H0_PENDING`/`H1_PENDING` only) |
| `/sg-skill` | `<name>` | Print a skill body |

`/sg-init` takes no flags in this version — it initializes the current working directory.

## Tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `sg_init` | none | Same as `/sg-init` |
| `sg_change` | `name` (required), `type`, `link` | Same as `/sg-change` |
| `sg_status` | `path`, `json`, `verbose` | Same as `/sg-status` |
| `sg_skill` | `name` | Same as `/sg-skill` |
| `sg_run` | `retry`, `force` | Advance exactly one phase. Takes no command/branch overrides |
| `sg_approve` | `gate` (`H0`\|`H1`\|`H2`\|`H3`) | Ask the human to approve a gate; the model cannot self-approve. `H0` runs before the first change exists |

`sg_run` is the engine: it validates `M1`/`M2`, executes or retries tasks, runs integration suites, and writes the acceptance report — but only ever one phase per call.

> `/sg-run` and `/sg-approve` are **not** slash commands; only the `sg_run` / `sg_approve` tools exist. The `/sg-approve H1` strings in tool output are human-facing hints.

## Java backend (v3.6)

- **JDK**: 8 / 11 / 17 / 21 (LTS only); JDK 13 is rejected.
- **Spring Boot**: 2.7.x and 3.x; strict matrix:

  | Spring Boot | Allowed JDK |
  |-------------|-------------|
  | 2.7.x | 8 / 11 / 17 |
  | 3.x | 17 / 21 |

- **Default New Project**: JDK 8 + Maven + Boot 2.7.18.
- **Selectable**: Gradle 8.x + Boot 3.x, JDK 17/21.
- **Scaffold**: Web + Validation + Actuator, `/health`, JUnit 5 + MockMvc, Spotless (google-java-format), Checkstyle, SpotBugs, JaCoCo.
- **Runners**: Maven (`mvnw verify`) and Gradle (`gradlew check`); Surefire/Failsafe/Gradle JUnit XML → SpecGate reports.
- **Quality stages**: Spotless/Checkstyle/compile/SpotBugs; failures block.
- **JDK lookup**: JAVA_HOME / PATH / SDKMAN / `.java-version` / `.sdkmanrc`; missing JDK is reported, never auto-installed.

Example `.specgate/config.yaml`:

```yaml
stack: java
java:
  jdk: 8
  buildTool: maven
  bootVersion: "2.7.x"
quality:
  profile: strict
suites:
  - id: backend
    kind: maven
    cwd: "."
    jdk: "8"
    goals: ["-B", "-ntp", "verify"]
```

Gradle projects use `kind: gradle`, `goals: ["check"]`, and `reportGlob: "build/test-results/test/TEST-*.xml"`.

Initialization asks for `buildTool`, `jdk`, `bootVersion`, and modules; invalid combinations are rejected before scaffolding (`JAVA_MATRIX_INVALID`).

Real sample verification: JDK 8 + Maven + Boot 2.7 (`mvn -B -ntp verify`) and JDK 17 + Gradle + Boot 3 (`gradle spotlessApply check`) both build successfully; see the v3.6 requirements document.

## Installation

SpecGate is distributed as a public Git repository; a publish to the npm registry is optional. The repository is a complete plugin with no build step.

### Method A: GitHub dependency (recommended)

Add the bundle and the GitHub dependency to the active profile's `package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-specgate"]
    }
  },
  "dependencies": {
    "dsh-plugin-specgate": "github:GM-Studio/dsh_sg_plugin#v3.6.0"
  }
}
```

Then install and restart DSH:

```powershell
cd C:\Users\<user>\.dsh\profiles\desktop
pnpm install
```

Use `#main` for the latest commit, or `#<commit-sha>` for a pinned build. Profiles that use npm can run `npm install` instead.

### Method B: plugin_manager from GitHub

Call the DSH `plugin_manager` tool with:

```json
{
  "action": "install_bundle",
  "target": "github:GM-Studio/dsh_sg_plugin#v3.6.0"
}
```

The equivalent shorthand is:

```text
plugin_manager install_bundle target=github:GM-Studio/dsh_sg_plugin#v3.6.0
```

The manager accepts `github:`, `git+https://...`, a Git repository URL, a `.tgz` URL, or an **absolute** local directory. It runs `pnpm add`, selects the bundle, and reloads the profile. DSH may ask for `danger-full-access` approval because the change persists across sessions and installs Host code.

If the manager reports `already-installed`, remove the bundle first or use Method A.

### Method C: local directory

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
plugin_manager action=install_bundle target=dsh-plugin-specgate@3.6.0
```

### Method E: offline tgz package

For air-gapped or cross-OS installs, build once on a connected machine:

```bash
npm pack
# dsh-plugin-specgate-3.6.0.tgz
sha256sum dsh-plugin-specgate-3.6.0.tgz
```

Copy the `.tgz` to the target machine, then install by **absolute path**:

```json
{
  "action": "install_bundle",
  "target": "/opt/packages/dsh-plugin-specgate-3.6.0.tgz"
}
```

Windows:

```json
{
  "action": "install_bundle",
  "target": "D:\\packages\\dsh-plugin-specgate-3.6.0.tgz"
}
```

Or add it directly to the profile:

```json
"dependencies": {
  "dsh-plugin-specgate": "file:/opt/packages/dsh-plugin-specgate-3.6.0.tgz"
}
```

Then run `pnpm install` (or `npm install`) in the profile and restart DSH. The offline package contains all skills and templates; it does not bundle JDK/Maven/Gradle/Python, which must exist on the target machine.

### Release artifacts (v3.6.0)

- GitHub Release: `https://github.com/GM-Studio/dsh_sg_plugin/releases/tag/v3.6.0`
- Assets:
  - `dsh-plugin-specgate-3.6.0.tgz` — offline package (243 files, ~532 kB)
  - `dsh-plugin-specgate-3.6.0.tgz.sha256` — SHA256 checksum
- Suggested install paths:
  - GitHub tag: Method A / B (`github:GM-Studio/dsh_sg_plugin#v3.6.0`)
  - Offline package: Method E (absolute `.tgz` path)
  - Local checkout: Method C (absolute directory)

The offline package contains `index.js`, `src/`, `assets/`, `cordis.patch.yml`, `locale/`, and docs. It does **not** bundle JDK, Maven, Gradle, Python, or Node; install those on the target machine when needed.

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

### Project-level start and stop

The plugin is a Host plugin; it has no background daemon and no enable/disable toggle. It activates per project the moment the project root contains `.specgate/state.json` — which `/sg-init` creates. To stop using it in a project, remove `.specgate/` (and optionally `openspec/`); nothing else in the repository depends on it.

## Configuration

Project config lives in `.specgate/config.yaml`, written by `/sg-init`:

```yaml
# SpecGate v3 project config
workflowVersion: 3
schemaVersion: 3
language: zh
# Test command (argv array). Falls back to package.json scripts["test:json"] when empty.
testing:
  command: []
  cwd: "."
# Parallel task limit per wave (1-4)
maxParallel: 2
coverage:
  blocking: false
```

Java projects extend it with `stack: java`, a `java:` block, `quality:`, `coverage:` thresholds, and a `suites:` list (see [Java backend](#java-backend-v36)).

| Key | Description |
|-----|-------------|
| `language` | `zh` or `en`. Selects the `.zh.md` / `.md` asset variant and the language of command output |
| `testing.command` | The argv array for the project's test suite. When empty, discovery falls back to `package.json`'s `scripts["test:json"]` |
| `maxParallel` | How many tasks in one wave may run at once (1–4) |
| `coverage.blocking` | Whether coverage shortfalls fail the integration phase |
| `suites` | The named test suites `sg_run` executes and hashes into the plan |
| `enabled` | Whether a pooled skill / role participates in dispatch |

A project whose `workflowVersion` is below 3 is refused rather than silently taken over (`WORKFLOW_VERSION_MISMATCH`).

Parallel worker-pool defaults (`src/v3/pool.js`):

| Parameter | Default |
|-----------|---------|
| `poolSize` | `2` |
| `maxLeasedPerChange` | `6` |
| `reuseTasks` | `3` |
| `contextThreshold` | `0.7` |
| `contextTokens` | `128000` |
| `ttlMinutes` | `10` |
| `breakerFailures` | `2` |

A role's breaker opens after two consecutive failures and its agents are recycled.

## Language

SpecGate ships bilingual assets:

- **Chinese is the authoritative source**; English is a complete translation.
- Asset naming: English `*.md`, Chinese `*.zh.md`.
- The runtime and `sg_skill` select variants by the `language` key in `.specgate/config.yaml`.
- This repository's README is bilingual too: [`README.md`](README.md) (Chinese, the default view) and `README.en.md` (English).

## Quick start

```text
/sg-init                              # initialize the current directory
/sg-change add-login --type feature   # scaffold the change package; phase H1_PENDING
#   ... author proposal.md and specs/<capability>/spec.md ...
sg_run                                # runs M1; on pass, approve H1
sg_approve H1                         # human approval; phase becomes PLAN
#   ... author design.md, tasks.md, tests/cases.md, tests/mapping.json ...
sg_run                                # runs M2; on pass, approve H2
sg_approve H2                         # phase becomes EXECUTING
sg_run                                # execute wave by wave until all tasks merge
sg_run                                # INTEGRATING: full regression + acceptance.md
sg_approve H3                         # human acceptance
sg_run                                # ARCHIVING → DONE
```

For an empty project, the first two steps are:

```text
/sg-init                    # collect context, stop at H0_PENDING
sg_approve H0               # human approval (no change exists yet)
sg_run                      # scaffold the project and the first sample change → H1_PENDING
```

`/sg-status` reports the current phase and what to do next at any point.

Parallel notation in `tasks.md`:

```markdown
- [ ] T1 Implement the login API [P]
- [ ] T2 Implement the login page [P]
- [ ] T3 Integrate the login flow depends: T1,T2 role: reviewer
```

Without `[P]` or `depends`, tasks default to serial. `role:` selects the worker prompt (`implementer` or `tester`); other values are treated as review-only roles.

## Writes and guards

`guards.js` intercepts the `write` and `edit` tools. It rejects:

| Write target | Reason |
|--------------|--------|
| `.specgate/**` | Orchestrator-owned state |
| `openspec/specs/**` | Only the archive transaction may modify it |
| `acceptance.md` | Generated by the orchestrator |
| `<change>/design.md`, `<change>/tasks.md`, `<change>/tests/**`, `src/**`, `tests/**` **while in `H1_PENDING`** | H1 has not been approved yet |

Everything else is permitted. The guard is inert for projects whose `workflowVersion` is below 3, and it does not see writes performed through shell commands.

## Output display

| Entry point | Display | History |
|-------------|---------|---------|
| `sg_*` tools | Tool result card (success/error text) | Persisted in the session log |
| `/sg-*` commands | DSH persistent command card, expandable to the full text | `command/run` + `command/done` |
| First command in a new session | Additionally writes a `notice` context message, ensuring the session leaves the welcome page and shows the result | `user/message` (source.kind=`specgate`) |

Design constraints:

- Append the `notice` only when the agent is idle and the session has no messages yet; an active session only shows the command card and does not write history again.
- Never append a message between a tool call and its tool result. Earlier versions injected a synthetic `assistant/message`, which left `tool_use` without an adjacent `tool_result` and made subsequent requests fail with 400 outright.
- Command exceptions also produce output: they return `kind: 'error'`, and an empty session also gets an error `notice`.

## File layout

```text
.specgate/
├── config.yaml
├── state.json              # phase, change, approvals, plan
├── run.lock
├── worktrees/              # Git worktrees for parallel tasks
├── evidence/               # per-task run evidence
├── backups/
└── gates/
openspec/
├── changes/<change>/
│   ├── proposal.md         # 问题 / 目标 / 非目标 / 影响面
│   ├── design.md           # 目标与非目标 / 任务图 / AC 到用例 / 风险
│   ├── tasks.md            # task graph, [P] / depends / role
│   ├── specs/<capability>/spec.md
│   └── tests/{cases.md,mapping.json,touched.json,automation/}
└── specs/<capability>/spec.md   # written only on archive
```

`/sg-init` also appends these to `.gitignore`: `.specgate/state.json`, `.specgate/run.lock`, `.specgate/worktrees/`, `.specgate/evidence/`, `.specgate/backups/`, `.specgate/gates/`, `.specgate/runs/`.

For a brand-new project, approving `H0` additionally writes `project-context.md`, `AGENTS.md`, `docs/glossary.md`, `docs/adr/0001-initial.md`, `.github/workflows/ci.yml`, and a first sample change.

## Verification

- **269 tests pass / 0 fail** (`node --test`).
- `M1` rejects a proposal missing any of 问题 / 目标 / 非目标 / 影响面, and a delta with unresolved acceptance-criteria references.
- `M2` rejects a design missing any of its four sections, a task graph with cycles, an AC with no covering case, and undiscoverable suites.
- Approval hashes: editing `proposal.md`/`specs/**` after `H1`, or the plan after `H2`, invalidates the approval and forces re-approval.
- Write guard: writing `design.md` while `H1_PENDING` is rejected; writing it after approval is allowed. Shell writes are not intercepted.
- H0 gate: an empty project leaves `H0_PENDING` via `sg_approve gate="H0"` → `sg_run`, with no existing change required.
- Output regression: a command in a new session writes a `notice`; an active session does not duplicate history; a running agent writes no messages; failed commands also produce output.

See [verification.md](docs/design/verification.md) for the full record.

## Known limitations

- Write interception covers the `write` / `edit` tools; writing files directly through shell commands is not intercepted.
- Initialization requires a Git repository for worktree isolation and commit discipline; without one, parallel execution degrades to a single serial writer.
- Parallel worktrees require a clean working tree; dirty projects degrade to serial and do not isolate uncommitted changes.
- Merge conflicts are not resolved automatically; the worktree and branch are kept, and you must merge manually and re-run `sg_run`.
- Idempotent `--force` applies to append-type operations; state transitions are naturally re-run by advancing the phase.
- Agent roles are limited to `implementer`, `tester`, and review-only roles; the plugin does not ship a role catalog.
- Does not replace the AgentKit47 CLI's `init/upgrade/doctor/validate`; SpecGate is a DSH Host plugin, not a standalone CLI.
- The plugin provides no MCP server or MCP tools; MCP capabilities on the DSH side are independent of this plugin.
- **Upgrade note**: the predecessor plugin's early 0.2.0 `ak47_selftest_append` polluted the session log; continue in a new session and do not reuse old sessions that already show `tool_use` / `tool_result` 400 errors.

## Code review and formatting gate

Every code file changed by a push must pass review and formatting before it reaches the remote:

- **Local hooks**: run `npm run hooks:install` once per clone to install `pre-commit` and `pre-push`.
  - `pre-commit`: runs ESLint on staged JS/TS files, then Prettier formats them and re-stages the result.
  - `pre-push`: runs ESLint, `npm test` and `prettier --check` on every file changed by the push; any failure aborts the push with an error report.
- **CI re-check**: the `review-and-format` job in `.github/workflows/ci.yml` reviews and format-checks changed files on push and pull request. Enable branch protection on the main branch and require `review-and-format` and `test` as status checks.
- **Commands**:

  | Command | Purpose |
  |---------|---------|
  | `npm run lint` | Full-repository ESLint |
  | `npm run format:check` | Full-repository Prettier check |
  | `npm run gate` | Run the full gate against the diff from `origin/main` |
  | `npm run gate:fix` | Format the current changes and stage them |

> GitHub Actions runs after a push succeeds and cannot retract commits that are already on the remote; the local `pre-push` hook is what actually blocks the push. Branch protection stops merges whose checks did not pass, so commits created with `--no-verify` are still caught by CI.

## Development

```bash
node --test        # run the test suite
npm run lint       # ESLint
npm run format     # Prettier write
npm run gate       # full quality gate
```

Commit messages follow Conventional Commits: `<type>(<scope>): <description>`, where `type` is one of `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`. Descriptions are written in Chinese, stay within 72 characters, and do not end with a period.

## License

MIT, derived from the templates and workflow design of AgentKit47-Qoder.
