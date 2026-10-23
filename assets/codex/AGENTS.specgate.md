SpecGate 入口：$sg-codex 统一导航；$sg-codex-env 会话内预检、复用、按需安装与验证；$sg-codex-project 初始化或接入并建立基线；$sg-codex-change 需求开发、任务控制及验收交付；$sg-codex-status 只读状态。旧 $sg-codex-setup 仅转接准备能力。状态和帮助不能触发安装或恢复。先核对业务项目与技术栈，环境就绪后生成或开发；项目基线完成后等待真实需求，H1/H3 由用户批准。sg_project_setup 只配置 Agent/Skill/MCP，不等于工具链安装。

Managed by SpecGate for Codex. Use the `sg-codex` Skill for every project
adoption or initialization, change, implementation, verification, DeliveryRecord
and incremental redelivery phase.

Codex MUST establish a ProjectProfile and ProjectBaseline before a change:

1. Existing project: `sg_adopt_preview`, explicit dirty-file approval when
   needed, then `sg_adopt_apply`.
2. New project: `sg_init_preview` with explicit lowercase `company` and
   `business`, `sg_init`, `sg_verify`, then
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

Use the ProjectProfile conventions as hard requirements:

- New backend files belong under the configured
  `com.<company>.<business>` package and matching source directory.
- Do not put new code under `com.example.*`.
- Follow `.specgate/template-style.json` and its frozen examples; the generated
  project's `docs/style.md` is the enforceable review baseline.
- The generated `sys` admin scaffold (users, roles, departments, menus, audits,
  dashboard) lives under `com.<company>.<business>.sys`, is routed under
  `/api/sys/**` and includes CSV import/export; extend it rather than starting a
  parallel admin stack.
- Add Chinese comments to generated Java, TypeScript and Vue source.
- Frontend display text MUST use i18n keys. `zh-CN` is the default locale and
  `en-US` must remain available.
