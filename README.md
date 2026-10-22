# SpecGate for Codex

SpecGate 是一个 Codex 原生插件，用受控 MCP 状态、真实 subagents、独立
worktrees 和机器可审计证据完成项目接入、异步交付、独立验证、验收记录和增量再交付。

[English](README.en.md) · [源码加载 Quickstart](docs/quickstart-codex-source.zh.md)

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

## 从源码加载

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
