# Changelog

## 4.2.0

- **Single repository by default**: `sg_init` now creates one git repository that tracks `api/`, `web/`, `contracts/` and `.specgate/`; no `.gitmodules` and no gitlinks. `flattenToSingleRepo` removes per-side `.git` directories and commits both workspaces to the root repository.
- **Explicit topology**: `sg_init({ topology: "single" | "submodule" })`, default `single`; `workspace.yaml` records the chosen topology.
- **Java 8 by default**: the Java wizard/catalog default is JDK 8 + Spring Boot 2.7.18 + Maven; JDK 17/21 + Boot 3.x remain selectable.
- **Fast JDK discovery**: checks `SG_JAVA_HOME`, project toolchains, `JAVA_HOME`/`JDK_HOME`, `PATH`, and common vendor directories; probes at most 24 candidates with 3s timeouts and stops at the first valid JDK 8.
- **JDK 8 download fallback**: when no JDK 8 is found, downloads Temurin 8 (zip on Windows, tar.gz on Unix) with retries and a `curl.exe` fallback, flattens the archive and verifies `java -version`.
- **Root orchestration**: generates `README.md`, `package.json`, `scripts/dev.mjs`, `scripts/verify.mjs`, `scripts/mvn.mjs`, `.env.example` and a root `.gitignore`.
- **Front-end/back-end wiring**: Vite `server.proxy`/`preview.proxy` forward `/api` to `127.0.0.1:8080`, ports are strict, `index.html` is a complete document, and the front-end defaults to `real` (mock only under Vitest).
- **Quality fixes**: JDK 8 uses Spotless 2.30.0; Maven uses `.specgate/m2repo`; project-local toolchains are discovered by the generated `mvnw`; archive extraction supplies a complete Windows environment.
- **Verification**: a clean init (no JDK/Maven on the host) downloaded JDK 8 and Maven, passed both quality stages, and the generated repository passed `npm run dev` and `npm run verify` (back-end tests, front-end build/test, proxy and CRUD smoke).

## 4.1.0

- **v4 init stack wizard**: after topology, asks Java JDK/build tool/Boot, Python version/framework/packaging, Node version/package manager/language/framework, and frontend language; options are conditional and compatibility-validated.
- **No four-dimension requirement interview in v4 init**: functional/non-functional/constraints/acceptance questions are removed; the final approval page now compactly confirms language, runtime, stack, build tool, and required/optional dependencies/plugins, capped at 20 lines or 1200 characters.
- **Versioned dependency catalog**: required and optional dependencies with minimal/recommended/full/custom presets, mutual-exclusion groups, and selected ids written to workspace.yaml, manifests, and reports.
- **One consolidated approval gate**: lists per-side packages and commands; approve installs and runs format/lint/test/review; skip still generates full manifests/config/code and marks quality skipped.
- **Degraded failure**: an approved install/quality failure stops that side's remaining stages, continues the other side, commits code with a [degraded] marker, and returns init success with degraded=true.
- **Framework templates**: FastAPI/Flask/Django (including Python 2.7 legacy Flask/Django), Express/Fastify/NestJS (TypeScript/JavaScript), Vue/React manifests with selected deps; Java optional deps and jakarta.validation for Boot 3/4.
- **Reports**: side and root .specgate/init-report.json, docs/mvp-scaffold-report.md, and docs/review-report.md.
- **Environment preflight and toolchain reuse**: after stack selection, scan DSH runtimes, PATH, config files, registries, and elevation; reuse DSH node/pnpm/python first, then project toolchains, then system tools.
- **Domestic mirrors by default**: npm/pnpm use npmmirror, PyPI uses Tsinghua/Aliyun, Maven uses Aliyun, Gradle distributions use Tencent, and JDK 11/13/17/21 use Huawei OpenJDK. Editable config files live in .specgate/mirrors.
- **Project-local provisioning**: missing Maven/Gradle/JDK/uv are downloaded or pip-installed into .specgate/toolchains; pnpm allowBuilds fixes the pnpm 11/12 ERR_PNPM_IGNORED_BUILDS false failure.
- **Tests**: 347 tests, 343 pass / 0 fail / 4 skipped.

## 3.10.0

