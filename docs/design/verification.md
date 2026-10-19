# Acceptance Record (v0.1.0 → v3.6.0)

Date: original record 2026-10-18; the Part 1 current-surface section is verified against `dsh-plugin-specgate` `3.6.0`
Environment (as recorded in 2026-10-18): DSH `0.2.1-rc.2`; Node `v24.14.0`; Windows; profile `desktop`

> **This document is part current reference, part dated history.**
> **Part 1** describes the current v3.6 surface and is the part to trust.
> **Part 2** is the original dated acceptance log (v0.1.0 – v1.1, 2026-10-18), kept for traceability.
> It describes a surface that no longer exists: the older `sg_*` tool generation, the `G1`–`G11`
> gates, the `L1`/`L2`/`L3` classification, `.specgate/agents/`, `.specgate/deviations.log`,
> `.dsh/skills/specgate/`, and 30 `specgate-*` Skills "registered in the session skill catalog".
> None of that is true in v3.6, and where a Part 2 line is contradicted, Part 1 wins.

---

# Part 1 — Current surface (v3.6.0)

Verified by reading the source and by running the test suite.

## Commands and tools

- **Slash commands: exactly 5** — `/sg-init`, `/sg-change`, `/sg-status`, `/sg-context`, `/sg-skill`
  (`src/v3/commands.js`).
- **Tools: exactly 6** — `sg_init`, `sg_change`, `sg_status`, `sg_skill`, `sg_run`, `sg_approve`
  (`src/v3/tools.js`).
- Every other `/sg-*` name that appears in this repository — `/sg-run`, `/sg-approve`, `/sg-gate`,
  `/sg-apply`, `/sg-commit`, `/sg-doctor`, `/sg-enable`, `/sg-disable`, `/sg-migrate`, `/sg-test`,
  `/sg-propose`, `/sg-archive`, `/sg-explore`, `/sg-next`, `/sg-classify`, `/sg-deviation` — names a
  **tool**, not a registered slash command. Where Part 2 says such a command "is registered", read it
  as "a tool of that name exists".

## Gates and phases

- Human gates `H0`, `H1`, `H2`, `H3`; quality gates `M1`, `M2`. There is no `G1`–`G11`, and no
  `L1`/`L2`/`L3` classification in the runtime.
- Phase machine: `IDLE` → `H0_PENDING` → `H1_PENDING` → `PLAN` → `H2_PENDING` → `EXECUTING` →
  `INTEGRATING` → `H3_PENDING` → `ARCHIVING`, plus `BLOCKED` and the terminal `DONE` / `ABORTED`.

## Skills

- **22 skills ship as plugin assets**: 17 `sg-skill-*` under `assets/skills/` and 5 `sp-skill-*`
  under `assets/sp/`. The naming prefixes are `sg-skill-*` / `sp-skill-*`; there is no `specgate-*`
  skill prefix.
- **Skills are not registered in the DSH session skill catalog.** `index.js` declares
  `inject = ['tools', 'agents']` — no `skills`, no `systemPrompt` — and no code in `src/` or
  `index.js` calls `skills.register` / `skills.registerProvider`. Nothing writes to
  `.dsh/skills/specgate/`.
- What skills actually do: their bodies are injected into **subagent prompts** through the role/phase
  mapping in `src/v3/skills.js`. The `sg_skill` tool and the `/sg-skill` command can print a skill
  body on request.

## Agents

- There is no agents catalog. `src/v3/pool.js` `ROLE_PROMPTS` contains only `implementer` and
  `tester`. The 11 `sg-agent-*` assets were never wired into any code and have been deleted; every
  `sg-agent-*` or `.specgate/agents/` reference in Part 2 is dangling.

## Initialization

- `/sg-init` generates a small skeleton: `.specgate/` (with `worktrees/`, `evidence/`, `backups/`),
  `openspec/{specs,changes}/`, `config.yaml`, and two `.gitkeep` files. It does **not** generate
  Skills, Agents, templates, docs, examples, or a materialized skills tree.
- Approving `H0` on a brand-new project additionally writes exactly 5 files —
  `.specgate/project-context.md`, `AGENTS.md`, `docs/glossary.md`, `docs/adr/0001-initial.md`,
  `.github/workflows/ci.yml` — plus a sample change.

## Tests

- **265 tests pass / 0 fail** (`node --test`). This supersedes the 25-test and 90-test counts
  recorded in Part 2.

---

# Part 2 — Historical acceptance logs (v0.1.0 – v1.1, dated 2026-10-18)

