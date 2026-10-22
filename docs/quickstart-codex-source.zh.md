# Codex 源码加载与原生 Agent Quickstart

本 Quickstart 让 Codex 从当前 SpecGate 源码目录加载插件，并在目标项目中安装真实 subagent 配置。适用于 Codex CLI 0.117.0 及后续支持 portable plugin、`mcp.json`、subagents、`exec --json` 和 session resume 的版本。

## 1. 准备源码

```bash
git clone <specgate-source>
cd specgate
npm ci
node scripts/codex-source-setup.mjs --project <absolute-project-path> --check
```

插件源码根目录必须同时存在：

```text
plugin.json
mcp.json
skills/
assets/codex/agents/
src/codex/server.js
```

共享运行时代码位于 `src/codex/core/`。本分支不包含旧版本入口或版本命名
兼容目录，Codex 是唯一支持的运行面。

`plugin.json` 是 portable Agent Plugins manifest，`mcp.json` 声明本地 stdio MCP。根目录的 `.agents/plugins/marketplace.json` 把当前 checkout 暴露为 `specgate-source` marketplace。

## 2. 从源码目录加载 Codex 插件

保持源码依赖安装完成，然后执行：

```bash
codex plugin marketplace add <absolute-specgate-source-path>
codex plugin add specgate-codex@specgate-source
codex plugin list
codex mcp list
```

预期结果：

- `codex plugin list` 显示 `specgate-codex@specgate-source` 为 `installed, enabled`。
- `codex mcp list` 显示 `specgate` 为 enabled。
- 新启动的 Codex 会话能看到 `sg_project_status`、`sg_adopt_preview`、
  `sg_adopt_apply`、`sg_project_finalize_new`、`sg_change`、
  `sg_test_design_prepare`、`sg_development_run`、`sg_quality_run`、
  `sg_format_run`、`sg_review_prepare` 和 `sg_release_archive` 等工具。

安装或更新插件后必须启动新的 Codex 会话。修改源码后重新执行：

```bash
codex plugin add specgate-codex@specgate-source
```

## 3. 启动异步控制面

异步 supervisor、Web 管理台和飞书 Outbox 独立于 Codex MCP 会话运行。

先生成本地 TOTP secret：

```powershell
npm run codex:control -- mfa
```

把命令返回的 secret 保存到操作系统环境或受控启动环境中的
`SPECGATE_MFA_SECRET`，不要写入仓库。需要飞书通知时再设置：

```powershell
$env:SPECGATE_FEISHU_WEBHOOK_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/..."
$env:SPECGATE_MANAGEMENT_PUBLIC_URL = "https://your-secure-management-endpoint/"
```

跨机器部署可以显式指定 Codex CLI 和隔离的 Codex home：

```powershell
$env:SPECGATE_CODEX_COMMAND = "codex"
$env:SPECGATE_CODEX_HOME = "<machine-local-codex-home>"
```

控制 supervisor 会用一次性的 `mcp_servers={}` 清除宿主额外 MCP，只注入
项目绑定的 `specgate_control` server，并只把 PATH、代理、Codex/provider
认证等白名单变量传给子进程。额外变量通过逗号分隔的
`SPECGATE_CODEX_ENV_ALLOWLIST` 显式放行。飞书 webhook、MFA secret 和管理
pairing token 不会进入子 Codex 环境。

远程 URL 必须通过 HTTPS 或受认证 Relay/隧道暴露；默认管理服务器只绑定
`127.0.0.1`。飞书 webhook 只负责通知，卡片按钮打开认证管理页，不把 webhook
callback 当作审批。

启动并检查：

```powershell
npm run codex:control -- start --project <absolute-project-path>
npm run codex:control -- status
npm run codex:control -- doctor --project <absolute-project-path>
```

`start` 返回一次性的 `pairingUrl`。在浏览器打开后，fragment 中的 pairing token
会换取 HttpOnly 会话和 CSRF token。关闭 Codex 会话不会停止 supervisor。

创建和查询 WorkItem：

```powershell
npm run codex:control -- create `
  --project <absolute-project-path> `
  --title "修复导出编码" `
  --request "修复客户导出文件乱码，并完成真实运行验证"