- **init now generates the Item CRUD code and tests**: for new java / node / python projects, mvp-scaffold no longer stops at the change package; it writes the Item model, in-memory store, five CRUD endpoints, and full tests.
- **Automatic quality pipeline**: formatting (Java Spotless apply, configured Node scripts), static checks (Java Checkstyle), full tests, then a read-only reviewer subagent.
- **Success archives the change**: tasks checked, spec delta applied to openspec/specs/mvp/spec.md, mvp-scaffold moved to openspec/changes/archive/, and the project returns to IDLE ready for a business change.
- **Failure aborts**: any formatting/static/test/review failure stops at H1_PENDING, keeps the code and docs/mvp-scaffold-report.md, and does not archive.
- **No subagents: skip auto-build**: stays at H1_PENDING for /sg-run, avoiding a silent review bypass.
- **Tests**: added test/v3/s40.bootstrap.test.js; full suite is 301 tests, 297 pass / 0 fail / 4 skipped.

## 3.9.0

- **The first change of a new project is now `mvp-scaffold`** (java / node / python): its proposal is titled "MVP框架搭建" and ships the specs/design/tasks/cases/mapping/touched for a generic Item CRUD example.
- **Framework requirement injected into the baseline**: a new backend project starts with `REQ-001 MVP framework and Item CRUD example (framework baseline)`; business requirements shift to `REQ-002+`. `mvp-scaffold` references `REQ-001`.
- **init does not generate CRUD code**: it only creates the change package; `/sg-run` executes T-001..T-003 to generate the Item model/store/endpoints and tests.
- **CRUD contract**: GET/POST/PUT/DELETE `/api/items` (plus `/api/items/{id}`), in-memory storage, 201/204/400/404 covered; 10 ACs and 10 cases.
- **Stack scope**: java / node / python; vue / react / monorepo / generic keep `add-version` and do not receive the framework requirement.
- **Existing projects unchanged**: no migration, no rewrite; new projects only.
- **Tests**: added `test/v3/s39.mvp-scaffold.test.js`; full suite is 296 tests, 292 pass / 0 fail / 4 skipped.

## 3.8.0

- **Three `/sg-init` entries**: `-req <document>` import, free-form description, and no-argument dialogue. The command and the `sg_init` tool accept `req` / `description` / `draft`.
- **Lenient parsing with a minimum bar**: Markdown/UTF-8 (BOM/CRLF allowed, ≤1 MiB); the file must be readable, non-empty, and contain at least one functional requirement. Missing non-functional/constraint dimensions return `CLARIFY` for agent-led follow-up; only an explicit `confirmedEmpty` leaves them blank.
- **Zero writes before confirmation**: removed `autoConfirmed` and the ask-failure fallback to defaults. `CLARIFY`, cancel, an unavailable question channel, or a validation failure create or modify nothing and return an `E_*` code.
- **Active requirement dialog**: when a `userQuestions` channel exists, `-req` with missing dimensions, a free-form description, and the no-argument entry all open dimension-by-dimension dialogs (functional → non-functional → constraints → acceptance) with custom input; only when no channel exists does it return `CLARIFY` for the agent.
- **Results reach the conversation**: command output is delivered via `agent.followup` when available, falling back to the new-session notice otherwise. The init summary now lists scaffold files and the correct next step (`/sg-run` when a first change already exists, not `/sg-change`).
- **One confirmation page = H0**: the page shows the full requirements document (template FR/NFR/AC), the tech stack, auto-fill/warnings, and the files to write. Confirming writes `docs/requirements/REQ.md` and derives `openspec/REQ.md` plus the read-only snapshot.
- **One-shot initialization**: after confirmation the scaffold and the first change `add-version` are generated and the project stops at `H1_PENDING`; a legacy repository writes only requirements assets and no scaffold. `sg_approve H0` remains for legacy projects.
- **Traceability**: the requirements document records source/source_sha256 in frontmatter; `REQ.md` records derived_from; `state.requirementsSource` and `h0.hash/approvedAt` are auditable; `/sg-status` shows the requirements source and H0 approval time.
- **Tests**: added `test/v3/s38.init-entries.test.js` (13 cases) and rewrote `s36.requirements.test.js`; the full `node --test` run is 292 tests, 288 pass / 0 fail / 4 skipped (environment-only Node 18 cases).