> Everything below this line is a dated log, reproduced as written. It is **not** a description of
> the current plugin: the command/tool counts, the `G1`–`G11` gates, the `L1`/`L2`/`L3`
> classification, the `specgate-*` skill catalog, `.specgate/agents/`, `.specgate/deviations.log`,
> and the generated Skills/Agents/templates/docs/example trees were all removed or replaced by v3.6.
> Skill counts and test counts in these logs are era-specific. See Part 1 for current facts.

## 1. Installation

- Command: `plugin_manager install_bundle target=E:\ai_workflow\sg_dsh`
- Result: `application: applied`; `bundle: dsh-plugin-specgate`; `version: 0.1.0`
- Plugin line: `include:specgate` / `dsh-plugin-specgate` / `fiberPhase: active`
- Reload: turning `set_plugin include:specgate` off and on again loads the new code; no Host restart is required

## 2. Capability Visibility

- Tools: `sg_status`, `sg_next`, `sg_gate`, `sg_deviation`, `sg_classify`, `sg_doctor`, `sg_propose`, `sg_archive`, `sg_init`, `sg_enable`, `sg_disable` all appear in the current Agent's tool table. *(v3.6 correction: these are tools of a removed generation; the current plugin registers 6 tools — `sg_init`, `sg_change`, `sg_status`, `sg_skill`, `sg_run`, `sg_approve`.)*
- Skills: 30 `specgate-*` Skills appear in the session skill catalog; `sg-skill-entry-guard` and others can be loaded. *(v3.6 correction: **false on three counts** — the count is 22, the prefix is `sg-skill-*` / `sp-skill-*`, and skills are **never** registered in the session skill catalog. They ship as plugin assets under `assets/` and are injected into subagent prompts. `sg-skill-entry-guard` was deleted; see `sg-skill-systematic-debugging` or `sg-skill-code-review`.)*
- Prompt: after entering a project containing `.specgate/`, the system prompt automatically shows "SpecGate workflow enabled / current gates / next step / hard rules". *(v3.6 correction: `index.js` declares no `systemPrompt` injection, so this prompt section no longer exists.)*

## 3. Gate Interception

Test project: `openspec/changes/demo/`, containing only `proposal.md`, with G1/G2/G3 all unconfirmed.

- Writing `design.md` directly:
  - Result: rejected.
  - Text: `SpecGate gate check failed: writing openspec/changes/demo/design.md requires confirming G1 Requirements Confirmation, G2 Change Classification Confirmation, and G3 proposal Review first.`
- After writing `.specgate/gates/G1.confirmed`, `G2.confirmed`, and `G3.confirmed`, retrying:
  - Result: allowed.
  - State: `demo [tasking]`, `proposal=completed design=completed specs=not-started tasks=not-started`.
  - Next step: `Review design, confirm G4`.

## 4. Initialization

Running `sg_init` in an empty project (containing only `.git/`):

- `.specgate/`: `config.yaml`, `deviations.log`, `workflow-state.yaml`, `README.md`, `gates/`, `agents/`, `templates/`, `rules/`, `briefs/`, `out-of-scope/`, `experiences/`, `reviews/` *(v3.6 correction: `/sg-init` now creates only a small skeleton — `.specgate/{,worktrees,evidence,backups}`, `openspec/{specs,changes}`, `config.yaml` and two `.gitkeep` files. There is no `deviations.log`, no `agents/`, no `gates/` marker tree, and no `templates/`.)*
- `.dsh/skills/specgate/`: 30 Skills, 53 files *(v3.6 correction: **this directory is never written by any code path.** Skills live in the plugin at `assets/skills/` (17 `sg-skill-*`) and `assets/sp/` (5 `sp-skill-*`), 22 in total, and are not materialized into the project.)*
- `.specgate/agents/`: 9 Agent role texts *(v3.6 correction: removed. There is no agents catalog; `ROLE_PROMPTS` in `src/v3/pool.js` holds only `implementer` and `tester`.)*
- `.specgate/templates/`: 10 template files *(v3.6 correction: no `.specgate/templates/` is created.)*
- `.specgate/templates/commands|rules/`: 12 reference files *(v3.6 correction: not created in v3.6.)*
- `.specgate/experiences/index.md`, `trigger-guide.md`; 5 module rules in `.specgate/rules/`; `.specgate/briefs/README.md`; `.specgate/out-of-scope/README.md` (9 knowledge assets/module rules in total) *(v3.6 correction: none of these are generated by `/sg-init` in v3.6.)*
- `openspec/changes|specs|changes/archive/`
- `AGENTS.md`: created with a `<!-- specgate:begin -->` section *(v3.6 correction: `AGENTS.md` is now written when `H0` is approved, not by `/sg-init`, and it is not marker-delimited.)*

