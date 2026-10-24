# SpecGate for Codex

SpecGate 是一个 Codex 原生插件，用受控 MCP 状态、真实 subagents、独立
worktrees 和机器可审计证据完成项目接入、异步交付、独立验证、验收记录和增量再交付。

[English](README.en.md) · [Windows / Linux 安装配置指南](docs/install-config-codex.zh.md) · [源码加载 Quickstart](docs/quickstart-codex-source.zh.md)

## 能力

- 新建 Java/Vue 项目可生成并建立可靠 Baseline。
- 存量 Java/Vue 项目通过只读预览接入；脏工作区按显式批准文件提交。
- `sg_change` 统一支持 feature、modify 和 fix；`sg_change_add` 保留兼容。
- H1 冻结需求、ChangeContract 和验收标准。
- Test Designer 先于实现提交可执行测试。
- Frontend 与 Backend implementation 在独立 worktree 中串行执行。
- Tester 执行冻结用例和真实 Maven、Vitest、HTTP、运行时验证。
- Formatter 在独立 worktree 格式化，Reviewer 对固定提交做只读走查。
- 证据记录 commit、AC、环境指纹、Flaky 状态和未执行项。
- H3 后生成不可变 DeliveryRecord、本地 tag、内部证据包和客户交付包。
- 客户反馈引用上一 Delivery 进行影响分析和增量再交付。
- 远程推送必须显式 `push=true`，且不支持 force push。
- WorkItem 由独立 supervisor 跨 MCP、页面和飞书连接继续运行。
- H1/H3 到达人工门禁时释放执行租约，Decision 后自动恢复 Codex session。
- Web 管理台提供注意力首页、项目/WorkItem/Run/证据/通知/Decision 监控和受控操作。
- 飞书只发送可行动的关键节点通知；消息按钮打开认证管理页面，不直接构成审批。
- 高风险 Decision 使用 TOTP step-up、版本 CAS、artifact hash 和幂等键。
- DeliveryRecord 区分 H3 发布批准、交付生成和客户接受。
- 默认不部署生产环境，不自动执行生产数据库回滚。

## 生成的管理后台脚手架

`sg_init` 生成的不是空骨架，而是一个**领域中立的通用管理后台**，内置可直接运行的后台模块：

- 用户、角色、部门、菜单的后台管理接口，固定挂载在 `/api/sys/**`。
- 审计日志（只读分页查询）与仪表盘汇总统计。
- 用户与角色的 CSV 导入导出（导入校验、模板下载、导出），以及批量操作与分页过滤。
- 前端 Vue 3 管理台：登录、`AppLayout` 外壳、侧边栏菜单、仪表盘和 sys 视图；
  默认中文（`zh-CN`）并保留 `en-US` 运行时切换。

生成遵循 `com.<company>.<business>` 包、中文源码注释和统一响应信封；生成只写入
源码、测试和文档，**不下载依赖、不构建、不启动服务**。生成不是验证：真实构建、
测试和运行必须由后续 `sg_project_verify`（与 `sg_verify` 同一实现）在你授权的环境中执行，未运行或失败的命令不得
描述为通过。

脚手架附带可评审的风格基线 `docs/style.md`。变更前应先阅读它；Reviewer 把没有
显式且已记录理由的偏离视为 finding，偏离影响分层、契约、事务、安全或前后端一致性
时可作为阻塞性问题。

## 技术栈

初始化时可选择 JDK 与前端框架，选择结果固化进 `ProjectProfile`
（`frontendFramework`、`javaPreset`）；后续变更只能在该事实内工作，栈不匹配时
fail-closed。

- 后端 JDK：JDK 8、17 或 21，必须由用户在中文表单中明确选择。
- Spring Boot：2.7.x 与 3.5.x；支持 JDK 21 + Spring Boot 3.5。
- 前端：Vue 3（默认）；React 18 可选，使用独立模板与锁文件。

前端脚手架使用 Vue 3.5 + Element Plus + vue-router + vue-i18n + TypeScript。
这些只是脚手架选定的版本。`GOLDEN_MANIFEST` 保留历史模板哈希的 Windows + Linux
真实矩阵证据；当前模板修订使用独立哈希并保持 `awaiting-verification`，只有针对当前
内容重跑真实矩阵后才会标记 `verified`。初始化可以继续，但这不代表模板或生成项目
已经验证通过。

## 从源码加载

日常使用入口：[Codex 会话内使用与环境准备](docs/environment-codex.zh.md)。

| Skill               | 职责                               |
| ------------------- | ---------------------------------- |
| `$sg-codex`         | 统一导航与帮助                     |
| `$sg-codex-env`     | 环境预检、复用、按项目补齐与验证   |
| `$sg-codex-project` | 初始化、存量接入、项目配置和基线   |
| `$sg-codex-change`  | 新增/修改/修复、任务控制和验收交付 |
| `$sg-codex-status`  | 只读项目信息与状态                 |

`$sg-codex-setup` 保留为准备能力的兼容别名。环境操作在会话内完成，当前项目不需要的 JDK 不预装，查询状态不触发安装、初始化或恢复。

安装插件后，在业务项目的 Codex 会话中使用 `$sg-codex` 导航或直接调用相应任务 Skill。新建项目使用 `sg_project_create` 中文表单选择目录、包名、
技术栈和 Git 身份，自动安装 Agent 与项目 Skill；普通使用无需手动执行安装脚本。
先看 `sg_project_status.projectRoot`：插件缓存不会再显示为业务项目；路径为空或错误时
调用 `sg_project_bind`。已生成项目通过 `sg_project_verify` / `sg_verify` 写入真实证据，
再调用 `sg_project_finalize_new` 建立基线。
现有项目缺少环境时调用 `sg_project_setup` 自动补齐。