## 3.7.0

- Requirements-first initialization: `/sg-init` interviews for functional (MVP), non-functional, constraints, and acceptance criteria before any tech-stack question, then merges both into one confirmation page.
- New `openspec/REQ.md` baseline: sequentially numbered `REQ-xxx` clauses and `AC-xxx` criteria that each declare `- covers: REQ-xxx`, plus a verbatim read-only snapshot in `openspec/history/v1.0/REQ.md`.
- The baseline is written only after confirmation: `sg_init` stops at `H0_PENDING`, and `sg_run` (new project) or `sg_approve H0` (legacy repo) writes it.
- Legacy onboarding: `/sg-init` in a repository that already has code scans the project, reverse-engineers a requirements draft, and writes `docs/requirements-scan.md` + `.specgate/requirements-scan.json` without generating any scaffold; `git init` runs only when the repository is missing, and only SpecGate-generated assets are committed.
- Requirements enforcement is opt-in via `requirements.enabled`: `sg-change` requires a matching baseline, and `M1` rejects proposals that reference no `REQ-xxx` or an unknown id.
- Idempotency: re-running `/sg-init` reports an idempotent skip, keeps the phase, and never overwrites `REQ.md`.
- New `src/v3/notice.js`: the first `/sg-*` command in a session without messages appends a `notice` context message so the result is visible outside the welcome page.
- `.specgate/init-result.json` is gitignored, so a `/sg-init` command run never leaves an untracked file behind.
- Fixes: the H0 approval message no longer interpolates the baseline object (`[object Object]`); the H0 gate card reads acceptance criteria from `state.requirements`; `configureSuites` no longer drops the `requirements` block when rewriting the config.
- 277 tests pass, including 8 new cases in `test/v3/s36.requirements.test.js`.

- Fix the H0 gate deadlock: `sg_approve` now accepts `gate: "H0"` (schema enum plus runtime check), and H0 approval no longer requires an existing change. A new project can leave `H0_PENDING` with `sg_approve` → `sg_run`.
- H0 guidance points at the `sg_approve` tool instead of the non-existent `/sg-approve` command.
- Restructure the README: Chinese is now the default `README.md`, English moved to `README.en.md`, and both carry a table of contents. `README.zh.md` was removed.

## 3.6.0

- Java backend stack: JDK 8/11/17/21 (LTS only), Spring Boot 2.7.x and 3.x with a strict compatibility matrix.
- New-project Java scaffold: default JDK 8 + Maven + Boot 2.7.18; selectable Gradle + Boot 3.x; Web/Validation/Actuator + JUnit 5 test + `/health`.
- Maven wrapper/scaffold and Gradle wrapper/scaffold, including Spotless/Checkstyle/SpotBugs configuration.
- Maven and Gradle suite runners parse Surefire/Failsafe/Gradle JUnit XML into SpecGate reports; JaCoCo report discovery.
- Java quality stages: Spotless, Checkstyle, compile, SpotBugs; Maven `verify` and Gradle `check`.
- Validation samples: JDK 8 + Maven + Boot 2.7 (`mvn verify`, 1 test pass) and JDK 17 + Gradle + Boot 3 (`spotlessApply check`, build successful).

## 3.5.0

- H0/H2 read-only environment scan for Node/Vue/React/Python/monorepo: `.specgate/env.json`, `env-report.md`, and a status line.
- First execution toolchain: missing devDependencies/configs are added per lockfile (npm/pnpm/yarn) or Python venv (`ruff`, `mypy`); existing files are not overwritten.
- Formatter auto-detects Prettier/Ruff; new lint and typecheck stages block on failure.
- Reviewer reruns the task suite, lint, and typecheck inside the review worktree before diff review.
- Environment reports are idempotent (no timestamp churn); quality reports live under `.specgate/runs/`.

## 3.4.0

- `/sg-status` accepts `--path <repo-root>`, `--json`, `--verbose`; paths work across Windows/POSIX and default to the current directory.
- Run records: `state.runs` plus `.specgate/runs/<change>.jsonl`; `--verbose` prints the recent timeline.
- Reviewer gets the real `git diff` (200KB cap with full file list), runs in a temporary detached review worktree, and blocking entries must carry `file/line/evidence/reason` validated against the diff.
- INTEGRATING performs a full `base..integration HEAD` review; blocking prevents H3.
- Formatter stage after implementer and before tester: runs `formatter.command` from config, writes `format-report.md`, commits formatting, and blocks on non-zero exit; unconfigured projects are skipped.
- Formatter/reviewer/implementer/tester runs are appended to the runs timeline.

