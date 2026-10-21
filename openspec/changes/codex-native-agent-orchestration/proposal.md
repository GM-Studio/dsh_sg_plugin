# Codex 原生 Agent 编排修复

## Why

当前插件可以通过 Codex MCP 生成项目、登记需求并执行真实验证，但宿主集成仍有三处断点：

1. Codex CLI 0.163.0 不会自动暴露旧 `.codex-plugin/plugin.json` + `.mcp.json` 组合中的 MCP server。
2. `skills/sg-codex/SKILL.md` 仍声称只支持 P0，导致 Agent 主动拒绝已经实现的 P1-P9 工具。
3. MCP 默认没有服务器角色桥，现有 P6/P7/P8 服务只能通过测试注入 provider 执行，真实 Codex 主 Agent 无法把前端、后端、测试、格式化与 Review 子 Agent 的结果安全地接回状态机。

## What Changes

- 增加便携式根 `plugin.json` 与 `mcp.json`，保留旧 Codex compatibility 文件。
- 增加源码 marketplace、源码安装和项目 Agent 初始化 Quickstart。
- 新增 Test Designer、Frontend、Backend、Tester、Formatter、Reviewer 六个项目级自定义 Agent 模板。
- 增加 Markdown 管理的 `AGENTS.md` 编排规则，强制 Codex 使用真实 subagent，而不是主线程模拟角色。
- 增加非阻塞 MCP handoff：
  - Test Designer 在独立 test-design worktree 提交测试资产，MCP 校验 hash 后冻结。
  - Frontend 与 Backend 在各自 worktree 并行提交，MCP 校验 freeze 后代与角色边界后合并。
  - Tester 对齐 integration commit 执行冻结用例和真实验证。
  - Formatter 在独立 worktree 运行项目格式化器，提交并合入 integration。
  - Reviewer 只读 Review 固定 commit并提交结构化报告。
  - blocking/high-risk finding 生成新一轮 frontend/backend/format worktree，回到 develop 后自动重跑测试、格式化和 Review。
- 增加本地 Codex 交互式审批桥：只有当 MCP client 明确支持 elicitation，且服务器由用户启动时，才把 OS 用户映射为审批 actor；批准内容仍必须经过单次消费和持久审计。

## Non-goals

- MCP server 不直接创建 Codex subagent。Codex 的公开控制面要求主 Agent 或 Skill 指令触发 subagent。
- 不伪造 H1/H3、Agent 身份或测试成功。
- 不自动 push 生产远端，不改变 DSH v3 命令兼容行为。
- 不在本项目内替用户项目执行初始化；Quickstart 只安装插件和项目级 Agent 模板。
