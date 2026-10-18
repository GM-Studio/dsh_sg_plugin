# Acceptance Record (v0.1.0 → v0.3.0)

Date: 2026-10-18
Environment: DSH `0.2.1-rc.2`; Node `v24.14.0`; Windows; profile `desktop`

## 1. Installation

- Command: `plugin_manager install_bundle target=E:\ai_workflow\sg_dsh`
- Result: `application: applied`; `bundle: dsh-plugin-specgate`; `version: 0.1.0`
- Plugin line: `include:specgate` / `dsh-plugin-specgate` / `fiberPhase: active`
- Reload: turning `set_plugin include:specgate` off and on again loads the new code; no Host restart is required

## 2. Capability Visibility

- Tools: `sg_status`, `sg_next`, `sg_gate`, `sg_deviation`, `sg_classify`, `sg_doctor`, `sg_propose`, `sg_archive`, `sg_init`, `sg_enable`, `sg_disable` all appear in the current Agent's tool table.
- Skills: 30 `specgate-*` Skills appear in the session skill catalog; `sg-skill-entry-guard` and others can be loaded.
- Prompt: after entering a project containing `.specgate/`, the system prompt automatically shows "SpecGate workflow enabled / current gates / next step / hard rules".

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

- `.specgate/`: `config.yaml`, `deviations.log`, `workflow-state.yaml`, `README.md`, `gates/`, `agents/`, `templates/`, `rules/`, `briefs/`, `out-of-scope/`, `experiences/`, `reviews/`
- `.dsh/skills/specgate/`: 30 Skills, 53 files
- `.specgate/agents/`: 9 Agent role texts
- `.specgate/templates/`: 10 template files
- `.specgate/templates/commands|rules/`: 12 reference files
- `.specgate/experiences/index.md`, `trigger-guide.md`; 5 module rules in `.specgate/rules/`; `.specgate/briefs/README.md`; `.specgate/out-of-scope/README.md` (9 knowledge assets/module rules in total)
- `openspec/changes|specs|changes/archive/`
- `AGENTS.md`: created with a `<!-- specgate:begin -->` section

Running `sg_init` a second time:

- Skills: 0 added, 53 skipped; Agents: 0 added, 9 skipped; templates: 0 added, 10 skipped; references: 0 added, 12 skipped; knowledge assets/module rules: 0 added, 9 skipped
- The `AGENTS.md` section was not duplicated
- Conclusion: idempotent

## 5. Other Tools

- `sg_propose` with G1/G2 unconfirmed returns: `Cannot create proposal: gates G1, G2 are missing. Please complete the /sg-gate confirmation first.`
- `sg_doctor`: `materialized-skills: 30/30`, conclusion passed.
- `sg_disable`: state becomes `Enabled: no`; prompt injection disappears.
- `sg_enable`: state returns to `Enabled: yes`; prompt injection returns.
- `sg_deviation`: writes to `.specgate/deviations.log`; the deviation count in `sg_status` goes from 0 → 1.
- `sg_propose` (with G1/G2 confirmed): creates `openspec/changes/demo-two/proposal.md`; two Changes appear in the state.

## 6. Automated Tests

Command: `node --test`

Result: **25 passed / 0 failed**.

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
- The slash commands `/sg-*`, `/sg-*` are registered, but were not clicked through the Web UI command palette one by one.
- Writing files directly through the shell (`pwsh` / `bash`) bypasses `write`/`edit` and is not intercepted by guard.
- The 9 Agents are currently role texts, not independent subagents.
- G6.5 Brief is an optional gate and is not included in the "pending confirmation" list by default.

---

## 8. v0.2.0 / v1.1 Incremental Acceptance (2026-10-18)

### 8.1 Installation and Capabilities

- First `remove_bundle dsh-plugin-specgate`, then `install_bundle E:\ai_workflow\sg_dsh`.
- Result: `application: applied`; `version: 0.2.0`; `include:specgate` active.
- Tools: `sg_commit` added, for a total of 12 `sg_*` tools.
- Skills: the 30 `specgate-*` Skills are still loadable.

### 8.2 New Project + Default Git

Command: `sg_init { path: "demo-app" }` (under the new directory `\.specgate_v11_e2e`).

- New directory: yes; mode: full.
- Git: `git init` + initial commit `72826a0 chore(specgate): initialize workflow project` (111 files).
- Generated: 30 Skills (53 files), 9 Agents, 11 templates, 12 reference commands/rules, 9 knowledge assets/module rules, 7 doc templates, 5 example files.
- `AGENTS.md`: full rules (including `## Gates`, Git workflow, knowledge capture, command quick reference).
- Workspace: clean; `sg_status` shows `Git: master ｜ clean ｜ latest commit: 72826a0 ...`.
- `sg_doctor`: `git-repo` / `git-status` both OK, `materialized-skills: 30/30`.

