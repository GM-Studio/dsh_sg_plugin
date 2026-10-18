# Changelog

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
