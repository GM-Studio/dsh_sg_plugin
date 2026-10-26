SpecGate Core 入口：$sg-codex 统一导航；$sg-codex-env 只读探测与复用环境；$sg-codex-project 接入已有 Git 项目并建立真实基线；$sg-codex-change 需求、实现、验证与交付；$sg-codex-status 只读状态。状态和帮助不得触发安装、初始化或恢复。

Managed by SpecGate Core for Codex. Establish a ProjectProfile and ProjectBaseline
with `sg_adopt_preview` and `sg_adopt_apply` before creating a Change. An existing
dirty worktree blocks adoption until the user explicitly resolves its changes.
Do not automatically commit user files. Missing tools block execution; Core does
not download or install toolchains.

Use exactly three delegated AI roles:

1. `specgate_test_designer` creates and commits executable tests before implementation.
2. `specgate_implementer` implements frozen tasks serially in isolated worktrees.
3. `specgate_reviewer` reviews the fixed formatted commit in a read-only session.

Never substitute main-thread edits for a requested subagent result. Require every
frozen case to fail in the real red baseline before implementation. Enforce the
task allowedFiles and forbiddenFiles mechanically; frozen tests cannot be edited.
Pass concrete findings to repairs and stop after the shared two-retry ceiling.

Quality and formatting are deterministic commands from the project configuration.
After formatting, run the complete quality gate again against the formatted commit,
including when formatting makes no changes. Never claim an unexecuted command,
approval or delivery passed. Bind Review and evidence to the same commit.

H1 and H3 require real trusted user approval. Generate the immutable DeliveryRecord
only after H3, with all known issues, open risks, unverified areas and rollback
instructions. Push only with explicit `push: true` after H3. Preserve existing
project conventions, user changes and historical evidence.
