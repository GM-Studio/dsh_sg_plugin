# 变更记录

## 未发布

- Core v1 默认收敛为 43 个本地工具、三个委派角色；控制面、通知、安装器与
  MySQL 隔离为非默认源码能力，不进入 Core 包。
- 格式化后完整重验；Review、H3、归档和 DeliveryRecord 绑定受验提交，目标分支
  分叉时阻断归档。
- 客户摘要保留基线未验证区域；Windows 项目命令有界解析并记录真实起止时间。
- 增加离线安装包内合成生命周期回归。真实 GitHub 金丝雀尚待验收；合成 provider
  不代表原生人工审批或真实业务交付。

### 更早变更（包含 Core v1 之外的历史可选能力）

- 修复 Codex 宿主被 `.mcp.json` 的 `enabled: false` 挡住，导致
  `sg_test_design_prepare` 等规划工具未投影的问题；两个可移植 MCP 入口保持一致。
- H1/H3 Attention 支持受认证的审批文档页面，控制台链接直接打开当前文档，不再显示
  写死的本地 URL。
- 测试设计与前后端实现改为向真实 Codex Agent 指派完整角色配置、冻结输入、工作区和
  提交要求；角色任务通过 stdin 传递，失败或无提交时不得标记完成。
- 插件版本升级到 0.3.4，确保宿主重新加载已修复的工具投影和原生角色执行链。
- 完成 M2 云端认证、设备与会话：账号 scrypt 密码、强制 TOTP 防重放、设备确认
  与撤销级联、CSRF 会话、一次性动作绑定 step-up proof、Attention nonce 和
  MySQL 认证审计；远程模式未配置账号认证时拒绝启动。
- 插件版本升级到 0.3.3，避免宿主继续复用绑定缓存目录且交互/验证入口不完整的
  0.3.2 缓存；缓存 cwd 不再冒充业务项目。
- 修复新建项目表单已提交却因额外确认框被判定为取消的问题；原生表单优先，取消或
  宿主拒绝后可再次请求，环境失败时保留用户技术栈选择。
- 保留 `sg_verify` 并增加同实现的 `sg_project_verify` 项目入口；项目状态明确给出
  可调用验证步骤，缺少真实证据时仍禁止建立基线。
- 当前模板修订与历史 Golden 哈希分开记录，按所选 Vue/React 比对；尚未重跑矩阵的
  当前模板显示“待验证”，不再误报为未知哈希不一致，也不冒充已通过。
- 将用户入口拆分为环境准备、项目准备、需求开发、只读状态四个任务 Skill，
  `$sg-codex` 保留统一导航，旧 setup 入口兼容转接；项目副本和入口元数据同步。
- 增加会话内只读环境预检、所选技术栈缺项安装、可信安装确认、固定官方 checksum、
  国内镜像、临时配置与目录清理，并在生成和开发执行前检查环境门禁。
- 增加不启动控制面 runtime 的只读状态汇总；安装草案不再作为外部入口打包。
- 修复真实矩阵发现的 Java 安全测试和 Vue/React 中文文案格式问题，并为较慢虚拟机
  的后台基线回归保留有界等待时间。

- 自动化测试现在把所有 worker 隔离到单个带所有权标记的临时根目录，正常、
  失败和信号退出时清理，并在下次运行安全回收中断遗留；矩阵验证与交付试运行
  也会在成功或失败后删除生成工作区，只保留显式证据目录。
- 新建项目表单在会话目录为 SpecGate 插件目录时要求必填业务项目绝对路径，
  不再默认把插件目录当"当前仓库"；普通目录仍支持留空复用当前仓库。
- 审批与澄清失败消息中文化；缺少可信审批/表单通道时给出重新加载插件连接、
  新建会话等可执行指引，普通聊天确认始终不构成 H1/H3 审批。
- 插件版本升级到 0.3.2，强制宿主使用新缓存，避免继续加载旧版连接导致
  sg_request_h1 缺失或 TRUSTED_USER_IDENTITY_UNAVAILABLE。
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