聊天所在仓库和 MCP 进程的启动目录可能不同。环境检查可直接传入
`sg_env_check({ path: "E:\\new_project\\test_demo" })`，在当前连接绑定该业务目录后只读检查；
不会写入项目配置。目录不存在或指向插件源码时明确拒绝，保留原绑定。
`sg_project_setup` 生成带 `--project-root` 的项目 MCP 配置，需由宿主重新加载后生效。
`sg_project_status.workflow` 返回当前需求、阶段和版本；H1 待审批时返回可用于
`sg_change` 的 `nextArguments`，无需依赖另一个状态工具或重新创建需求。

真实验证与基线建立后停在就绪，等待用户提出业务需求，再澄清、反述、批判分析，
由用户通过 H1 表单审批。宿主必须支持 MCP elicitation 才能显示原生表单；缺少支持
时工具会明确报告待输入或待审批，不会伪造确认。

需求澄清的选择题使用 `input: "choice"`（单选）或 `"multi-choice"`（多选）及
`options` 显示选择控件；填空使用 `input: "text"` 文本框。批判分析完成后，
`sg_change_critique` 会先写入需求 Markdown 并返回可打开的绝对路径，供用户查看和修改。
修改需重新提案、分析并生成新文档；查看后用 `sg_request_h1` 打开批准/要求修改/取消表单。
宿主未暴露该工具时，可用 `sg_change({ action: "request_h1", expectedVersion })`
打开同一可信审批；批准后才进入 `REQ_FROZEN`，随后推进计划。

H1 表单只显示精简的变更内容、变更方式、范围边界、验收数量和完整文档路径，
审批意见可留空。已有需求缺少文档时会在同一次 H1 调用内补齐并弹出表单。
关闭表单保留待审批状态；选择“取消变更”并确认才终止需求。每次操作返回明确结果和最新版本。

生成项目的 `npm run dev` 仅启动前端；`npm run backend` 独立启动后端，
`npm run dev:all` 联合启动。本地演示默认账号为 `admin / admin`、`viewer / viewer`，配置保存在被 Git 忽略的 `.env`，
启动脚本与 Spring 会自动读取；已有项目可运行 `npm run configure` 补齐。

先确认所用 Codex 支持 `codex plugin`。本机旧版 npm CLI 0.117.0 不支持该命令；
桌面端自带 CLI 可能与终端默认版本不同。版本选择、安装状态检查和各平台步骤见
[安装配置指南](docs/install-config-codex.zh.md)。

```powershell
cd E:\ai_workflow\specgate
npm ci
codex plugin marketplace add E:\ai_workflow\specgate
codex plugin add specgate-codex@specgate-source
codex -C <项目绝对路径>
```

然后在 Codex 中要求按 `AGENTS.md` 和 `sg-codex` Skill 执行。详细步骤见
[Quickstart](docs/quickstart-codex-source.zh.md)。

异步控制面可单独启动：

```powershell
npm run codex:control -- status
npm run codex:control -- start --project <项目绝对路径>
npm run codex:control -- doctor --project <项目绝对路径>
```

`start` 返回一次性 Web 配对链接。关闭 Codex 会话不会停止 supervisor；
`npm run codex:control -- stop` 通过跨平台停止请求安全结束控制进程并保留
WorkItem。控制进程只向子 Codex 注入项目绑定的 SpecGate MCP，不继承宿主其他
MCP 或飞书/MFA 凭据。

控制面支持两种模式，控制台提供跨项目的组合总览视图：

- 聚合（aggregate，默认）：一个控制 home、一个管理端口登记并汇总多个项目，
  聚合视图按项目汇总注意力首页与队列。
- 隔离（isolated）：每个项目使用独立控制 home（`<controlRoot>/projects/<projectId>`）
  和确定性端口，互不共享 MCP 配置、凭据与状态。

控制面的 Web 会话与配对 token 会持久化到磁盘（`web-sessions.json`），控制面重启后
在其 TTL 内仍然可用，无需重新配对。

`doctor` 除检查 Codex `--version` 外，还对宿主 Codex 做只读、非交互、限时的能力
探测（`plugin`、`exec --json`、原生 subagents、elicitation），逐项报告
`available` / `missing` / `not-probed`，并给出有效运行模式、降级路径和升级提示。
能力缺失不会静默失败：缺少 `plugin` 走项目级 MCP + Skill 路径，缺少 elicitation
时人工门禁保持 pending，`not-probed` 按不可用保守处理。

## 结构

```text
plugin.json / mcp.json                 portable plugin entry
.codex-plugin/ / .mcp.json             compatibility manifests
skills/                                router, four task Skills and setup alias
assets/codex/                          six project Agent templates
assets/java-vue/template/              generated Java/Vue baseline
src/codex/                             MCP server and workflow services
src/codex/core/                        shared state, verification and Java tooling
src/codex/control/                     WorkItem, supervisor, Decision and Outcome
src/codex/management/                  local management API and Web UI
src/codex/channels/                    Feishu notification and Outbox
scripts/codex-source-setup.mjs         project Agent installer
scripts/codex-plugin-smoke.mjs         packaged MCP smoke check
scripts/specgate-control.mjs           control daemon CLI
scripts/verify-codex-matrix.mjs        real Java/Vue preset matrix
test/codex-*.test.js                   focused Codex regressions
```

本分支只包含 Codex 插件运行时，不保留旧宿主入口或兼容目录。

## 验证

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
npm run codex:control -- help
```

测试、lint、格式化、打包和真实 MCP smoke 都通过后，才可作为可交付源码。

## 许可证

MIT
