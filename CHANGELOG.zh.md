# 变更记录

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
