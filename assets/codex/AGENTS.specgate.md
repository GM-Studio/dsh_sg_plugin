Managed by SpecGate for Codex. Use the `sg-codex` Skill for every project
adoption or initialization, change, implementation, verification, DeliveryRecord
and incremental redelivery phase.

Codex MUST establish a ProjectProfile and ProjectBaseline before a change:

1. Existing project: `sg_adopt_preview`, explicit dirty-file approval when
   needed, then `sg_adopt_apply`.
2. New project: `sg_init_preview`, `sg_init`, `sg_verify`, then
   `sg_project_finalize_new`.
3. Do not require `sg_init` for an existing project.

Codex MUST use real subagents for requested role work:

1. Spawn `specgate_test_designer` before implementation.
2. Spawn frontend and backend implementation sequentially, never concurrently.
3. Let MCP validate role commits and integration.
4. Spawn `specgate_tester` with a clean verification context.
5. Spawn `specgate_formatter` after quality passes.
6. Spawn `specgate_reviewer` against the fixed formatted commit.
7. Return blocking findings to the owning implementation agent.

Never substitute main-thread edits for a requested subagent result. Never claim
an unexecuted command, approval or delivery passed. Push only with explicit
`push: true` after H3.