npm run codex:control -- list
npm run codex:control -- attention
```

也可以在 Codex 中调用 `sg_work_item_create`、`sg_work_item_status`。控制模式
worker 的 `SPECGATE_WORK_ITEM_ID` 和 `SPECGATE_CONTROL_MODE=1` 由 supervisor
自动注入。

停止控制面：

```powershell
npm run codex:control -- stop
```

停止只结束后台进程，不删除 WorkItem、事件和证据。重新启动时会重新核对租约、
心跳、审批和固定 commit。

`stop` 先写入受控的 `stop.request`，让 daemon 在 Windows/macOS/Linux 上执行
相同的优雅关闭流程；超时后才按平台终止整个 Codex 子进程树。

## 4. 安装项目级 Agent

新项目完成 `sg_init`、`sg_verify` 和 `sg_project_finalize_new`，或存量项目
完成 `sg_adopt_preview` 和 `sg_adopt_apply` 后：

新项目调用 `sg_init_preview` 和 `sg_init` 时必须提供小写 `company` 和
`business`。例如 `company: acme`、`business: orders` 会生成
`com.acme.orders`，源码目录为
`backend/src/main/java/com/acme/orders/`。禁止新代码写入
`com.example.*`。

生成源码使用中文文件说明和业务注释。前端展示文本必须通过 i18n key 提供，
默认 `zh-CN`，并保留 `en-US` 运行时切换。

`sg_adopt_apply` 只启动 detached baseline，立即返回 `baselineRun`。继续轮询
`sg_project_status`，直到 `projectReady: true` 或
`baselineRun.status: failed`。Codex 会话结束不会终止基线 worker。基线在
临时 Git worktree 中执行；成功或失败后都会移除该 worktree，成功时还会清理
`.git/specgate` 运行状态。

存量项目不需要执行 `sg_init`。基线的 `install` 命令由 npm/yarn/pnpm
lockfile 推导；`build`、`test`、`lint`、`format` 和 `runtime` 复用项目已有
工具。

```bash
node <absolute-specgate-source-path>/scripts/codex-source-setup.mjs \
  --project <absolute-project-path>
```

脚本只写入以下受管内容：

- `.codex/agents/specgate_test_designer.toml`
- `.codex/agents/specgate_frontend.toml`
- `.codex/agents/specgate_backend.toml`
- `.codex/agents/specgate_tester.toml`
- `.codex/agents/specgate_formatter.toml`
- `.codex/agents/specgate_reviewer.toml`
- `AGENTS.md` 中由 `<!-- specgate-codex:begin -->` 包围的受管块
- `.codex/config.toml` 中由 `# specgate-codex:config-begin` 包围的项目级 MCP 配置

已有同名自定义 Agent 内容不同时脚本 fail-closed，不会覆盖。

脚本同时把受管本地文件写入 Git 的 `.git/info/exclude`：

- `/.codex/`
- `/AGENTS.md`（仅当该文件未 tracked）

这样 setup 自身不会让主工作区变 dirty，也不会影响其他克隆或共享仓库。若
`AGENTS.md` 已被 Git tracked，脚本不会把它加入本地 exclude，而是在结果的
`git.trackedAgents`、`git.dirtyManagedPaths` 和 `git.warning` 中明确报告；
必须先提交这次受管修改，再执行 `sg_test_design_prepare`。

项目级配置会关闭插件 cache cwd 下的 `specgate` server，并启动：

```toml
[mcp_servers.specgate_project]
command = "node"
args = ["<source>/src/codex/server.js", "--project-root", "<absolute-project>"]
```

这样 MCP 状态始终绑定目标项目，而不是 `~/.codex/plugins/cache/...`。Codex 0.163 的 plugin server 默认从插件目录启动，`roots/list` 在部分 exec 会话中不可用，因此 Quickstart 使用项目级显式绑定作为可靠路径。

## 5. 启动 Codex

```bash
codex -C <absolute-project-path>
```

然后在会话里明确调用：

```text
$sg-codex 按原生 Agent 编排执行当前 change。
先确认项目已有 ProjectProfile 和 ProjectBaseline。
测试用例必须先写并冻结；随后按计划串行派发 specgate_frontend 和
specgate_backend；等待每一步提交；再派发 specgate_tester；
测试全通过后派发 specgate_formatter；最后派发 specgate_reviewer。
Blocking Review 必须进入新 round 并重新走完整闭环。
H3 后生成 DeliveryRecord 和客户交付包；未明确 push=true 时不得推送。
```

也可直接说“按 AGENTS.md 和 sg-codex Skill 的强制顺序执行”。Codex 会根据项目或 Skill 指令派发 subagents。

## 6. 阶段与工具