## 3.3.1

- Gate dialogs are now split into 2–3 single-line pages (≤120 chars each) because the host merges newlines inside one question.
- Each info page has a `已读` option; only the last page shows `通过 / 需要修改`.
- Pages use `1/3` numbering and `｜` field separators; full content stays in `.specgate/gates/Hx.txt`.

## 3.3.0

- Gate dialogs now render plain-text compact cards (no Markdown headings/tables), capped at 1200 characters, with full details in `.specgate/gates/H0..H3.txt`.
- Card content is compressed per gate: H1 overview + first ACs, H2 tasks/files/suites, H3 acceptance + one 5-line diff hunk; secret-like lines are redacted.
- Added `H0_PENDING`: `/sg-init` collects context and stops; `/sg-approve H0` records `approvals.H0`; `/sg-run` builds the scaffold and first change, then moves to `H1_PENDING`.
- `/sg-status` shows H0 context and next action; new fifth command `/sg-context --reset` re-asks context and returns to H0.
- `.specgate/gates/` is gitignored so gate details never dirty the workspace.

## 3.2.0

- `/sg-init` now detects an empty directory and starts a new-project workflow: context Q&A (background/MVP, stack, acceptance, team, steps), H0 summary confirmation, scaffold, git init+commit, and a first change parked at H1.
- New Node and Python scaffolds include a runnable `/health` endpoint and a real test (`sg-test.mjs` / pytest).
- New-project artifacts: `project-context.md`, `AGENTS.md`, `openspec/`, glossary + ADR, CI, version locks, `.specgate/config.yaml` suites.
- Vue/React/monorepo currently fall back to the generic skeleton; real frontend/monorepo templates are still pending.

## 3.1.3

- Workflow audit fixes: H1 now allows writing the change specs delta before approval; design/tasks/tests/src stay frozen.
- Delta validation rejects reusing an existing baseline AC id in an ADDED requirement, and rejects moving another requirement's AC in MODIFIED.
- implementer changes under `docs/` must be listed in `touched.modify`/`touched.bootstrap`; unlisted docs are rejected by diffCheck.
- Archive tags now carry the evidence head hash in the tag annotation (`evidence: sha256:…`).
- `/sg-init` and `/sg-status` now have a non-empty input hint so they appear in the command palette.
- Audit report refreshed at `docs/audits/v3.1-workflow-audit.md`.

## 3.1.2

- H1/H2/H3 approval dialogs now render a Markdown review card: requirement overview, task/file/suite plan, acceptance table, diff stat and key hunks.
- Diff display is capped (20 files, 40 lines, 6000 chars) and redacts secret-like lines; binary files show stats only.
- Acceptance reports now include total/pass/fail/skip test counts.
- Added `docs/audits/v3.1-workflow-audit.md` covering add/modify/fix/remove compliance and open gaps.

## 3.1.1

- Added a per-repo, per-role Agent pool for `sg_run`: implementer/tester are reused across tasks, reviewer stays fresh.
- Bounded history: inject the previous task summary and recycle after 3 tasks or 70% context.
- Pool limits: 2 per role, 6 concurrently leased per change, 10-minute idle TTL, archive cleanup.
- Failure replacement and a 2-failure circuit breaker per role; `/sg-status` reports pool stats.

## 3.1.0

- Added multi-suite projects: `.specgate/config.yaml` `suites[]` with `node-test` / `pytest` / `command` kinds, per-suite `cmdHash` and evidence.
- Added AC-to-suite ownership in `tests/mapping.json`; multi-suite changes require `suite` on every AC.
- Added Node 18–24 detection and per-subprocess switching (volta / fnm / nvm-windows / asdf), with fail-closed errors.
- Added Python 3.9–3.13 virtualenv reuse/creation and a built-in pytest junit-xml adapter.
- Added dependency installation by lockfile (npm/pnpm/yarn/bun, pip/uv), idempotent per worktree and disableable.
- Added `changeKey` for cross-repo traceability without cross-repo locks.
- Added Windows + Linux CI matrix (Node 20/22/24).
- v3.0 single-suite projects keep working without config changes.

