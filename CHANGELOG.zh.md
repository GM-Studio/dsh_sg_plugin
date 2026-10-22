# 变更记录

## 未发布

- 增加独立异步 supervisor、持久 WorkItem/ExecutionRun/租约/心跳和进程恢复。
- 增加 H1/H3 异步 AttentionRequest，Decision 后自动 resume Codex session。
- 增加本地 Web 管理台、一次性配对、CSRF、会话和运行监控。
- 增加飞书交互卡片通知、Notification Outbox、去重和指数退避。
- 增加 TOTP step-up、版本 CAS、artifact hash 和 Decision 幂等校验。
- 增加 DeliveryRecord schema 3，分离 H3 发布批准和客户接受。
- supervisor 只向 Codex 注入项目绑定 SpecGate MCP 和凭据安全的白名单环境。
- 客户接受先绑定不可变 DeliveryRecord 回执，再消费 Control Decision。
- 飞书发送幂等的“已处理/已失效”回执，并提供跨平台优雅停止请求。
- 增加新项目与存量项目接入，以及 ProjectProfile 和 ProjectBaseline。
- 增加脏工作区显式文件批准提交和 known-failures 基线。
- 增加 detached 临时 worktree 基线执行、可轮询进度、命令证据落盘和成功后
  运行状态清理。
- 增加 lockfile 驱动的 install 命令发现，并只通过显式路径提交稳定的
  SpecGate 元数据。
- 增加 adopted 项目按 ProjectProfile 命令验证，以及基于稳定失败签名的
  Baseline Delta 质量门。
- 新项目使用 `com.<company>.<business>` 包、中文源码注释和默认中文的
  Vue I18n 前端。
- 增加统一 `sg_change`，支持 feature、modify 和 fix。
- 实现串行执行、环境指纹、证据充分性和 Flaky Test 显式记录。
- 增加不可变 DeliveryRecord、本地 tag、内部/客户交付包、增量再交付和显式
  非强制推送。
- 增加 Codex 源码加载、项目级 MCP、六个真实 subagents 和交互式 H1/H3 审批。
- 增加测试先行、前后端独立 worktree 并行、质量门、格式化、严格 Review 与自动回修闭环。
- 增加冻结测试受控替换和原生 runner 兼容层。
- 将所有共享运行时依赖迁移到 `src/codex/core/`。
- 删除与 Codex 插件无关的旧入口、测试、资产和历史验证数据。
- 初始化时选择技术栈并固化进 `ProjectProfile` 的可选字段 `frontendFramework`
  （`vue` | `react`）和 `javaPreset`；后续变更栈不匹配时 fail-closed。React 18
  在模板落地前保持 fail-closed。
- 生成领域中立的通用管理后台脚手架：用户、角色、部门、菜单、只读审计日志和
  仪表盘，统一挂载在 `/api/sys/**`，含分页、过滤和批量操作。
- 为用户和角色增加 CSV 导入（校验、模板、导入）与导出。
- 生成项目的 `docs/style.md` 风格基线，并让 Reviewer 把无理由偏离视为 finding，
  影响实质时为阻塞性问题。
- 控制面 Web 会话与配对 token 跨重启持久化，在 TTL 内继续有效。
- `doctor` 增加对宿主 Codex 的只读、限时能力探测（`plugin`、`exec --json`、
  原生 subagents、elicitation），并给出显式降级路径和版本门禁提示。
- 在 `sg_change` 入口计算并持久化增量交付影响（受影响/复用的验收标准、
  失效测试）。
- `HOST_HEALTH` 增加 `SUSPECT`，用于心跳过期的宿主。
- 删除 `ProjectProfile` 中已废弃的 `pushApproved` 字段。
- 增加多项目注册表、aggregate / isolated 控制模式（含 `--mode` 切换与
  `register` 命令）以及控制台的跨项目组合总览视图。

## 0.3.0

- Codex Java/Vue 初始化、真实验证与可审计工作流状态。