Running `sg_init` a second time:

- Skills: 0 added, 53 skipped; Agents: 0 added, 9 skipped; templates: 0 added, 10 skipped; references: 0 added, 12 skipped; knowledge assets/module rules: 0 added, 9 skipped *(v3.6 correction: there are no Skills, Agents, templates, references or knowledge assets to materialize; `/sg-init` is idempotent over its small skeleton and `H0` output instead.)*
- The `AGENTS.md` section was not duplicated
- Conclusion: idempotent

## 5. Other Tools

- `sg_propose` with G1/G2 unconfirmed returns: `Cannot create proposal: gates G1, G2 are missing. Please complete the /sg-gate confirmation first.` *(v3.6 correction: there is no `sg_propose` tool and no `/sg-gate` command; the current flow creates a change via `sg_change` / `/sg-change`.)*
- `sg_doctor`: `materialized-skills: 30/30`, conclusion passed. *(v3.6 correction: **stale** — there is no `sg_doctor` tool and no `materialized-skills` check, because skills are never materialized into the project.)*
- `sg_disable`: state becomes `Enabled: no`; prompt injection disappears. *(v3.6 correction: no `sg_disable` tool and no prompt injection; use `/sg-status` and the config file instead.)*
- `sg_enable`: state returns to `Enabled: yes`; prompt injection returns. *(v3.6 correction: no `sg_enable` tool.)*
- `sg_deviation`: writes to `.specgate/deviations.log`; the deviation count in `sg_status` goes from 0 → 1. *(v3.6 correction: no `sg_deviation` tool and no `.specgate/deviations.log`.)*
- `sg_propose` (with G1/G2 confirmed): creates `openspec/changes/demo-two/proposal.md`; two Changes appear in the state. *(v3.6 correction: no `sg_propose` tool; use `sg_change` / `/sg-change`.)*

## 6. Automated Tests

Command: `node --test`

Result: **25 passed / 0 failed**. *(v3.6 correction: the current suite is **265 tests pass / 0 fail**. The counts in §6 and §8.5 are era-specific snapshots.)*

Coverage:

- State inference (proposal/design/specs/tasks, project state)
- Gate confirmation/waiving/downstream invalidation
- Write interception, L3 exemption, post-write invalidation
- Initialization and idempotency, AGENTS.md appended only once
- Plugin assembly (tools/commands/skills/prompt/guard)
- Three gate interaction branches (pass / needs changes / confirm waive)
- Failed tool output serializes to lossless JSON

## 7. Not Covered / Limitations

- Real UI clicks for `userQuestions` are not driven by the automation; the interaction logic is covered with simulated answers.
- The slash commands `/sg-*`, `/sg-*` are registered, but were not clicked through the Web UI command palette one by one. *(v3.6 correction: exactly 5 slash commands are registered — `/sg-init`, `/sg-change`, `/sg-status`, `/sg-context`, `/sg-skill`; the rest are tools.)*
- Writing files directly through the shell (`pwsh` / `bash`) bypasses `write`/`edit` and is not intercepted by guard.
- The 9 Agents are currently role texts, not independent subagents. *(v3.6 correction: the 9 role texts and the `sg-agent-*` assets were deleted; only the `implementer` and `tester` role prompts remain in `src/v3/pool.js`.)*
- G6.5 Brief is an optional gate and is not included in the "pending confirmation" list by default. *(v3.6 correction: there is no G6.5; the gates are H0–H3 plus M1/M2.)*

---

## 8. v0.2.0 / v1.1 Incremental Acceptance (2026-10-18)

> Historical log entry. The v0.2.0/v1.1 surface it records (12 tools, `sg_commit`, `sg_gate`,
> `sg_doctor`, `materialized-skills`, `--minimal` / `--no-git`, the `G1`–`G11` gates and the
> `L1`/`L2`/`L3` paradigms) was removed or replaced in v3.6 — see Part 1.

### 8.1 Installation and Capabilities

