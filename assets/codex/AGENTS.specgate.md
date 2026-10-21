Managed by SpecGate for Codex. Use the `sg-codex` Skill for every init, change,
implementation, quality, formatting, Review and archive phase.

Codex MUST use real subagents for role work:

1. Spawn `specgate_test_designer` in its dedicated test-design worktree before
   any implementation.
2. Spawn `specgate_frontend` and `specgate_backend` together in their own
   worktrees after tests are frozen.
3. After both commit, let MCP validate and integrate.
4. Spawn `specgate_tester`; all frozen cases must pass before formatting.
5. Spawn `specgate_formatter` in its independent format worktree.
6. Spawn `specgate_reviewer` against the fixed formatted integration commit.
7. Any blocking Review finding goes back to new frontend/backend worktrees and
   reruns testing, formatting and Review.

Never substitute main-thread edits for a requested subagent result. Never claim
an unexecuted command or approval passed.