## 3.0.0

- Replaced the G1–G11 gate workflow with the v3 autonomous loop: AI executes, machine evidence decides, humans approve only H1/H2/H3.
- Added `src/v3` orchestration: state, approvals, OpenSpec delta validation, worktrees, role diff checks, test:json evidence, acceptance and archive transaction.
- Removed the v2 gate runtime and its tests.

## 2.1.0

- Added development-role inference (`architect`/`ddd`/`developer`); explicit `role:` wins and low-confidence tasks stop before any Agent is created.
- Added `G7.5` format/lint between implementation and tests.
- Added the independent `sg-agent-formatter` with changed-files-only formatting, config/package.json command detection and `format-report.md`.
- Reused `sg-agent-reviewer` as an independent read-only reviewer with `review-report.md`; blocking findings prevent G9.
- Added `sg-apply` / `sg_apply` stage orchestration: one stage per invocation, stop at the gate; dev → format → test → review.
- Added per-stage quality retry state with two failed attempts before blocking.
- Added formatter/reviewer worktrees and bilingual assets. 11 Agents, 17 tools. 113 tests passing.

## 2.0.0

- Added the v2 requirements model: one canonical `requirements/REQUIREMENTS.md`, immutable `history/vX.Y.Z/` snapshots and change-scoped `requirements/changes/<id>/` delta packages.
- Added `/sg-change` and `sg_change`; G3 now applies the requirement delta and writes the next approved version.
- Added the dedicated `sg-agent-tester`, `tests/cases.md`, `tests/matrix.md`, `tests/test-report.md` and `/sg-test <change> plan|run` with an independent test worktree.
- G5 now validates/freezes test cases; G8 validates a passing report and coverage thresholds (P0/P1 100%, P2 90%, line 80%, branch 70%).
- Added `/sg-requirements-migrate` and `sg_requirements_migrate` for explicit legacy migration; old projects keep the legacy flow until migrated.
- Dev tasks and tests use separate worktrees; the main agent remains the only merger.
- Added 10-agent assets, v2 templates/docs and regression tests. 99 tests passing.

## Unreleased

- `/sg-*` commands now hand their complete output back to the agent through `agent.followup` (`source.kind=specgate`, message `role=user`), so results are rendered as normal assistant replies in the conversation and the agent can ask for the next gate instead of leaving only a collapsed command card or `notice` chip.
- The hand-off also fires in active conversations, not only in fresh sessions; `agent.status === 'running'` still skips it to protect `tool_use`/`tool_result` pairing.
- When the runtime has no `followup` or the hand-off is rejected, it degrades to the previous durable `notice`, so a command never loses its report.
- Tests: 90 passing (added hand-off coverage in `test/commands-report.test.js`).

## 1.0.1

- Fixed `sg_doctor` crashing when the composition does not inject the `agents` service (`cannot get property "agents" without inject`): the runner now resolves via `ctx.get('agents')` first and is built inside the `try` block, falling back to the local deterministic health check when unavailable.
- Fixed dispatched child Agents not inheriting the parent model route.

## 1.0.0

First public SpecGate release, derived from AgentKit47-Qoder.

- Renamed the plugin, commands, tools, data directory, skills and agents from AK47 identifiers to SpecGate (`sg-*`, `.specgate/`).
- Added idempotency for all mutating commands/tools: state checks, 24h deduplication for append operations, concurrency locks.
- Added multi-Agent parallel dispatch for `/sg-apply` (worktrees, `[P]`/`depends` waves, conflict preservation) and `/sg-doctor`.
- Added `/sg-migrate` and `sg_migrate` for `.ak47/` → `.specgate/` migration with backups and managed-reference rewriting.
- Added bilingual English/Chinese assets and `language` selection.
- Added project and global configuration (`defaultEnabled`, `enforcement`, `maxConcurrency`, `git`, `language`, `materializeSkills`, `materializeAgents`).
- Added publish metadata, npm packaging checks, GitHub Actions CI and tag-based release.
- Fixed Skill loading by adding the required `source` field to every runtime registration.
- 89 tests passing.
