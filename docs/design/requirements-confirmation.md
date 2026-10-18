# SpecGate Workflow Migration to a DSH Plugin: Requirements Clarification and Confirmation Draft

> Document status: **v1.1 (confirmed, 2026-10-18)**
> Baseline versions: AgentKit47 `0.7.11`; DSH `0.2.1-rc.2`; current environment Windows + PowerShell
> Constraint: This document is the single requirements baseline for design, implementation, and acceptance. Any scope change must append a "Change Log" entry and be confirmed again.
> v1.1 changes: plugin built-in initialization, new project directory creation, complete `AGENTS.md`, default `git init`, gate-level commit discipline, enable/disable switch.

### Decision Record (v1.0, 2026-10-18)

| Decision item | Your choice | Corresponding question |
|--------|----------|----------|
| Delivery and activation | workspace bundle + project-level opt-in | Q1=A, Q9=B |
| Migration scope | **one-time full migration** | Q2=A |
| Gate strength | Hybrid: hard block on writes, soft reminder for stage progression | Q3=C |
| Skill hosting | Dual-track: built-in defaults + init materialization | Q4=C |
| Agent roles | Main Agent + Skills first, split into subagents later | Q5=C |
| Remaining Q6-Q16 | Per recommended defaults | — |

**Alignment clarification (confirmed)**: Q2 chose "one-time full", while Q5 chose "Main Agent + Skills first". This document interprets this as follows:

- "Full" means **all 30 Skills, 11 gates, the OpenSpec process, the knowledge-capture directories, and the role text for 9 Agents** are migrated;
- "Agents not split yet" only means **9 independent subagents are not created at runtime right away**; roles are first carried by Skill/prompt templates; the 9 subagent templates are deferred to a later optional phase.

If it is later decided that "full" must include runtime splitting into 9 independent subagents, a change record must be appended and the scope and schedule adjusted.

---

## 0. One-Sentence Goal

Turn SpecGate's Qoder workflow of "skills + gates + OpenSpec + knowledge capture" into a plugin that can be installed in DSH, enabled per project, audited, and uninstalled — rather than copying the `.qoder/` configuration verbatim.

---

## 1. Fact-Checking (Verified, to Avoid Speculation)

