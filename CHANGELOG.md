# Changelog

## 2.1.0

- Added development-role inference (`architect`/`ddd`/`developer`); explicit `role:` wins and low-confidence tasks stop before any Agent is created.
- Added `G7.5` format/lint between implementation and tests.
- Added the independent `sg-agent-formatter` with changed-files-only formatting, config/package.json command detection and `format-report.md`.
- Reused `sg-agent-reviewer` as an independent read-only reviewer with `review-report.md`; blocking findings prevent G9.
- Added `sg-apply` / `sg_apply` stage orchestration: one stage per invocation, stop at the gate; dev → format → test → review.
- Added per-stage quality retry state with two failed attempts before blocking.
- Added formatter/reviewer worktrees and bilingual assets. 11 Agents, 17 tools. 111 tests passing.

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