### 8.3 minimal and no-git

- `sg_init { path: "mini-app", minimal: true }`
  - Git initial commit `8b78a89` (60 files).
  - 30 Skills, `openspec/`, `experiences/index.md` + `trigger-guide.md`.
  - No `.specgate/agents`, no `.specgate/templates`, no `docs/`, no examples.
  - `AGENTS.md` contains the minimal rules (9 lines, without `## Gates`).
  - After fixing the report text, `mini-app2` shows `AGENTS.md: minimal rules created`, initial commit `51ba1b8`.
- `sg_init { path: "nogit-app", minimal: true, git: false }`
  - No `.git` generated; `.specgate/config.yaml` gets `git: false`; reports `Git: not enabled (--no-git)`.

### 8.4 Gate Clean and Commits

- After writing `note.txt` in `demo-app`, the prompt injection shows `Git: ... ｜ dirty 1`.
- `sg_gate G1 confirm` returns:
  `The workspace has 1 uncommitted change; please commit first (?? note.txt). Please run /sg-commit <message> or commit with git manually, then confirm the gate.`
- `sg_commit { message: "test: add gate clean verification file" }`:
  `Committed d078fc8: test: add gate clean verification file (1 file)`.
- Calling `sg_commit` again: `Nothing to commit.`
- After the commit, prompt injection returns to `Git: master ｜ clean ｜ latest commit: d078fc8 ...`.

### 8.5 Automated Tests

Command: `node --test`

Result: **74 passed / 0 failed**.

New coverage:

- New-session commands write a `notice` (`user/message`, `source.kind=specgate`, `form=notice`)
- Active sessions keep only the command card and do not write history again
- When `agent.status === 'running'`, no message is ever written (protects `tool_use`/`tool_result` pairing)
- Failed commands also produce an error `notice`
- Command names follow DSH syntax, have no colon aliases, and argument commands include `input.hint`
- When the command service loads late, `ctx.inject` registers the commands instead of silently losing them
- Explicit confirmation paths for command-channel gates `confirm --yes` / `waive --yes`
- Structured confirmation times out fail closed instead of waiting indefinitely
- Idempotency: state commands do not replay the cache; append commands dedupe for 24h, support force, use a concurrency lock, and read-only commands write nothing
- Task graph: `[P]` / `depends` / `role` parsing, serial default, waves, concurrency cap, dependency-cycle error
- Parallelism: worktree parallelism/waves/dependencies, duplicate dispatch skipped, merge conflicts keep the branch, non-Git serial degradation
- Health check: parallel results from four reviewer Agents merged
- Skills: all 30 registrations include `source`, satisfying DSH load validation
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
- Initialization: full mode, initial commit `a64e3da` (111 files); 30 Skills / 9 Agents / docs / examples.
- L1: `add-login` full G1-G11 flow; proposal/design/specs/tasks/source/archive passed.
- L2: `e2e-l2` full G1-G11 flow passed (script `docs/specgate/e2e-three-paradigms.mjs`).
- L3: `fix-login` / `e2e-l3` could still write design/specs/tasks while G3/G4/G5 were unconfirmed; source code still required G6/G7.
- Initialization branches: minimal, no-git, `--force` merge, AGENTS backup, non-empty directory protection, disabled, and idempotency all passed.
- Three-paradigm script output: `PASS L1 e2e-l1`, `PASS L2 e2e-l2`, `PASS L3 e2e-l3`, `ALL_PARADIGMS_PASS`.
- Result: 94 commits, 6 archived Changes, 0 active Changes, Git clean, `sg_doctor` passed.
- Report: `test_project/TEST_REPORT.md`.
- Coverage: lines 81.05% / branches 75.87% / functions 75.32% (not reaching 100%).

### 8.7 v1.1 Not Covered / Limitations

- Real UI clicks for `userQuestions` are not driven by the automation; gate interaction is covered with simulated answers.
- The slash commands `/sg-*`, `/sg-*` are registered, but were not clicked through the Web UI command palette one by one.
- Writing files directly through the shell still bypasses the `write`/`edit` guard.
- The 9 Agents are still role texts, not independent subagents.
- The default `git init` depends on system Git; environments without Git need `--no-git`.
- After a gate confirmation, writing the marker makes the workspace dirty, so a commit is required before the next gate; this is a deliberate v1.1 design.