| 阶段       | Codex 主 Agent            | 子 Agent / MCP                                              |
| ---------- | ------------------------- | ----------------------------------------------------------- |
| 项目就绪   | 新建或 `sg_adopt_preview` | `sg_adopt_apply` / `sg_project_finalize_new`                |
| 需求确认   | `sg_change`               | H1、ChangeContract                                          |
| 测试设计   | `sg_test_design_prepare`  | `specgate_test_designer` → `sg_test_design_freeze`          |
| 前后端开发 | `sg_development_prepare`  | 串行派发 `specgate_frontend`、`specgate_backend`            |
| 集成       | `sg_development_run`      | MCP 校验 commit、路径、freeze 后代并合并                    |
| 测试       | 等待 Tester               | `specgate_tester` → `sg_quality_run`                        |
| 格式化     | 等待 Formatter            | `specgate_formatter` → `sg_format_run`                      |
| Review     | 等待 Reviewer             | `specgate_reviewer` → `sg_review_prepare` / `sg_review_run` |
| 交付       | H3                        | `sg_release_preview` / `sg_release_archive`                 |
| 高风险回修 | `sg_development_rework`   | 新一轮 frontend/backend/format worktree，重跑完整闭环       |

原生 Test runner 的 canonical 契约是：`--tests` 指向直接包含 `runner.mjs`
的绝对 `specgate-tests/` 根目录；所有测试资产相对该目录解析，不能再追加
一层 `specgate-tests/`。MCP 对早期已冻结的 runner 只在“没有生成报告”时做一次
父目录兼容回退；已经生成明确失败报告的 runner 不会被重试或掩盖。

Test Designer 必须在冻结前运行项目格式化、lint 与 import-order 检查。若冻结后
发现测试源码自身格式错误或 runner CLI 契约错误，使用
`sg_test_replace_assets` 由 Test Designer 提交受控修订；MCP 会保留旧 manifest
并生成带 reason 的 v2，不应把这类缺陷派给前后端开发 Agent。

## 7. 审批

portable `mcp.json` 显式设置：

```json
{
  "SPECGATE_INTERACTIVE_APPROVAL": "1",
  "SPECGATE_NATIVE_AGENTS": "1"
}
```

审批 actor 由启动 MCP 的 OS 用户派生，来源标记为 `codex-mcp-os-user`。它不是工具参数，也不能由模型提交。H1/H3 仍必须通过 Codex/MCP elicitation 展示给用户，绑定当前 artifact hash，并经过单次消费和持久审计。

若 Codex 客户端不声明 elicitation，或用户拒绝/超时，门禁保持 pending/blocked。不得自动批准。

在异步 control mode 中，H1/H3 会由 supervisor 创建 AttentionRequest，并将
ExecutionRun 转为 `WAITING_FOR_USER`。有效 Decision 后才恢复 Codex session。
普通 Web session 不足以批准 H1/H3、取消或客户验收，必须提供 TOTP step-up code。

`COMPLETION` 只有在 WorkItem 已绑定真实 schema 3 DeliveryRecord 时才提供
`accept_delivery`。接受动作先校验不可变 record hash，写入 append-only
`customer-acceptance.json`，再消费 Control Decision。没有 DeliveryRecord 的
控制任务只能要求修改，不会伪造“客户已接受”。

## 8. 故障检查

```bash
codex plugin marketplace list
codex plugin list
codex mcp list
node scripts/codex-source-setup.mjs --project <project> --check
```

若 Agent 未出现，检查：

- 是否在新会话中运行；
- `.codex/agents/` 是否有六个 `specgate_*.toml`；
- 项目是否信任并加载 `.codex/config.toml`；
- `AGENTS.md` 受管块是否存在；
- `git status --short` 是否仍显示 `.codex/` 或 setup 新建的 `AGENTS.md`；
- 若 `AGENTS.md` 原本已 tracked，是否已提交 setup 写入的受管块；
- Codex 是否启用 subagents（默认启用，也可显式设置 `[agents] enabled=true`）。

若曾用同一个 marketplace 名称安装旧版本，先删除旧插件和 marketplace，再重新添加：

```bash
codex plugin remove specgate-codex@<old-marketplace-name>
codex plugin marketplace remove <old-marketplace-name>
```

源码 marketplace 使用独立名称 `specgate-source`，避免个人 marketplace 中同名旧 catalog 覆盖新 checkout。

MCP server 不能自己创建 Codex subagent；它负责 prepare、challenge、commit 校验、evidence 和状态推进。派发动作必须由 Codex 主 Agent 执行，这是当前 Codex 公开控制面的边界。
