# 变更记录

## 2.0.0

- 新增 v2 需求模型：唯一 `requirements/REQUIREMENTS.md`、不可变 `history/vX.Y.Z/` 快照、change 级 `requirements/changes/<id>/` 增量包。
- 新增 `/sg-change` 与 `sg_change`；G3 现在应用需求增量并写入下一个已批准版本。
- 新增专用 `sg-agent-tester`、`tests/cases.md`、`tests/matrix.md`、`tests/test-report.md`，以及 `/sg-test <change> plan|run` 独立 test worktree。
- G5 校验并冻结测试用例；G8 校验通过的测试报告与覆盖率（P0/P1 100%、P2 90%、行 80%、分支 70%）。
- 新增 `/sg-requirements-migrate` 与 `sg_requirements_migrate` 显式迁移旧项目；未迁移项目保持旧流程。
- 开发任务与测试使用独立 worktree；主 Agent 仍是唯一合并者。
- 新增 10 个 Agent 资产、v2 模板/文档与回归测试。99 项测试通过。

## 未发布

- `/sg-*` 命令现在通过 `agent.followup` 把完整输出交回 agent（`source.kind=specgate`，消息为 `role=user`），结果以正常对话消息呈现，并可接着追问下一门控，不再只剩折叠的命令卡片或 `notice` 小条。
- 交回在活跃会话中同样生效，不再只限新会话；`agent.status === 'running'` 时仍然跳过，以保护 `tool_use`/`tool_result` 配对。
- runtime 没有 `followup` 或交回被拒绝时，降级为原有的 `notice`，命令结果不会丢失。
- 测试：90 项通过（`test/commands-report.test.js` 新增交回覆盖）。

## 1.0.1

- 修复 `sg_doctor` 在 composition 未注入 `agents` 服务时直接崩溃（`cannot get property "agents" without inject`）：改为优先通过 `ctx.get('agents')` 解析，并在 `try` 内构造 runner；不可用时自动降级为本地确定性体检。
- 修复并行派发的子 Agent 未继承父级模型路由。

## 1.0.0

SpecGate 首个公开版本，源自 AgentKit47-Qoder。

- 插件、命令、工具、数据目录、Skill、Agent 全部从 AK47 标识迁移为 SpecGate（`sg-*`、`.specgate/`）。
- 所有修改类命令/工具增加幂等：状态检查、追加类操作 24h 去重、并发锁。
- `/sg-apply` 增加多 Agent 并行派发（worktree、`[P]`/`depends` 波次、冲突保留）；`/sg-doctor` 四维并行体检。
- 新增 `/sg-migrate` 与 `sg_migrate`：`.ak47/` → `.specgate/` 迁移，包含备份与受管引用重写。
- 新增中英双语资产与 `language` 选择。
- 新增项目级与全局配置（`defaultEnabled`、`enforcement`、`maxConcurrency`、`git`、`language`、`materializeSkills`、`materializeAgents`）。
- 增加 npm 发布元数据、打包检查、GitHub Actions CI 与 tag 发布流程。
- 修复 Skill 加载：运行时注册补充必需的 `source` 字段。
- 89 项测试通过。