- First `remove_bundle dsh-plugin-specgate`, then `install_bundle E:\ai_workflow\sg_dsh`.
- Result: `application: applied`; `version: 0.2.0`; `include:specgate` active.
- Tools: `sg_commit` added, for a total of 12 `sg_*` tools. *(v3.6 correction: there is no `sg_commit` tool; the current plugin registers 6 tools.)*
- Skills: the 30 `specgate-*` Skills are still loadable. *(v3.6 correction: 22 skills ship as plugin assets (`sg-skill-*` / `sp-skill-*`) and are injected into subagent prompts; they are not registered in the session skill catalog.)*

### 8.2 New Project + Default Git

Command: `sg_init { path: "demo-app" }` (under the new directory `\.specgate_v11_e2e`).

- New directory: yes; mode: full.
- Git: `git init` + initial commit `72826a0 chore(specgate): initialize workflow project` (111 files).
- Generated: 30 Skills (53 files), 9 Agents, 11 templates, 12 reference commands/rules, 9 knowledge assets/module rules, 7 doc templates, 5 example files. *(v3.6 correction: `/sg-init` generates none of these. It writes a small skeleton — `.specgate/{,worktrees,evidence,backups}`, `openspec/{specs,changes}`, `config.yaml`, two `.gitkeep` files — and approving `H0` then writes exactly 5 files: `.specgate/project-context.md`, `AGENTS.md`, `docs/glossary.md`, `docs/adr/0001-initial.md`, `.github/workflows/ci.yml`, plus a sample change.)*
- `AGENTS.md`: full rules (including `## Gates`, Git workflow, knowledge capture, command quick reference). *(v3.6 correction: `AGENTS.md` is now written at `H0` approval and contains the current plugin's rules, not these v1.1 sections.)*
- Workspace: clean; `sg_status` shows `Git: master ｜ clean ｜ latest commit: 72826a0 ...`.
- `sg_doctor`: `git-repo` / `git-status` both OK, `materialized-skills: 30/30`. *(v3.6 correction: no `sg_doctor` tool and no `materialized-skills` check exist.)*

### 8.3 minimal and no-git

- `sg_init { path: "mini-app", minimal: true }`
  - Git initial commit `8b78a89` (60 files).
  - 30 Skills, `openspec/`, `experiences/index.md` + `trigger-guide.md`. *(v3.6 correction: `/sg-init` writes no Skills and no `experiences/`; 22 skills ship as plugin assets instead.)*
  - No `.specgate/agents`, no `.specgate/templates`, no `docs/`, no examples.
  - `AGENTS.md` contains the minimal rules (9 lines, without `## Gates`). *(v3.6 correction: the current `AGENTS.md` is generated at `H0` approval and there is no `--minimal` split of it.)*
  - After fixing the report text, `mini-app2` shows `AGENTS.md: minimal rules created`, initial commit `51ba1b8`.
- `sg_init { path: "nogit-app", minimal: true, git: false }` *(v3.6 correction: `sg_init` takes no parameters in v3.6.)*
  - No `.git` generated; `.specgate/config.yaml` gets `git: false`; reports `Git: not enabled (--no-git)`.

### 8.4 Gate Clean and Commits

- After writing `note.txt` in `demo-app`, the prompt injection shows `Git: ... ｜ dirty 1`. *(v3.6 correction: there is no prompt injection; Git state is reported by `sg_status` / `/sg-status`.)*
- `sg_gate G1 confirm` returns:
  `The workspace has 1 uncommitted change; please commit first (?? note.txt). Please run /sg-commit <message> or commit with git manually, then confirm the gate.` *(v3.6 correction: no `sg_gate` tool and no `/sg-commit` command; gates are advanced with `sg_approve` / `/sg-run`.)*
- `sg_commit { message: "test: add gate clean verification file" }`:
  `Committed d078fc8: test: add gate clean verification file (1 file)`. *(v3.6 correction: no `sg_commit` tool.)*
- Calling `sg_commit` again: `Nothing to commit.`
- After the commit, prompt injection returns to `Git: master ｜ clean ｜ latest commit: d078fc8 ...`. *(v3.6 correction: no prompt injection exists.)*

### 8.5 Automated Tests

Command: `node --test`

Result: **90 passed / 0 failed**. *(v3.6 correction: the current suite is **265 tests pass / 0 fail**.)*

New coverage:

- Finished commands hand the full output back through `agent.followup` (`source.kind=specgate`, `source.command=<command>`, message `role=user`), so the agent presents it in the conversation and asks for the next step
- Active sessions receive the hand-off too (no longer only the command card), and fresh sessions are no longer hidden by the welcome page
- Without `followup`, or when the hand-off is rejected, it degrades to a `notice` (`user/message`, `form=notice`, fresh sessions only)
- When `agent.status === 'running'`, no message is ever written (protects `tool_use`/`tool_result` pairing)
- Failed commands are handed back too, carrying the original error text for the agent to relay
- Command names follow DSH syntax, have no colon aliases, and argument commands include `input.hint`
- When the command service loads late, `ctx.inject` registers the commands instead of silently losing them
- Explicit confirmation paths for command-channel gates `confirm --yes` / `waive --yes`
- Structured confirmation times out fail closed instead of waiting indefinitely
- Idempotency: state commands do not replay the cache; append commands dedupe for 24h, support force, use a concurrency lock, and read-only commands write nothing
- Task graph: `[P]` / `depends` / `role` parsing, serial default, waves, concurrency cap, dependency-cycle error
- Parallelism: worktree parallelism/waves/dependencies, duplicate dispatch skipped, merge conflicts keep the branch, non-Git serial degradation
- Health check: parallel results from four reviewer Agents merged
- Skills: all 30 registrations include `source`, satisfying DSH load validation *(v3.6 correction: **there are no skill registrations at all.** No code calls `skills.register` / `skills.registerProvider`, and the 22 skills are not in the session catalog.)*
- `--path` creates a new directory + default git init + initial commit
- `--minimal` / `--no-git` / `--force` for a non-empty directory
- Full `AGENTS.md` backup/merge/dedupe
- Git clean check before gates, `--no-git` warning
- `sg_commit` tool commit and empty commit
- Uninitialized project suggests `/sg-init`
- Archiving clears gates; a new Change clears G3-G11
- Checking off tasks does not invalidate G6; only adding tasks does
- L3 classification does not require G1; L3 can skip G3/G4/G5
- Test file detection is limited to code file extensions

### 8.6 Real `test_project` Regression (2026-10-18)

- Path: `E:\ai_workflow\test_project`
- Initialization: full mode, initial commit `a64e3da` (111 files); 30 Skills / 9 Agents / docs / examples. *(v3.6 correction: `/sg-init` no longer generates Skills, Agents, docs or examples; see Part 1.)*
- L1: `add-login` full G1-G11 flow; proposal/design/specs/tasks/source/archive passed. *(v3.6 correction: there is no `G1`–`G11` and no `L1`/`L2`/`L3` in the runtime; the current gates are H0–H3 plus M1/M2.)*
- L2: `e2e-l2` full G1-G11 flow passed (script `docs/specgate/e2e-three-paradigms.mjs`).
- L3: `fix-login` / `e2e-l3` could still write design/specs/tasks while G3/G4/G5 were unconfirmed; source code still required G6/G7. *(v3.6 correction: the L-paradigm classification was removed.)*
- Initialization branches: minimal, no-git, `--force` merge, AGENTS backup, non-empty directory protection, disabled, and idempotency all passed. *(v3.6 correction: `sg_init` now takes no parameters; there is no `--minimal` / `--no-git` / `--force` in v3.6.)*
- Three-paradigm script output: `PASS L1 e2e-l1`, `PASS L2 e2e-l2`, `PASS L3 e2e-l3`, `ALL_PARADIGMS_PASS`.
- Result: 94 commits, 6 archived Changes, 0 active Changes, Git clean, `sg_doctor` passed. *(v3.6 correction: no `sg_doctor` tool exists.)*
- Report: `test_project/TEST_REPORT.md`.
- Coverage: lines 81.05% / branches 75.87% / functions 75.32% (not reaching 100%).

### 8.7 v1.1 Not Covered / Limitations

- Real UI clicks for `userQuestions` are not driven by the automation; gate interaction is covered with simulated answers.
- The slash commands `/sg-*`, `/sg-*` are registered, but were not clicked through the Web UI command palette one by one. *(v3.6 correction: only 5 slash commands are registered — `/sg-init`, `/sg-change`, `/sg-status`, `/sg-context`, `/sg-skill`.)*
- Writing files directly through the shell still bypasses the `write`/`edit` guard.
- The 9 Agents are still role texts, not independent subagents. *(v3.6 correction: those role texts were deleted; only `implementer` and `tester` remain in `src/v3/pool.js`.)*
- The default `git init` depends on system Git; environments without Git need `--no-git`. *(v3.6 correction: `sg_init` no longer runs `git init` or takes flags.)*
- After a gate confirmation, writing the marker makes the workspace dirty, so a commit is required before the next gate; this is a deliberate v1.1 design.
