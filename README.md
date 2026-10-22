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
测试和运行必须由后续 `sg_verify` 在你授权的环境中执行，未运行或失败的命令不得
描述为通过。

脚手架附带可评审的风格基线 `docs/style.md`。变更前应先阅读它；Reviewer 把没有
显式且已记录理由的偏离视为 finding，偏离影响分层、契约、事务、安全或前后端一致性
时可作为阻塞性问题。

## 技术栈

初始化时可选择 JDK 与前端框架，选择结果固化进 `ProjectProfile`
（`frontendFramework`、`javaPreset`）；后续变更只能在该事实内工作，栈不匹配时
fail-closed。

- 后端 JDK：JDK 8、17 或 21（默认 JDK 8 + Spring Boot 2.7）。
- Spring Boot：2.7.x 与 3.5.x；另有 JDK 21 + Spring Boot 4.0 预览档。
- 前端：Vue 3（默认）；React 18 计划中，模板落地前选择 React 会 fail-closed。

前端脚手架使用 Vue 3.5 + Element Plus + vue-router + vue-i18n + TypeScript。
这些只是脚手架选定的版本，**不代表**任何预设已在 Windows + Linux 双平台验证通过：
`GOLDEN_MANIFEST` 中每个预设当前都是 `pending`，只有在两平台重跑真实矩阵后才会
标记 `verified`。

## 从源码加载

先确认所用 Codex 支持 `codex plugin`。本机旧版 npm CLI 0.117.0 不支持该命令；
桌面端自带 CLI 可能与终端默认版本不同。版本选择、安装状态检查和各平台步骤见
[安装配置指南](docs/install-config-codex.zh.md)。

```powershell
cd E:\ai_workflow\specgate
npm ci
codex plugin marketplace add E:\ai_workflow\specgate
codex plugin add specgate-codex@specgate-source
node E:\ai_workflow\specgate\scripts\codex-source-setup.mjs --project <项目绝对路径>
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
skills/                                sg-codex and setup Skills
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