| # | Conclusion | Basis |
|---|------|------|
| F1 | This repository is SpecGate's **generator/template repository**, not a consumer project that has already been initialized with SpecGate. The root has no `.qoder/`, `.specgate/`, or `openspec/`. | `glob .qoder/**` and `glob .specgate/**` both return no results; the capability assets all live under `templates/qoder/` |
| F2 | Actual capability assets: **9 Agents, 30 Skills, 8 Commands, 9 Qoder Hook bindings, 4 optional rule files**. | `templates/qoder/agents/*.md` (9), `templates/qoder/skills/**/SKILL.md` (30), `templates/qoder/commands/**/*.md` (8), `templates/qoder/settings.json` (9 bindings) |
| F3 | Capability counts are inconsistent: the repository `AGENTS.md` says "33 Skills", the README says "29", and the actual templates contain **30**; the 4 `openspec-*` entries counted in are actually `commands/sg/*` in the templates, not Skills. | Compare the glob results from F2 against `AGENTS.md` and `README.md` |
| F4 | Gate state is already **file-based**: marker files such as `.specgate/gates/G1.confirmed`; the deviation log is `.specgate/deviations.log`. | `grep` hits in `pre-write-artifacts-check.sh`, `requirements-definition`, `entry-guard`, etc. |
| F5 | On the Qoder side, Hooks only have 5 event types: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`; scripts are bash + jq, and the policy is mainly a mix of blocking and warnings. | `templates/qoder/settings.json`, `templates/qoder/hooks/*.sh` |
| F6 | Capabilities a DSH plugin can register/intercept (verified via Inspect): `skills.register` / `skills.registerProvider`, `commands.register`, `tools.register` / `tools.guard`, `systemPrompt.section`, `systemPrompt.context`, `userQuestions.ask`, `tools/pre-execute`, `tools/post-execute`, `fs/write-intent`, `fs/edit-intent`, `agent/pre-step`, `session/event`. | `cordis_inspect_query` Host `Service` / `Event` |
| F7 | DSH skills can be discovered from the filesystem: project root `.dsh/skills`, `.agents/skills`, custom directories, `$DSH_HOME/skills`; supports `<name>/SKILL.md` directory packages or `<name>.md` flat files; frontmatter requires `name`, `description`, with optional `whenToUse`, `metadata`, `disable-model-invocation`, `user-invocable`. | `@deepseek-ai/dsh-skill-filesystem` README |
| F8 | DSH plugins are installed as a bundle: `package.json` declares `dsh.bundle.patch`, and `plugin_manager install_bundle` installs it into the current profile; this affects all sessions in that profile and requires danger-full-access or approval; `engines.dsh` can constrain the version. | `cordis-plugin-development`, `references/host-plugin.md`, `plugin_manager` tool description |
| F9 | DSH has no "Agent auto-routing" equivalent to Qoder. What is available now is the `subagent` / `subagent_fork` tools, the Agent Preset mechanism, and on-demand Skill loading. | Current Tool list and the `agentPresets` Service; no automatic role dispatcher was found |
| F10 | In the current environment, the `pwsh` process exited twice in a row with `0xC0000142` (DLL initialization failure), so commands cannot run; this is not a repository code issue, but it affects how verification will be performed later. | Two `pwsh` invocations returned `[exit code: 3221225794]` |
| F11 | The `skill` tool is available in the current session, and the loaded Skills come from the Agent Preset's bundled skills; the `skill-filesystem` and `tool-skill` lines in the profile show as inactive. This means "skills are available" does not equal "the filesystem skill source is enabled"; the mount method must be confirmed before implementation. | `Config.listConfigs`, current skill catalog |

---

## 2. Goals and Success Criteria

### 2.1 Goals

- **G1 Installable**: Installed as a DSH bundle/plugin; users are not required to manually copy `.qoder/`.
- **G2 Preserve core differentiation**: 11 gate points + deviation log + L1/L2/L3 paradigms + Spec vertical slicing + TDD/review gates must not be simplified into "a few prompts".
- **G3 Load skills on demand**: 30 Skills are not injected into context all at once; they load only on match.
- **G4 Queryable, auditable state**: Users can ask "where are we now" at any time; status comes from project files, not conversation cache.
- **G5 Coexist with existing Qoder/SpecGate projects**: Read existing `.specgate/` and `openspec/` without breaking `.qoder/`; gradual migration is possible.
- **G6 Verifiable**: Provide a repeatable end-to-end demo and automated tests, rather than "it looks like it runs".

### 2.2 Success Criteria from the User's Perspective

| # | Scenario | Success behavior |
|---|------|----------|
| S1 | Starting a new feature in an empty project | After requirements are entered, the AI first does entry triage and requirement restatement; it does not write code directly |
| S2 | The AI wants to skip proposal/design/specs/tasks | Writing subsequent artifacts or source code is explicitly blocked, with a hint to "complete G3/G4/G5/G6 first" |
| S3 | The user asks "where are we now" | One command returns the current Change, artifact completion, and next-step suggestions |
| S4 | The user agrees to skip a gate | A traceable deviation record must be left; without one, work cannot continue |
| S5 | The user no longer wants to use it | After uninstalling the plugin, `.specgate/` and `openspec/` in the project remain readable and intact |
| S6 | An existing Qoder project is onboarded | User customizations are not overwritten; repeated initialization does not produce duplicate content |

---

## 3. Scope

### 3.1 In Scope (Full Scope; Priority Only Indicates Implementation Order)

> Per Q2=A, the initial scope is **full**; the P0/P1/P2 in the table below only indicate recommended implementation order and **do not mean the initial phase may cut them**. Any downgrade requires separate confirmation.

| Priority | Capability | Description |
|--------|------|------|
| P0 | Plugin packaging, installation, enable/disable | One installable bundle; project-level opt-in to avoid polluting all sessions |
| P0 | Project initialization `/specgate:init` | Generate the `.specgate/` skeleton, skills, `openspec/` directories, and rule entry point |
| P0 | Hosting 30 Skills | All 30 available; verify frontmatter and body item by item; content semantically consistent with the source templates |
| P0 | Status query and next step | `status` / `next`, inferred in real time from `openspec/changes/**` and `.specgate/` |
| P0 | Runtime expression of gates G1-G11 | At minimum G1, G2, G3, G7, G8, G9 must be enforceable; the rest may start as soft reminders |
| P0 | Deviation log | Skipping a gate must write `.specgate/deviations.log` |
| P0 | OpenSpec process | Command or tool entry points for `propose` / `apply` / `archive`; file formats unchanged |
| P1 | L1/L2/L3 classification | Entry triage + change classification + gate strength matrix |
| P1 | TDD / code review / vertical slicing checks | Checks before writing source code, specs, and commits |
| P1 | Compatible reading of existing SpecGate projects | Read `.specgate/config.yaml`, `progress.yaml`, `workflow-state.yaml` |
| P2 | Hosting 9 Agent roles | Carried first by Skill text/subagent prompt templates; whether to build 9 independent subagents is TBD |
| P2 | Knowledge capture | Retrieval, archiving, and indexing for `.specgate/experiences/` |
| P2 | Web UI panel | Status, gates, progress; may be omitted initially |
| P2 | `specgate` CLI capability wrapper | `doctor`, `validate`, `upgrade`, etc. |

### 3.2 Out of Scope (Explicitly Not Done in the Initial Phase)

- Do not rewrite all of the `init` / `upgrade` / `doctor` / `validate` logic of the `specgate` CLI.
- Do not port Qoder's shell Hooks 1:1 (the bash + jq + stderr warning model).
- Do not implement Qoder-style "Agent auto-routing/auto-delegation".
- Do not modify OpenSpec's file format, directory structure, or `openspec` CLI contract.
- Do not modify the existing Qoder artifacts under `templates/qoder/` (unless a single cross-platform source of truth is confirmed as a goal).
- Do not do CI/CD, GitLab/GitHub integration, or a team permission system.
- Do not provide full support for non-Git projects (TBC).
- Do not force all projects to use the SpecGate workflow globally by default.

---

## 4. Users and Usage Scenarios

### 4.1 Target Users

- Engineers developing real projects in the DSH Web GUI or DSH CLI.
- People who already understand or are willing to accept SpecGate's process discipline; they do not want to explain the workflow from scratch every time.
- People who may have already used SpecGate in a Qoder project and want to move the same workflow to DSH.

### 4.2 Core Scenarios

1. **New project start**: empty repository → `/specgate:init` → enter requirements → G1 restatement confirmation → L1/L2/L3 classification → OpenSpec artifacts → implementation → review → archive.
2. **Existing SpecGate project migration**: the project already has `.specgate/` and `openspec/` → install the plugin → the plugin recognizes the existing state → continue from the current phase without starting over.
3. **Daily small fixes**: typo / version number / unit test → entry triage as lightweight → the full workflow is not enforced.
4. **Skipping a gate**: the user explicitly asks to skip G4 → record the deviation → continue; without a record, work cannot continue.
5. **Uninstall/rollback**: the user disables the plugin → project files are retained → they can return to Qoder or a manual workflow.

---

## 5. Functional Requirements

### FR-01 Installation and Enabling

- FR-01.1 Install as a DSH bundle into the current profile; the package declares `dsh.bundle.patch` and `engines.dsh`.
- FR-01.2 **Project-level opt-in by default**: gates and prompt injection take effect only when `.specgate/config.yaml` exists at the project root, or when the user explicitly runs `/specgate:enable`. This prevents one global plugin from affecting all sessions.
- FR-01.3 Provide `/specgate:disable` for temporary deactivation; once disabled, no tools are intercepted and no prompts are injected, but project files are retained.
- FR-01.4 Install/uninstall/disable must not modify user project files; only `/specgate:init` writes to the project.
- FR-01.5 The installation result must be observable: after installation, confirm through Inspect or a command that the plugin line is active; do not rely on logs alone.

### FR-02 Project Initialization `/specgate:init`

- FR-02.1 Generate/fill in:
  - `.specgate/`: `config.yaml`, `gates/`, `deviations.log` (empty file or header), the four `experiences/` category directories.
  - `.dsh/skills/specgate/`: 30 Skills (directory package structure).
  - `openspec/`: `changes/`, `specs/`, `archive/` (if absent).
  - `AGENTS.md` or `.dsh/AGENTS.md`: project-level rule entry point (do not overwrite existing user content).
  - `docs/` templates: PRD, architecture, deviation log, etc. (optional, generated with `--full`).
- FR-02.2 Idempotent: repeated execution does not append duplicates or overwrite user modifications; provide a diff preview before writing.
- FR-02.3 Support `--minimal` (generate only gates and core skills) and `--full` (full set).
- FR-02.4 Do not overwrite an existing `.qoder/`; do not delete any user files.
- FR-02.5 Initialization report: what was generated, what was skipped, and what needs user confirmation.

### FR-03 Skill Hosting

- FR-03.1 All 30 Skills can be loaded by name with DSH's `skill` tool; frontmatter contains `name`, `description`, and optional `whenToUse`.
- FR-03.2 Skill bodies remain in Chinese; replace Qoder-specific paths, tool names, and Hook terminology with DSH equivalents (for example, `Write/Edit` → `write/edit`, `.qoder/` → `.dsh/` or `.specgate/`).
- FR-03.3 Checklists, templates, and example files shipped with skills are retained with the package, and resource paths are resolvable.
- FR-03.4 Skill content is not injected into the system prompt all at once; it is loaded by the model/user only on match.
- FR-03.5 The list of 30 skills is based on the actual templates, correcting the "29/33/30" discrepancy; whether the 4 `sg` commands should be upgraded to skills is TBC (Q6).

### FR-04 Commands

Candidate commands (names and namespace TBC, Q10):

| Command | Purpose | Priority |
|------|------|--------|
| `/specgate:init` | Initialize/fill in project assets | P0 |
| `/specgate:status` | Current project/Change/Artifact status | P0 |
| `/specgate:next` | Next-step suggestions | P0 |
| `/specgate:gate <Gx>` | View/advance a specified gate | P0 |
| `/specgate:deviation` | Record a deviation | P0 |
| `/specgate:classify` | Determine L1/L2/L3 | P1 |
| `/specgate:doctor` | Project health check | P1 |
| `/specgate:enable` / `/specgate:disable` | Project-level enable/disable | P1 |
| `/specgate:uninstall` | Remove plugin-generated artifacts (keep user files) | P1 |
| `/sg-propose` / `apply` / `archive` / `explore` | OpenSpec process entry points | P0/P1 |

- FR-04.1 Commands must have a `description` and input hints; incorrect usage returns a readable error.
- FR-04.2 Whether the `:` in command names is accepted by the DSH command registry has not been verified; if not supported, fall back to `/sg-status`, etc. (Q10).

### FR-05 Gates

- FR-05.1 The definitions, trigger conditions, confirmation questions, and paradigm strengths of G1-G11 follow `templates/qoder/rules/gate-control.md`, but the interaction is rewritten for DSH capabilities.
- FR-05.2 Gate state is persisted to disk:
  - `.specgate/gates/<Gx>.confirmed`: confirmation marker (keeps the existing convention).
  - `.specgate/workflow-state.yaml`: current Change, paradigm, phase, last update time (if confirmed for use).
  - `.specgate/deviations.log`: skip records, append-only.
- FR-05.3 Gate confirmation is completed via `userQuestions.ask` (or an equivalent structured question); it must offer "pass / needs changes / skip (record deviation)" options and record the time, Gate, Change, and user choice.
- FR-05.4 **Hard gate** (strength TBC in Q3): pre-check `write` / `edit` tool calls; deny when a prerequisite Gate is missing, returning a clear next step.
- FR-05.5 **Soft gate**: inject "current Gate + next step + prohibited actions" into the system prompt, without blocking ordinary conversation.
- FR-05.6 Skipping a hard gate: explicit user approval + `/specgate:deviation` write + gate state marked `waived`; all three are required.
- FR-05.7 Wait for only one gate point at a time; do not ask about multiple artifacts together (follows the SpecGate rule).

### FR-06 State Machine and "Next Step"

- FR-06.1 Infer in real time from `openspec/changes/**` and `.specgate/`; do not use a cache (`always-refresh`).
- FR-06.2 `status` output: project state, active Change list, artifact completion for each Change, current Gate, next-step suggestions.
- FR-06.3 `next` gives suggestions according to the `nextStepRules` priority in `templates/workflow/workflow-rules.yaml`.
- FR-06.4 Blockage detection: when the state is `implementing`, the last activity was > 2 days ago, and completion is < 50%, proactively prompt.
- FR-06.5 Rollback: recognize intents such as "architecture adjustment/requirement change/the approach is wrong", and indicate the affected artifacts and rollback order.
- FR-06.6 Do not manually modify the status fields in `workflow-state.yaml`; the state is computed by tools and then written.

### FR-07 L1/L2/L3 Change Classification

- FR-07.1 Entry triage (Q&A/lightweight/heavyweight) is handled by `sg-skill-entry-guard`, which should be loaded as the first step for any user input.
- FR-07.2 Heavyweight changes enter `sg-skill-change-classification`, which gives an L1/L2/L3 recommendation and rationale.
- FR-07.3 After the user confirms via G2, the paradigm is written; subsequent gate strength follows the matrix.
- FR-07.4 The L3 simplified path must retain G2, G6, G7 (simplified), and G8-G11; it must not skip all of them.

### FR-08 TDD / Review / Vertical Slicing Checks

- FR-08.1 Before writing source code: check whether a corresponding test file exists; if not, decide between warn or block according to the Q3 choice.
- FR-08.2 When writing specs: check whether they are organized by vertical slicing; horizontal splitting is treated as a "fatal issue" (at minimum a strong warning).
- FR-08.3 Code review: check whether there is a review record before G8; check the review conclusion before G9.
- FR-08.4 Before committing: check that tests pass, review records exist, and documentation is updated (may start as reminders, then harden later).
- FR-08.5 All checks must state "why it was blocked + how to fix it"; do not only report an error.

### FR-09 Knowledge Capture

- FR-09.1 `.specgate/experiences/` keeps four categories: `tool-research/`, `best-practices/`, `pitfall-records/`, `decisions/`.
- FR-09.2 Provide a retrieval entry point (Skill or command) that retrieves according to the trigger conditions in `trigger-guide.md`.
- FR-09.3 Experience archiving must be structured (time, source, conclusion, applicability, verification status); reject unverified assumptions.
- FR-09.4 The initial phase may implement only "skills + directory conventions" without a separate tool (Q2 scope).

### FR-10 Agent Roles

- FR-10.1 Migrate the role definitions, responsibility boundaries, and output formats of the 9 Agents into a carrier usable by DSH.
- FR-10.2 The hosting approach is TBD (Q5):
  - A. 9 independent subagent prompt templates (choose a role when calling `subagent`).
  - B. Keep only 1 main Agent + Skills; roles become "perspectives" within a Skill.
  - C. B first, then A.
- FR-10.3 Regardless of the approach, role permission boundaries (read-only/writable directories) must be explicit; roles must not overstep to write user files.

### FR-11 OpenSpec

- FR-11.1 Do not change the structure of `openspec/changes/<name>/{proposal.md,design.md,tasks.md,specs/**}`.
- FR-11.2 Provide entry points for `propose` / `apply` / `archive` / `explore`; internally they may call the `openspec` CLI or implement only file conventions.
- FR-11.3 Whether to depend on the `@fission-ai/openspec` CLI is TBD (Q6); if depended on, the version must be declared and a fallback path given on failure.
- FR-11.4 The vertical slicing strategy is a mandatory check item for `propose`.

### FR-12 Compatibility and Migration

- FR-12.1 Read existing `.specgate/config.yaml`, `progress.yaml`, and `workflow-state.yaml`; do not require format migration.
- FR-12.2 Keep the `.specgate/gates/*.confirmed` convention so gate state can be shared between the Qoder side and the DSH side.
- FR-12.3 Do not modify `.qoder/`; if both platforms must coexist, state clearly "which one is the source of truth".
- FR-12.4 On uninstall, remove only files generated by the plugin itself and not modified by the user; keep user-modified files and notify.

### FR-13 Observability

- FR-13.1 All gates, deviations, initialization, and state changes have readable logs.
- FR-13.2 `doctor` can check: missing directories, incomplete artifacts, contradictory gate states, and malformed deviation logs.
- FR-13.3 Logs must not contain keys, tokens, or user privacy content.

### FR-14 Web UI (P2, TBC)

- FR-14.1 Optional read-only panel: current Change, artifact progress, Gate state, deviation records.
- FR-14.2 Optional interaction: confirm/skip gates directly in the panel.
- FR-14.3 Not done by default in the initial phase; if done, it must follow the DSH Client Slot mechanism and the design must be separately confirmed.

---

## 6. Non-Functional Requirements

| # | Requirement | Acceptance criterion |
|---|------|----------|
| NFR-01 | Security | Do not execute arbitrary shell; file writes are limited to the project root; do not bypass DSH sandbox / approval; do not read credentials |
| NFR-02 | Auditable | State changes are persisted and diffable; the deviation log is append-only; logs contain no sensitive information |
| NFR-03 | Performance | `status` takes < 200ms on small-to-medium projects; guard checks are O(1) file existence/cache and do not block every tool call |
| NFR-04 | Compatibility | DSH >= 0.2.1-rc.2; Node >= 20; correct path handling on Windows / macOS / Linux |
| NFR-05 | Maintainable | TypeScript strict (if TS is used); unit tests for the core state machine/gates; validation scripts for skill templates |
| NFR-06 | Uninstallable | The project remains readable after the plugin is removed; no unparseable required files are left behind |
| NFR-07 | Diagnosable | On failure, state "which rule, which file, how to fix it"; do not just throw an exception |
| NFR-08 | Language | Chinese body + English kebab-case identifiers; stable command/skill names |

---

## 7. Data and File Contracts (Draft)

```text
Project root/
├── .specgate/
│   ├── config.yaml              # project config (shared by user/plugin; plugin treats it as read-only first)
│   ├── workflow-state.yaml      # current Change/paradigm/phase (written by plugin, read-only for user)
│   ├── gates/
│   │   ├── G1.confirmed         # gate marker (keeps the existing convention)
│   │   └── Gx.confirmed
│   ├── deviations.log           # deviation log (append-only)
│   ├── experiences/             # knowledge assets (four categories)
│   └── reviews/                 # review records (optional)
├── .dsh/
│   └── skills/
│       └── specgate/                # 30 skills (directory packages)
│           ├── sg-skill-entry-guard/SKILL.md
│           └── ...
├── openspec/
│   ├── changes/<change>/...
│   └── specs/...
├── AGENTS.md                    # user project rules (plugin only suggests appends, never overwrites)
└── docs/                        # optional template artifacts
```

**File ownership conventions (TBC)**:

| File | Owner | Plugin behavior |
|------|--------|----------|
| `.specgate/config.yaml` | User | Read-only; initialize when missing |
| `.specgate/workflow-state.yaml` | Plugin | Read/write; state is computed by tools |
| `.specgate/gates/*.confirmed` | Plugin | Create/read; do not delete arbitrarily |
| `.specgate/deviations.log` | User + plugin | Append-only; never rewrite |
| `.dsh/skills/specgate/**` | Generated by plugin, user-editable | Written on init; diff on upgrade; do not overwrite user modifications |
| `openspec/**` | User/model | Read-only status; do not directly rewrite content |
| `AGENTS.md` | User | Only suggest appending a section; never overwrite |

---

## 8. End-to-End Flow (Target Behavior)

```text
User input
  → entry-guard triage (Q&A / lightweight / heavyweight)
  → heavyweight: change-classification recommends L1/L2/L3
  → G1 requirement restatement + user confirmation (write G1.confirmed)
  → G2 paradigm confirmation (write paradigm)
  → proposal (G3) → design (G4) → specs (G5) → tasks (G6)
  → Brief / critical review (G6.5 / G7)
  → implementation (TDD guard)
  → G8 code review → G9 commit
  → G10 acceptance → G11 branch handling
  → archive
```

**Exception paths**:

- Writing `design.md` before passing G3: the guard rejects it and prompts "complete and confirm G3 first".
- The user asks to skip G4: `/specgate:deviation` + explicit user approval is required; otherwise the guard continues to reject.
- The user says "continue": only the current discussion continues; no Gate is crossed automatically.
- State files are corrupted: `doctor` reports it and gives repair suggestions; do not silently reset.

---

## 9. Acceptance Criteria (DoD)

| # | Acceptance item | Pass condition |
|---|--------|----------|
| AC-01 | Installation | `plugin_manager install_bundle` succeeds; the plugin is still present after restart; the corresponding line is visible in Inspect |
| AC-02 | Initialization | `/specgate:init` on an empty project generates the complete structure; repeated execution is idempotent; user modifications are not overwritten |
| AC-03 | Skills | All 30 Skills can be loaded by name with the `skill` tool; frontmatter and body verified item by item; content semantically consistent with the source templates |
| AC-04 | Hard gate blocking | Writing `design.md` before passing G3 is rejected; writing is allowed after passing; the rejection message includes the next step |
| AC-05 | Soft gate reminder | When a Gate has not been passed, the system prompt contains the current Gate and next step, without blocking ordinary Q&A |
| AC-06 | Status query | Construct 3 different Change states; `status` output is correct; `next` suggestions match the rule priority |
| AC-07 | Deviation log | Skipping a Gate must write `.specgate/deviations.log`; if not written, work continues to be rejected |
| AC-08 | Compatibility | Running on an existing `.specgate/` project does not damage files; `.qoder/` is not modified |
| AC-09 | Uninstall | The project remains readable after disable/uninstall; plugin-generated artifacts can be cleaned up as prompted |
| AC-10 | Regression | Existing repository tests still pass (if the CLI/templates are changed); the plugin's own tests pass |
| AC-11 | Documentation | README, installation, upgrade, rollback, and known limitations are complete |
| AC-12 | End-to-end demo | Complete a real small requirement in the DSH Web GUI covering all G1-G11 gates; demonstrate at least one hard block and one "release after recording a deviation" |

---

## 10. Pending Decisions (Blockers)

> Reply format: `confirm v1.0` (accept all recommended defaults), or item by item `Q1=B, Q3=C ...`, or point out entries that need changes.

### Q1 Delivery Form

- A. Only build a workspace bundle in this repository, and verify it in the current profile first.
- B. Directly build a standalone plugin package publishable to npm.
- C. **A first, then B**: verify the DSH API and gate experience first, then package it for publishing.
- Recommendation: **C**.
- **Selected: A (workspace bundle; do not publish an npm package yet)**, combined with Q9=B for project-level opt-in.
- Impact: package structure, versioning strategy, documentation, test scope.

### Q2 Migration Scope and Cadence

- A. One-time full migration (30 Skills + 9 Agent texts + 11 Gates + 9 Hook equivalents + OpenSpec commands).
- B. Minimum closed-loop MVP: entry-guard / change-classification / requirements-definition / TDD / code-review + G1, G2, G3, G7, G8, G9 + status/next + init.
- C. **Phased**: MVP → full Skill/Gate → Agent/UI.
- Recommendation: **C**.
- **Selected: A (one-time full migration)**. Implementation still proceeds in dependency order with stepwise commits, but acceptance covers the full set.
- Impact: initial schedule, acceptance scope, risk exposure.

### Q3 Gate Strength

- A. Fully hard-blocking: all Gates use guard deny.
- B. Fully soft reminders: only inject prompts, relying on model self-discipline.
- C. **Hybrid**: hard block on source code/Artifact writes; soft reminders for phase progression, review, and acceptance; provide "release after recording a deviation".
- Recommendation: **C**.
- **Selected: C (hybrid gates)**.
- Impact: developer experience, false-positive rate, implementation complexity.

### Q4 Skill Hosting Approach

- A. Materialize into the project's `.dsh/skills/specgate/`, versioned with the project, user-editable.
- B. Plugin runtime `skills.register`, not written to disk, effective immediately on upgrade, not user-editable.
- C. **Dual-track**: plugin built-in defaults; `init` materializes into the project; project files take precedence, plugin as fallback.
- Recommendation: **C**.
- **Selected: C (dual-track: built-in defaults + init materialization, project files take precedence)**.
- Impact: auditability, upgrade conflicts, offline availability.

### Q5 Agent Role Hosting

- A. Make the 9 roles into independent subagent prompt templates.
- B. Keep only 1 main Agent + Skills; roles become perspectives within a Skill.
- C. **B first, then A**: first verify whether the main Agent + Skills is sufficient, then decide whether to split subagents.
- Recommendation: **C**.
- **Selected: C (main Agent + Skills first; the 9 subagent templates are deferred to a later optional phase)**.
- Impact: complexity, context overhead, consistency with Qoder behavior.

### Q6 OpenSpec Dependency Strategy

- A. The plugin wraps the `openspec` CLI as a hard dependency.
- B. Only provide Skills and file conventions; the CLI is provided by the user/project.
- C. **B first, then A**: get the file conventions working first, then wrap the CLI as needed.
- Recommendation: **C**.
- Impact: installation barrier, network dependency, cross-platform compatibility.

### Q7 File Layout

- A. **Keep the existing `.specgate/` + `openspec/` layout entirely**.
- B. Switch to centralized management under `.dsh/specgate/`.
- C. New layout + compatible reading of the old layout.
- Recommendation: **A** (compatible with existing projects and documentation; lowest migration cost).
- Impact: compatibility, documentation, user migration.

### Q8 Web UI

- A. **Not done in the initial phase**; only Host capabilities and commands.
- B. Build a read-only status panel.
- C. Build an interactive gate panel.
- Recommendation: **A**; B/C become separate requirements.
- Impact: schedule, Client plugin complexity, acceptance approach.

### Q9 Installation and Activation Scope

- A. Install into the profile and activate globally, effective for all sessions.
- B. **Install into the profile, but activate per project opt-in** (detect `.specgate/config.yaml` or `/specgate:enable`).
- C. Build only a project-local plugin, without entering the profile.
- Recommendation: **B** (DSH bundles are profile-level installs; project-level opt-in avoids pollution).
- **Selected: B (install into the profile, activate per project opt-in)**.
- Impact: whether it interferes with non-SpecGate projects.

### Q10 Naming

- A. **Package name `dsh-plugin-specgate`; commands `/specgate:*`; Skills keep `specgate-*`**.
- B. Package name `@specgate/dsh`; commands `/sg-*`; Skills keep `specgate-*`.
- C. Other (please specify).
- Recommendation: **A**; if DSH command names do not support `:`, automatically fall back to the `-` form.
- Impact: user habits, documentation, command registration compatibility.

### Q11 Relationship with `templates/`

- A. Leave `templates/` untouched; only add a DSH plugin directory (content may be duplicated).
- B. Refactor `templates/` into a shared source for both platforms.
- C. **Keep `templates/` as the single source; copy and validate at plugin build time; do not hand-write both**.
- Recommendation: **C**.
- Impact: long-term drift risk, build complexity.

### Q12 Handling of the Current `pwsh` Anomaly

- A. Allow me to fix `pwsh` first or switch to another shell (requires your approval).
- B. **Do not rely on `pwsh` for verification**; use Node scripts / DSH tools / static checks for initial-phase verification.
- C. Do not verify for now; only do static checks.
- Recommendation: **B**; if tests/builds must be run later, handle that separately.
- Impact: verification approach, whether an end-to-end demo is possible.

### Q13 Dependency Strategy

- A. Allow installing npm dependencies (pinned versions), such as `yaml`, `zod`.
- B. **Zero runtime dependencies**; use only Node built-in modules; keep state files in JSON/plain text where possible.
- C. Introduce as needed, with the fewest dependencies.
- Recommendation: **C** (if YAML parsing is required, allow 1-2 pinned dependencies).
- Impact: install size, offline capability, parsing correctness.

### Q14 Rule Strength

- A. **Retain SpecGate's 1% rule, prohibited behaviors, and Git workflow rules** as prompt injection + skill self-discipline.
- B. Weaken them to suggestions; keep only the gates.
- C. Remove these rules and keep only the OpenSpec process.
- Recommendation: **A**, but inject by default only within SpecGate projects.
- Impact: context length, user acceptance, conflicts with DSH native rules.

### Q15 Acceptance Demo Method

- A. **Run a real small requirement in the current DSH Web GUI**, covering the critical path.
- B. Only run automated tests and static checks.
- C. A screen recording/document demo is sufficient.
- Recommendation: **A + B**.
- Impact: whether "demonstrably usable by users" can be proven.

### Q16 Skill Count Convention

- A. **Use the actual templates as the basis and standardize on 30**; the 4 `sg` entries remain in command form.
- B. Upgrade the 4 `sg` commands to Skills, making 34.
- C. Follow AGENTS.md's 33 convention and fill in the missing content.
- Recommendation: **A**.
- Impact: skill list, documentation, acceptance count.

---

## 11. Risks and Mitigations

| # | Risk | Impact | Mitigation |
|---|------|------|------|
| R1 | Hard gates harm normal development | Users bypass/disable the plugin | Hybrid strength; allowlist; one-command release via `/specgate:deviation`; hard-block only source code/artifacts by default |
| R2 | A global plugin pollutes all projects | Non-SpecGate projects receive prompts/interception | Project-level opt-in; detect `.specgate/`; `/specgate:disable` |
| R3 | DSH 0.2.1-rc API instability | Plugin breaks after an upgrade | Pin `engines.dsh`; adaptation layer; e2e regression |
| R4 | Skill content drifts from Qoder templates | Two inconsistent rule sets | Single source `templates/` + build-time sync + validation scripts |
| R5 | `openspec` CLI dependency/network | Installation failure or process interruption | File conventions first; CLI optional; graceful degradation on failure |
| R6 | State file concurrency/multiple sessions | State overwrite/conflict | Single session first; file locks or session-scoped; `doctor` detection |
| R7 | Command name `:` unsupported by DSH | Command registration fails | Verify first; fall back to `-`; sync documentation |
| R8 | Confusing skill count conventions | Inconsistent acceptance criteria | Unify the convention per Q16; use actual files as the basis |
| R9 | Current `pwsh` unavailable | Cannot run builds/tests/demos | Q12; switch to Node/DSH tools; repair the environment if necessary |
| R10 | User customizations overwritten by upgrades | Loss of trust | Diff preview on init/upgrade; do not overwrite user modifications; backups |

---

## 12. Delivery Phases and Gates

> The scope is set to full per Q2=A; "phase" only indicates the dependency order of implementation and verification, without reducing the acceptance scope.

| Phase | Content | Exit condition |
|------|------|----------|
| Phase 0 | Final confirmation of this document | User replies confirming; freeze v1.0 |
| Phase 1 | Technical validation spike (no product code): validate skill registration, command registration, guard, `userQuestions.ask`, project opt-in | Produce a feasibility conclusion; proceed to Phase 2 only after user confirmation |
| Phase 2 | Full implementation: initialization + 30 Skill + G1-G11 + L1-L3 + OpenSpec + status/next + deviations + TDD/review/vertical slicing + knowledge-capture directories | Pass AC-01 ~ AC-11 |
| Phase 3 | Full acceptance and end-to-end demo | Pass AC-12 |
| Phase 4 | Optional enhancements: 9 independent subagents / dedicated knowledge-capture tools / Web UI / CLI wrapper | Separate requirement confirmation |

> User confirmation is required before each phase starts; do not jump directly from Phase 0 to Phase 2.

---

## 13. Change Control

1. This document v1.0 is frozen; subsequent changes must append a "Change Log".
2. Any added/removed/downgraded requirement must append a "Change Log" at the end of this file, stating the change item, reason, impact, and confirmation time.
3. Unconfirmed changes are not implemented by default.
4. If, during implementation, the DSH API is found to contradict the assumptions in this document, stop and report back first; do not change requirements on your own.

---

## 14. Confirmation

2026-10-18: The user replied **"confirm v1.0"**, accepting the first round of 5 decisions (Q1=A, Q2=A, Q3=C, Q4=C, Q5=C, Q9=B) and the recommended defaults for Q6-Q16. This document is frozen as **v1.0** and serves as the single requirements baseline for design, implementation, and acceptance.

Subsequent changes may only be appended through the "Change Log" at the end of the document and must be confirmed again.

**After the baseline is frozen, the following still apply:**

- Phase progression follows Section 12; confirm with the user before each phase starts.
- If the DSH API is found to contradict the assumptions in this document, stop and report back first; do not change requirements on your own.
- Do not interpret "the user said continue" as "skip the gate".

---

## Appendix A: Basis and Sources

- Repository facts: `AGENTS.md`, `README.md`, `package.json`, `templates/qoder/**`, `templates/workflow/workflow-rules.yaml`, `src/core/flows/index.ts`
- DSH capabilities: `cordis_inspect_query` (Host `Service`, Host `Event`, `Tool.listTools`, `Config.listConfigs`)
- DSH skill mechanism: `@deepseek-ai/dsh-skill` README, `@deepseek-ai/dsh-skill-filesystem` README
- DSH plugin mechanism: `cordis-plugin-development`, `cordis-composition-reference`, `references/host-plugin.md`
- Current environment: the DSH version in `package.json`; the exit codes of the two `pwsh` failures

## Appendix B: Terminology

| Term | Meaning |
|------|------|
| SpecGate | AgentKit47, the AI engineering scaffold provided by this repository |
| DSH | DeepSeek Harness, the currently running Host/Client runtime |
| Bundle | DSH's plugin installation unit, which inserts a plugin line via `dsh.bundle.patch` |
| Skill | A task-instruction package that can be loaded on demand; DSH loads it with the `skill` tool |
| Gate | A human confirmation breakpoint, G1-G11 |
| Artifact | OpenSpec artifact: proposal / design / specs / tasks |
| Change | A change under `openspec/changes/<name>/` |
| Deviation | The act of skipping a gate or process rule; must be recorded in `.specgate/deviations.log` |
| L1/L2/L3 | Change paradigms: requirements-driven / technical implementation / defect fix |

---

# Change Log v1.1: Built-in Plugin Initialization and Switches (Confirmed)

> Status: **v1.1 confirmed (2026-10-18)**
> Baseline: v1.0 (confirmed, 2026-10-18)
> This record only describes deltas; unmentioned v1.0 clauses remain in effect.

## C1. Background

The current v0.1.0 already has the `sg_init` tool and the `/sg-init` command and **does not depend on an external `specgate` CLI**; however, the initialization experience is still incomplete:

- It can only initialize the current directory, not create a new project directory;
- `AGENTS.md` only gets a condensed section appended, not the full workflow rules;
- There is no `--minimal` lightweight mode;
- Initialization does not create a Git repository by default, and there is no commit discipline;
- `sg_status` in an uninitialized project does not clearly prompt "initialize first".

User goal: **the plugin completes initialization itself**, generating a project that can directly enter the workflow (`openspec/` + `AGENTS.md` + skills/roles/templates/examples), without needing to run `specgate init` first.

## C2. Decisions Confirmed in This Round

| Decision item | Choice |
|--------|------|
| Actual phenomenon | No error occurred; the user simply wants the plugin to complete initialization itself |
| Initialization location | Current directory + optional new directory |
| Trigger method | Explicit command + enable/disable switch |
| AGENTS.md | Full workflow; back up an existing file before merging |
| Initialization artifacts | Configurable: full templates by default, `--minimal` supported |
| Git initialization | `git init` by default; initial commit |
| Commit discipline | Gate-level enforced clean; `sg_commit` assist |
| Document version | v1.1 incremental change log |

## C3. Added/Modified Requirements

### C3.1 FR-02 Rewritten: Built-in Plugin Initialization

- **FR-02.1 Entry points**
  - Tool: `sg_init`, with parameters `path?`, `minimal?`, `force?`, `git?` (default true), `example?`, `docs?`, `disabled?`.
  - Command: `/sg-init`; DSH command names only allow lowercase letters, digits, `_`, and `-`, and a `/specgate:init` alias is **not registered**. Parameters `[--path <dir>] [--minimal] [--force] [--no-git] [--no-example] [--no-docs] [--disabled]`.
  - The initialization logic is entirely inside the plugin; **do not call an external `specgate` CLI**. Git operations are executed via the `git` command, enabled by default and disabled with `--no-git`.
- **FR-02.2 Current directory (default)**
  - Initialize the full templates in the current session cwd (see C3.2).
  - If the current directory has no `.git`, run `git init` by default; skip it with `--no-git`.
- **FR-02.3 New directory (`--path <dir>`)**
  - Relative paths are based on the current session cwd; absolute paths are also accepted.
  - Directory does not exist: create it, then initialize.
  - Directory exists and is empty: initialize directly.
  - Directory exists and is non-empty: reject by default and suggest `--force`; `--force` only merges, never deletes.
  - Reject the filesystem root directory; reject using the parent of the current directory as the target (to prevent accidentally initializing the entire workspace).
  - Run `git init` in the new directory by default; skip it with `--no-git`.
- **FR-02.4 `--minimal`**
  - Generate: `.specgate/config.yaml`, `gates/`, `deviations.log`, `workflow-state.yaml`, `experiences/index.md` + `trigger-guide.md` + the four category directories, `.dsh/skills/specgate/` 30 skills, `openspec/changes|specs|archive`, and a condensed SpecGate section in `AGENTS.md`.
  - Do not generate: the 9 Agents, `.specgate/templates`, `.specgate/rules`, `.specgate/briefs`, `.specgate/out-of-scope`, `docs/` templates, or an example Change.
- **FR-02.5 Full templates by default**
  - On top of minimal, add: the 9 Agents, templates, rules, briefs, out-of-scope, full knowledge assets, the complete `AGENTS.md`, `docs/` templates, and an example Change.
  - `--no-example` / `example:false` skips the example.
  - `--no-docs` / `docs:false` skips the `docs/` templates.
- **FR-02.6 Idempotency and merging**
  - Existing files are skipped by default.
  - `--force` only allows regenerating plugin assets; it does not delete user files.
  - The `AGENTS.md` merge rules are in C3.3.
- **FR-02.7 Initialization report**
  - Output created / skipped / backed-up / merged / failed counts; failures must not be silent.

### C3.2 Full Template Artifacts

| Artifact | Full by default | `--minimal` |
|------|:---:|:---:|
| `.specgate/config.yaml`, gates, deviations, workflow-state | Yes | Yes |
| `.dsh/skills/specgate/` 30 skills | Yes | Yes |
| `.specgate/agents/` 9 Agents | Yes | No |
| `.specgate/templates`, `rules`, `briefs`, `out-of-scope` | Yes | No |
| `.specgate/experiences/index.md` + `trigger-guide.md` + four category directories | Yes | Yes |
| `openspec/changes/`, `openspec/specs/`, `openspec/changes/archive/` | Yes | Yes |
| Git repository + initial commit | Yes; can be disabled with `--no-git` | Yes; can be disabled with `--no-git` |
| Complete `AGENTS.md` | Yes | Condensed section |
| `docs/prd/vision.md`, `docs/architecture/01-system-overview.md`, `CONTEXT.md` | Yes | No |
| Example Change | Yes | No |

- **Example Change location**: `docs/specgate/examples/example-change/`, **not placed under `openspec/changes/`**, to avoid being treated as an active Change by the state machine.
- The example contains minimal readable samples of proposal / design / tasks / specs, with a header marking it "example, not part of gates".
- `docs/` templates are created only when the file is missing and never overwrite user content.

### C3.3 Complete `AGENTS.md` and Merging

Add `assets/AGENTS.full.md` (DSH-adapted version), containing:

- Workflow overview and the G1-G11 gates;
- L1/L2/L3 paradigms and gate strengths;
- Navigation for the 30 Skills;
- The 9 Agent roles;
- The 1% rule and prohibited behaviors;
- Git workflow;
- Knowledge capture;
- Command/tool quick reference;
- Project file layout.

Generation and merging rules:

1. **No `AGENTS.md`**: write the complete file.
2. **`AGENTS.md` exists without SpecGate markers**: first back it up to `.specgate/backups/AGENTS.md.<ISO timestamp>`, then append the complete SpecGate section at the end of the file (wrapped in `<!-- specgate:begin -->` / `<!-- specgate:end -->`); user content is preserved.
3. **`AGENTS.md` exists with SpecGate markers**: back it up first, then replace the content between the markers with the latest complete section; user content is preserved and the section is not duplicated.
4. **Backup failure**: abort the `AGENTS.md` write (fail closed); the rest of initialization may continue but must report the failed item.
5. `--minimal`: only append/replace the condensed section (current behavior); do not write the full rules.

### C3.4 Switches

- `enabled` in `.specgate/config.yaml` is the single source of truth.
- `/sg-enable` / `sg_enable`: `enabled: true`; if not initialized, perform full initialization first.
- `/sg-disable` / `sg_disable`: `enabled: false`; do not delete files.
- Initialization defaults to `enabled: true`; `--disabled` turns it off immediately after initialization.
- The switch only affects whether the guard intercepts and whether the system prompt is injected; it does not affect existing files or skill directories.
- `sg_status` must display the switch state and the reason.

### C3.5 Uninitialized Project Hints

- `sg_status` / `sg_next` / system prompt:
  - The project root has no `.specgate/` and no `.dsh/skills/specgate`: prompt "Project not initialized; run `/sg-init` or call `sg_init` to generate `.specgate/`, `openspec/`, and `AGENTS.md`".
  - `.specgate/` exists but `enabled:false`: prompt "Initialized but disabled; run `/sg-enable`".
- Do not initialize automatically (this round chose an explicit command).

### C3.6 External Command Boundaries

- The initialization path must not call external commands such as `specgate` or `openspec`.
- Git is a default dependency: run `git init` and the initial commit by default; `--no-git` disables this.
- During acceptance, initialization must still work after removing `specgate` / `openspec` from PATH; Git must be available (unless `--no-git`).
- Use only parameterized `git` invocations (`execFile` / `spawn` argument arrays); do not concatenate shell strings.

### C3.7 Git Initialization and Commit Discipline (Gate-Level Enforced Clean)

#### Initialization

- `git init` by default; disabled by `--no-git`.
- If the directory already has `.git`, do not run init again.
- After initialization completes, create the first commit:
  - Working tree clean: `git add -A` + `git commit -m "chore(specgate): initialize workflow project"`.
  - Working tree dirty (uncommitted changes already exist): **do not commit automatically**; report `git: skipped (working tree dirty)` and prompt to commit first.
  - No Git user identity: the commit fails; report repair suggestions for `git config user.name` / `user.email`; do not fabricate an identity.
- `--no-git`: no init, no commit; `sg_status` / `sg_doctor` mark "Git not enabled, commit discipline not in effect".

#### Gate Confirmation

- Before `sg_gate confirm` and `waive` execute, check:
  1. The project is a Git repository (`.git` exists);
  2. The working tree is clean (`git status --porcelain` is empty).
- If either fails: reject the confirmation/skip, return a clear reason and next step; **do not write the Gate marker**.
- If the project was initialized with `--no-git`: skip the Git check, but return the warning "commit discipline not in effect".
- Note: confirming a Gate writes `.specgate/gates/<Gx>.confirmed`, and that marker is itself a change; it must be committed before the next Gate, so **every Gate produces at least one commit**.

#### `sg_commit` Tool

- Parameters: `message` (required), `all?` (default true), `paths?`.
- Behavior:
  - Verify it is inside a Git repository;
  - `git add -A` or the specified paths;
  - `git commit -m <message>`;
  - Return the short hash, commit title, and number of changed files.
- If there are no changes, return "no changes to commit" and do not create an empty commit.
- Do not set a git identity automatically; do not add `--no-verify`.

#### Status and Health Check

- `sg_status` displays: whether it is a Git repository, current branch, number of dirty files, and the latest commit.
- `sg_doctor` checks: Git repository exists, working tree is clean, latest commit; dirty is a warning, and Git not enabled is an error (unless `--no-git` is recorded).

## C4. Impact Analysis

| v1.0 item | Impact |
|-----------|------|
| FR-01 Installation and enabling | Add `--disabled`; enable/disable semantics unchanged |
| FR-02 Project initialization | Rewritten as built-in initialization + new directory creation + full templates |
| FR-03 Skill hosting | Unchanged; `--minimal` still materializes 30 skills |
| FR-04 Commands | `/sg-init` parameters extended; enable/disable already exist |
| FR-05 Gates | Add a Gate prerequisite Git clean check; the switch controls the guard |
| FR-06 Status | Add uninitialized/disabled hints and Git branch/dirty/latest commit |
| FR-09 Knowledge capture | The full templates by default include index/trigger-guide |
| New tool | `sg_commit` |
| Acceptance criteria | Add AC-13 ~ AC-25 |
| Non-goals | Do not initialize automatically; do not build 9 independent subagents; do not rewrite the CLI; do not commit automatically except for the initial commit at initialization |

## C5. Added Acceptance Criteria

| # | Acceptance item | Pass condition |
|---|--------|----------|
| AC-13 | Full initialization of an empty directory | Without the `specgate` CLI, `/sg-init` generates `.specgate/`, `openspec/`, the complete `AGENTS.md`, 30 Skills, 9 Agents, docs, and the example |
| AC-14 | `--minimal` | Generates only the skeleton, 30 Skills, `openspec/`, and a condensed AGENTS.md; no agents/templates/docs/example |
| AC-15 | New directory | `--path new-dir` creates and initializes it; `.git` is generated by default and not generated with `--no-git`; a non-empty directory is rejected without `--force` |
| AC-16 | AGENTS.md merging | An existing file is backed up; user content is preserved; the SpecGate section appears only once; repeated init does not duplicate it |
| AC-17 | Idempotency | Repeated init does not overwrite user modifications; skipped items are reported |
| AC-18 | Switches | `--disabled` results in `enabled:false`; `/sg-enable` restores it; `/sg-disable` turns it off |
| AC-19 | Uninitialized hint | `sg_status` clearly prompts `/sg-init` and does not modify files automatically |
| AC-20 | No `specgate` CLI dependency | The initialization path makes no `specgate`/`openspec` calls; Git is available by default |
| AC-21 | Initial commit | After initializing a new directory, `git log` has at least 1 commit; the working tree is clean |
| AC-22 | Gate clean | Clean passes before G1 confirmation; the marker makes it dirty after confirmation; G2 confirmation is rejected; G2 passes after `sg_commit` |
| AC-23 | Git status display | `sg_status` / `sg_doctor` display the branch, number of dirty files, and latest commit |
| AC-24 | `--no-git` | No `.git` is generated; Gate confirmation skips the Git check and warns "commit discipline not in effect" |
| AC-25 | Existing repository | An initial commit is created when `.git` already exists and the tree is clean; when dirty, it is skipped and reported, without pulling in unrelated changes |

## C6. Implementation Plan (After Confirmation)

1. Add `assets/AGENTS.full.md` (DSH-adapted version).
2. Add `src/git.js`: `isRepo`, `status`, `init`, `addAndCommit`, `lastCommit`; all calls parameterized, no shell string concatenation.
3. Extend the `initProject` options and return value: `{ path, minimal, force, git, example, docs, disabled }`; `git init` + initial commit by default.
4. Implement new directory creation, non-empty directory protection, and AGENTS.md backup/merging.
5. Extend the `sg_init` tool schema and `/sg-init` command parsing; add the `sg_commit` tool and `/sg-commit` command.
6. Add a Git clean prerequisite check to `sg_gate confirm` / `waive`; skip with a warning for `--no-git` projects.
7. Update the uninitialized, disabled, and Git status hints in `status` / prompt.
8. Add tests for AC-13 ~ AC-25 (Git tests use temporary repositories and local user.name/email).
9. Update README, architecture documentation, and acceptance records.
10. Reinstall/reload the plugin and perform end-to-end verification in a temporary directory.
11. After committing, ask you for acceptance; commit each implementation step separately.

## C7. Final Defaults (Including This Round's Git Additions)

| Item | Default |
|----|------|
| `git init` | **Enabled by default**; disabled with `--no-git` |
| Initial commit | Committed automatically after initialization completes; message `chore(specgate): initialize workflow project` |
| Existing repository | Do not re-init if `.git` exists; create the initial commit automatically only when the working tree is clean, skip and report when dirty |
| Subsequent commit discipline | **Gate-level enforced clean**: the working tree must be clean before `sg_gate confirm` / `waive`, otherwise it is rejected |
| Commit helper | `sg_commit` tool / `/sg-commit` command; `git add -A` by default, paths can be specified |
| Non-empty directory | Rejected by default; `--force` enables merging without deletion |
| Example Change location | `docs/specgate/examples/example-change/`, not under `openspec/changes/` |
| docs templates | Generate `docs/prd/vision.md`, `docs/architecture/01-system-overview.md`, `CONTEXT.md` by default (only when missing) |
| Backup location | `.specgate/backups/AGENTS.md.<ISO timestamp>` |
| Initialization default switch | `enabled: true`; `--disabled` can turn it off |
| Command name | `/sg-init`; DSH syntax does not accept a colon alias; tool `sg_init` |
| Version | v1.1 |

## C8. Confirmation

2026-10-18: The user confirmed **v1.1**, including default `git init`, the initial commit, gate-level enforced clean, and the C7 defaults. This document is frozen as v1.1 and implementation begins.

- Commit each step separately during implementation.
- `Confirm v1.1`: confirmed.
- `Modify: ...`: subsequent changes still follow the change-log process.

## C9. DSH Output and Session Adaptation Revision (2026-10-18)

- **Command names**: DSH command syntax is `^[a-z0-9][a-z0-9_-]*$`, so colon aliases can never be registered; remove aliases such as `/specgate:init` and use `/sg-init` consistently in the documentation.
- **Command output**: When a command finishes, the plugin hands the full output back through `agent.followup` (message `role=user`, `source.kind=specgate`, `source.command=<command>`) so the agent presents it in the conversation and asks for the next step, keeping command and skill output inside the chat; only when the runtime has no `followup` or the hand-off is rejected does it degrade to appending one `user/message` (`form=notice`) context message (see C16).
- **Do not synthesize assistant messages**: Never inject `assistant/message` into the session log. Inserting any message between a tool call and a tool result causes a 400 error where `tool_use` has no immediately adjacent `tool_result`.
- **Command-channel gates**: `/sg-gate <Gx> confirm` without `--yes` only returns a pending-confirmation hint; only `--yes` writes the marker. Structured Q&A is reserved for the `sg_gate` tool (executed within a model turn).
- **Service load order**: `commands`, `skills`, and `systemPrompt` are optional services; use `ctx.inject` to wait until ready, to avoid silently dropping registrations when the plugin loads first.
- **Test baseline**: `node --test` → 58 passed / 0 failed.

## C10. v1.2 Idempotency Protection (2026-10-18, Confirmed)

### C10.1 Scope

| Modifying type (idempotency required) | Read-only type (no record, no lock) |
|---|---|
| `init`, `enable`, `disable`, `commit`, `gate confirm/waive`, `deviation`, `classify --apply`, `sg-propose`, `sg-archive` | `status`, `next`, `doctor`, `classify` (without `--apply`), `gate status`, `sg-apply` (without name), `sg-explore` |

Commands and their corresponding tools both apply; read-only types do not create `.specgate/state/`.

### C10.2 Semantics

- **State idempotency takes precedence**: check the target state first; if already achieved, return "idempotent skip" without rewriting files.
- **Deduplicate append-type operations**: operation key = `sha256(projectRoot + command + normalizedArgs + target)`; `.specgate/state/idempotency.json` records for 24h; `deviation` writes an `opId` into the log; `--force` is available only for append-type operations.
- **Failures are not recorded**: a failure only releases the lock; after fixing, retry is allowed.
- **Concurrency lock**: system temp directory `.specgate-locks/<key>.lock`, created atomically with `wx`; stale after 10 minutes; when the same operation runs concurrently, only one executes.
- **State file**: `.specgate/state/idempotency.json`, automatically added to `.gitignore`, so it does not pollute the gate clean check.
- **Per-command behavior**: init checks the full structure/30 Skills/9 Agents/Git; enable/disable checks enabled; commit is a no-op when there are no changes; gate checks the marker; classify apply checks the paradigm; propose checks change/proposal; archive checks the archive directory.

## C11. v1.2 Multi-Agent Parallelism (2026-10-18, Confirmed)

### C11.1 Scope

- `/sg-apply <change>`: performs implementation by default; `--plan` only shows the plan.
- `/sg-doctor`: four-dimension parallel health check (structure/Git, gates/Artifacts, deviations/idempotency, Skill/Agent).

### C11.2 Task Graph

- Parse `[P]` and `depends: T1,T2` in `tasks.md`; `role:` can specify one of the 9 roles, defaulting to `developer`.
- Without `[P]`/`depends`, tasks are serial by default; report an error on dependency cycles or missing dependencies.
- Execute in waves, with `maxConcurrency=4` by default, adjustable via `dispatch.maxConcurrency` in `.specgate/config.yaml`.

### C11.3 Worktree and Merging

- For each task: `git worktree add .specgate/worktrees/<change>/<task> -b specgate/<change>/<task> HEAD`.
- Merge sequentially after each wave completes; on conflict, stop immediately and keep all worktrees/branches, returning the conflicting files.
- Non-Git or dirty working tree: degrade to a serial single writer and report the reason.
- On success, remove the worktree but keep the branch; on failure/conflict, keep the worktree.

### C11.4 Failures and Idempotency

- Collect all task results; do not cancel other tasks because a single task failed.
- After a task succeeds, automatically check it off in `tasks.md` and commit; on rerun, already checked tasks are skipped directly. `.specgate/state/dispatch.json` retains contentHash + commit audit records.
- Concurrency on the same task is prevented by a task lock/branch reuse.

## C12. v1.2 Skill and MCP

- Fix the missing `source` in `skills.register`: all 30 Skills can be loaded via the `skill` tool; add a `source` regression test.
- Unify DSH paths/tool names in Skill documentation (`.dsh/skills/specgate/`, `grep`, `todo_write`, `read/write/edit`).
- MCP: the plugin does not register an MCP server/MCP tools; nothing new is added this time, and it is only recorded that "MCP is managed independently by DSH".

## C13. v1.2 Acceptance Criteria

| ID | Acceptance item |
|---|---|
| AC-26 | Running a modifying command twice in a row produces only one side effect |
| AC-27 | Only one instance of the same operation executes concurrently |
| AC-28 | A failure does not write a success record, and retry is possible |
| AC-29 | Repeated deviations within 24h are not written again; `--force` allows repetition |
| AC-30 | Read-only commands do not create state files/locks |
| AC-31 | `/sg-apply` runs in waves according to `[P]/depends`, with at most 4 worktrees in parallel |
| AC-32 | Merge conflicts stop and preserve worktrees/branches |
| AC-33 | Non-Git projects degrade to a serial single writer |
| AC-34 | tasks.md without markers defaults to serial |
| AC-35 | Repeated `/sg-apply` skips completed tasks |
| AC-36 | All 30 Skills can be loaded |
| AC-37 | `/sg-doctor` runs four dimensions in parallel and summarizes |
| AC-38 | No new MCP server/MCP tools are added |

## C14. v1.2 Test Baseline

`node --test` → **74 passed / 0 failed**. New coverage: idempotency records/force/concurrency lock, task graph parsing and waves, worktree parallelism/conflicts/non-Git degradation, doctor parallel summary, Skill `source` validation.

## C15. v1.0.0 Public Rename and Release (2026-10-18, confirmed)

### C15.1 Naming

- Product/plugin: **SpecGate**; npm package `dsh-plugin-specgate`; repository `https://github.com/GM-Studio/dsh_sg_plugin`.
- Command/tool prefix: `sg-` / `sg_`; project data directory `.specgate/`; project skills `.dsh/skills/specgate/`; skills `sg-skill-*`; agents `sg-agent-*`.
- All old `/ak47-*`, `ak47_*`, `.ak47/`, `opsx-*` user-facing identifiers are removed. Only README/LICENSE retain a short "derived from AgentKit47-Qoder" attribution.
- Worktree branches use `specgate/<change>/<task>`; commit prefixes use `specgate(...)`.

### C15.2 Migration

- `/sg-migrate` and `sg_migrate` migrate `.ak47/` to `.specgate/`.
- Default behavior backs up the old directory as `.ak47.backup-<timestamp>`, copies state/config/gates/deviations, rewrites managed references, and writes a migration report.
- `--dry-run` previews without writes; `--force` handles an existing `.specgate/` by backing it up first.
- Existing `ak47/*` worktrees/branches are reported, not moved automatically.

### C15.3 Configuration and lifecycle

- Global profile plugin config supplies new-project defaults: `defaultEnabled`, `enforcement`, `maxConcurrency`, `git`, `language`, `materializeSkills`, `materializeAgents`.
- Project `.specgate/config.yaml` overrides global defaults. Existing project configs are never rewritten by global defaults.
- Global start/stop is the DSH plugin manager bundle switch; project start/stop is `/sg-enable` / `/sg-disable`. No background daemon.

### C15.4 Bilingual

- Chinese is authoritative; English is a complete sibling translation.
- Layout: English `README.md`, `SKILL.md`, `agent.md`, templates and docs; Chinese `*.zh.md` siblings.
- `language: zh|en` selects runtime Skill/Agent/docs content and command/report language; default `zh`.
- Changing an existing project's language requires `/sg-init --force` to re-materialize assets.

### C15.5 Distribution

- npm public package, MIT, author `andy.zx`.
- GitHub Actions: CI on push/PR; tag-based release with `npm publish --access public --provenance` using the `NPM_TOKEN` secret.
- Install: `plugin_manager install_bundle target=dsh-plugin-specgate`.
- No MCP server or MCP tools are added.

### C15.6 Test Baseline

`node --test` → **89 passed / 0 failed**. New coverage: migration dry-run/force/backup, config precedence, language variant selection, bilingual manifest parity, 30 Skill + 9 Agent identifier parity.

## C16. Command Results Return to the Conversation (2026-10-18, this revision)

- **Motivation**: `/sg-*` and Skill output previously appeared only in the DSH command card or a collapsed `notice` chip, so users could not read the full content or continue interacting from it.
- **Behavior**: After any `/sg-*` command finishes, when the agent is idle and the runtime exposes `agent.followup`, the plugin hands back the complete `result.text` together with an instruction to present it in full and ask for the next step; the agent's reply becomes a normal conversation message the user can answer.
- **Boundaries**: Never hand back while `agent.status === 'running'` (protects `tool_use`/`tool_result` pairing); when the runtime has no `followup` or the hand-off throws, it degrades to a `notice` (`form=notice`, fresh sessions only); `appendCommandNotice` stays exported as the fallback and test seam.
- **No synthesized assistant messages**: `assistant/message` is still never injected; the hand-off uses the `followup` input channel, so the C9 constraint holds.
- **Cost**: One extra model turn per command — the explicit price of full in-conversation interaction.
- **Test baseline**: `node --test` → **90 passed / 0 failed**; `test/commands-report.test.js` covers the hand-off, hand-off in active sessions, the running-agent skip, fallback when the hand-off is rejected, and failed commands.
