# SpecGate（sg）安装与配置指南：Windows / Linux

当前入口：`$sg-codex` 统一导航；`$sg-codex-env` 会话内环境预检与按需安装；`$sg-codex-project` 初始化/接入与基线；`$sg-codex-change` 需求开发及任务控制；`$sg-codex-status` 只读信息与状态。旧 `$sg-codex-setup` 仅兼容转接。环境安装不提供外部脚本，普通用户无需手工调用 MCP 工具。详见[会话内使用指南](environment-codex.zh.md)。本文源码配置命令仅供插件维护和排障，历史核查记录不代表本次已验证。

适用仓库：`GM-Studio/dsh_sg_plugin` 的 `sg-codex` 分支，插件名
`specgate-codex`，Skill 名 `sg-codex`，源码 marketplace 名 `specgate-source`。
本文核查日期：2026-10-22。工作流详解见 [源码 Quickstart](quickstart-codex-source.zh.md)。

## 1. 本机是否已经安装

此次核查针对 Windows 的 Administrator 用户、`C:\Users\Administrator\.codex`
配置目录和 `E:\ai_workflow\specgate` 源码目录，结果如下：

| 检查项           | 结果                                                          | 含义                                   |
| ---------------- | ------------------------------------------------------------- | -------------------------------------- |
| 源码             | 存在，分支 `sg-codex`；核查时 HEAD 为 `d65a6ab`               | 已有源码不代表已安装插件               |
| Node.js / npm    | `v24.14.0` / `11.9.0`                                         | 满足本项目 Node `>=20.19.0` 要求       |
| 终端默认 Codex   | npm shim 对应 `codex-cli 0.117.0`                             | 实测不支持 `codex plugin` 子命令       |
| 桌面端自带 Codex | `codex-cli 0.163.0-alpha.11`                                  | 实测提供 `plugin add/list/marketplace` |
| 实际用户插件记录 | 指定上述 `CODEX_HOME` 后，`plugin list --json` 无 SpecGate    | 未发现已安装的 SpecGate                |
| 用户 MCP 配置    | `mcp list --json` 无 SpecGate；`config.toml` 无 SpecGate 条目 | 未发现用户级手动接入                   |
| 本机插件缓存     | 未发现 SpecGate 目录                                          | 与插件记录一致                         |

结论：**在本次检查的用户配置范围内，SpecGate 尚未安装到 Codex。** 本次只核查
安装状态、编写文档，不会自动升级全局 Codex、安装插件或启动后台控制面。其他用户、
其他 `CODEX_HOME` 和业务仓库的项目级配置不属于这一结论的范围。

沙箱终端可能使用临时用户目录，不能直接把其中的空列表当作真实用户状态。复查时
应先确认 Codex 路径、`CODEX_HOME` 和启动项目目录；下面命令在用户自己的终端运行。

## 2. 安装方式如何选择

| 方式                          | 场景                             | 注意事项                                                            |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| 本地源码 marketplace（推荐）  | 开发、调试、单机使用             | `npm ci` 后安装插件；每个业务项目再运行 setup                       |
| Git marketplace               | 团队从仓库分发                   | 必须指定 `sg-codex` 分支；注册市场后仍须安装插件                    |
| 桌面端插件目录                | 希望在 UI 中选装                 | 注册本地市场后在插件目录选择 SpecGate，安装后开新会话               |
| 手动 MCP + Skill + 项目 Agent | 排查插件加载，或只需显式源码接入 | 需分别配置三个部分；仅连上 MCP 不等于完整工作流可用                 |
| npm 包 / 离线源码包           | 发布后分发，或无外网环境         | 当前仓库有打包配置；本文没有确认 npm 发布版本或公开插件目录上架状态 |

`npm install -g specgate-codex` 不是本仓库已验证的安装入口：包中没有 `bin`
命令。下载源码、执行 `npm ci`、复制 Skill、注册 marketplace、安装插件是不同步骤。
当前 `mcp.json` 启动的是本地 Node stdio 服务，不能直接把它当作远程 HTTP MCP URL。

## 3. 公共前置条件

- Git 可用；需要提交业务代码时已设置个人 `user.name` / `user.email`。
- Node.js `>=20.19.0` 和 npm 可用。源码开发安装执行 `npm ci`，使用 lockfile。
- Codex 已登录；所选二进制支持插件、原生 subagents、`exec --json` 和 session resume。
  不按版本号猜测能力，实际运行 `codex --help`、`codex plugin --help`、
  `codex exec --help`、`codex exec resume --help` 确认。
- Java/Vue 真实构建另需业务项目匹配的 JDK、Maven/Wrapper 和前端工具链。
  JDK 版本应跟随项目或所选 preset，不能统一写死为某一版本。

原文档曾声称 Codex 0.117.0 可直接使用插件命令；本机实测不成立，不能据此作为
最低兼容版本。本机桌面版的 alpha 版本只代表此次探测结果，不作为团队版本要求。
Codex 安装、登录方式以 [OpenAI 官方 CLI 指南](https://learn.chatgpt.com/docs/codex/cli)
为准；安装完仍须检查实际命中的可执行文件。

## 4. Windows：PowerShell 安装

### 4.1 选择正确的 Codex

```powershell
Get-Command codex -All | Select-Object Name, Source
codex --version
node --version
npm --version
git --version
```

普通安装可以通过 npm 安装或更新 Codex CLI，然后重开终端并检查能力：

```powershell
npm install -g @openai/codex@latest
codex --version
codex plugin --help
```

若仍无 `plugin`，检查 PATH 顺序，或选用已确认支持该命令的桌面端二进制。
此次机器可以使用以下路径；其中哈希目录随桌面更新而变化，其他机器必须替换：

```powershell
$Codex = 'C:\Users\Administrator\AppData\Local\OpenAI\Codex\bin\6257d9e8f63c0f2b\codex.exe'
& $Codex --version
& $Codex plugin --help
```

若当前 PATH 的版本已满足要求，可以改用：

```powershell
$Codex = (Get-Command codex).Source
```

`&` 用于执行变量中的路径，尤其适用于带空格的路径。后台 supervisor 需要能由
Node 直接启动的可执行文件；第 8 节应优先使用真实 `codex.exe`，避免指向 `.ps1` shim。
通常无需设置 `CODEX_HOME`；若有多个配置目录，应明确选择实际登录的那一个，
并让安装、启动会话和后台进程使用同一目录。

### 4.2 获取源码并安装插件

没有 checkout 时：

```powershell
git clone --branch sg-codex https://github.com/GM-Studio/dsh_sg_plugin.git E:\ai_workflow\specgate
```

已有 checkout（包括本机）直接进入目录；先检查分支和未提交变更，不要覆盖已有工作。

```powershell
$Source = 'E:\ai_workflow\specgate'
Set-Location -LiteralPath $Source
git branch --show-current
git status --short
npm ci
& $Codex plugin marketplace add $Source
& $Codex plugin add specgate-codex@specgate-source
& $Codex plugin list --marketplace specgate-source
```

最后一条应显示 `installed, enabled`。插件安装会使用缓存副本；修改 checkout
不等于缓存已更新，更新步骤见第 10 节。若要在桌面安装，注册市场后刷新或重启
桌面端，在插件目录选择 `SpecGate Source Checkout`，安装 `SpecGate for Codex`。
本地市场与缓存的机制见 [OpenAI 插件打包说明](https://developers.openai.com/plugins/build/plugins)。

### 4.3 给业务项目绑定 MCP 和六个 Agent

把路径换成已有业务仓库，不要把插件源码仓库误当作待接入项目：

```powershell
$Project = 'E:\projects\my-app'
node "$Source\scripts\codex-source-setup.mjs" --project $Project --check
node "$Source\scripts\codex-source-setup.mjs" --project $Project
node "$Source\scripts\codex-source-setup.mjs" --project $Project --check
& $Codex -C $Project mcp list
& $Codex -C $Project
```

首次 `--check` 的 `changed` 表示待写入文件，`ok: true` 不代表已经安装。
脚本的 check 模式仍可能创建缺失的项目、`.codex/agents` 目录；请传入正确路径。
正式 setup 后再次 check 应为 `changed: []`。信任该项目并重新启动 Codex 会话，
随后按第 7 节验收。PowerShell 续行使用反引号，Bash 续行使用反斜杠，不要混用。

## 5. Linux：Bash 安装

先用发行版或团队批准的方式安装 Git、Node.js 和 npm，确认 Node 满足版本要求。
Codex 可使用 npm，或按官方 CLI 指南使用独立安装器。使用 npm 的示例：

```bash
node --version
npm --version
git --version
npm install -g @openai/codex@latest
hash -r
type -a codex
codex --version
codex plugin --help
```

全局 npm 目录无写权限时，使用用户级 Node/npm 环境或独立安装器；不要混用 root
和普通用户的 Codex 配置。首次运行 `codex` 完成登录，再安装 SpecGate：

```bash
mkdir -p "$HOME/ai_workflow"
git clone --branch sg-codex https://github.com/GM-Studio/dsh_sg_plugin.git "$HOME/ai_workflow/specgate"
SG_SOURCE="$HOME/ai_workflow/specgate"
SG_PROJECT="$HOME/projects/my-app"
cd "$SG_SOURCE"
npm ci
codex plugin marketplace add "$SG_SOURCE"
codex plugin add specgate-codex@specgate-source
codex plugin list --marketplace specgate-source
node "$SG_SOURCE/scripts/codex-source-setup.mjs" --project "$SG_PROJECT" --check
node "$SG_SOURCE/scripts/codex-source-setup.mjs" --project "$SG_PROJECT"
node "$SG_SOURCE/scripts/codex-source-setup.mjs" --project "$SG_PROJECT" --check
codex -C "$SG_PROJECT" mcp list
codex -C "$SG_PROJECT"
```

已有源码时跳过 clone，确认是 `sg-codex` 分支。`SG_PROJECT` 替换为实际业务仓库。
Linux 路径区分大小写；路径包含空格时保留双引号。WSL 按 Linux 处理，建议源码与
业务项目均放在 WSL 文件系统，并在 WSL 内安装 Node/Codex，不复用 Windows 的
`.exe`、`node_modules`、插件缓存或项目级绝对路径配置。Linux 服务器可直接使用
CLI 和本地控制面，无需桌面端。

## 6. 其他分发和接入方式

### 6.1 Git marketplace

支持 Git 市场的 Codex 可直接注册本仓库：

```bash
codex plugin marketplace add https://github.com/GM-Studio/dsh_sg_plugin.git --ref sg-codex
codex plugin add specgate-codex@specgate-source
```

PowerShell 可把上面的 `codex` 换成 `& $Codex`。marketplace 名由 catalog 中的
`name` 决定，仍为 `specgate-source`。不要把同名本地市场和 Git 市场同时作为
两套独立安装维护；先用 `plugin marketplace list` 明确当前来源。

此方式仍需为业务项目运行 setup。可以另留同一版本的源码 checkout，按第 4/5 节
执行 setup；项目级 MCP 会绑定该 checkout，后续应保持其版本与插件缓存一致。
本文未执行 Git 远程安装验收，团队首次分发时应重新完成第 7 节。

### 6.2 手动接入 MCP、Skill 和 Agent

插件市场不可用时，可用源码 setup 生成项目级 MCP 和 Agent，再单独安装工作流
Skill。MCP 配置能力见 [OpenAI MCP 指南](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，
Skill 搜索位置见 [OpenAI Skills 指南](https://learn.chatgpt.com/docs/build-skills)。

Windows（沿用 `$Source` / `$Project`）：

```powershell
node "$Source\scripts\codex-source-setup.mjs" --project $Project
$SkillParent = Join-Path $Project '.agents\skills'
$SkillTarget = Join-Path $SkillParent 'sg-codex'
if (Test-Path -LiteralPath $SkillTarget) { throw 'Skill 已存在，请先比较内容，避免覆盖。' }
New-Item -ItemType Directory -Path $SkillParent -Force | Out-Null
Copy-Item -LiteralPath "$Source\skills\sg-codex" -Destination $SkillTarget -Recurse
```

Linux：

```bash
node "$SG_SOURCE/scripts/codex-source-setup.mjs" --project "$SG_PROJECT"
mkdir -p "$SG_PROJECT/.agents/skills"
if [ -e "$SG_PROJECT/.agents/skills/sg-codex" ]; then
  echo 'Skill 已存在，请先比较内容，避免覆盖。' >&2
else
  cp -R "$SG_SOURCE/skills/sg-codex" "$SG_PROJECT/.agents/skills/sg-codex"
fi
```

setup 会创建 `[mcp_servers.specgate_project]`，设置 `--project-root`、审批和原生
Agent 环境变量，并禁用标准插件的 `specgate` MCP，防止服务绑定插件缓存目录。
无需再给同一项目注册第二个用户级 MCP。若只排查 MCP 连接，可通过 `codex mcp add`
另行注册本地 stdio 服务，但这不会自动安装 Skill 或 Agent，亦不能证明完整流程兼容。
旧版 Codex 缺少所需原生 Agent/审批能力时，手动配置不能弥补，仍须升级或换用合适版本。

手工复制的 `.agents/skills/sg-codex` 不属于 setup 的自动 Git exclude 范围；请自行
决定团队共享提交或仅本地排除。不要同时加载手工副本和插件里的同名 Skill。

### 6.3 离线包与 npm 包

离线环境可传输审核过的 `sg-codex` 源码归档及依赖，解压到固定目录后采用本地
marketplace。安装依赖所需 npm 缓存也要预先准备；跨系统不要复制 `node_modules`。

仓库提供 `npm run pack:check` / `npm pack`，但并未据此证明 npm registry 已发布。
消费 npm 包前先核查包来源、版本与完整性，再决定是否新增 npm marketplace catalog。
不要直接改当前源码 catalog 的 `source` 并误称已发布；普通 npm 安装也不会自动完成
Codex 插件注册。离线包能否完成业务构建，还取决于模型服务、Maven 和前端依赖可达性。

## 7. 配置位置与安装验收

| 配置或文件      | Windows / Linux 位置与用途                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------ |
| 用户 Codex 配置 | 默认 `%USERPROFILE%\.codex\config.toml` / `~/.codex/config.toml`；显式 `CODEX_HOME` 时改用该目录 |
| 源码市场        | 插件仓库 `.agents/plugins/marketplace.json`，注册的是仓库根目录                                  |
| 插件入口        | 根目录 `plugin.json` / `mcp.json`；兼容入口 `.codex-plugin/plugin.json` / `.mcp.json`            |
| 项目配置        | 业务项目 `.codex/config.toml` 中的 SpecGate 受管块                                               |
| 原生 Agent      | 业务项目 `.codex/agents/specgate_*.toml`，共六个                                                 |
| 工作流指令      | 业务项目 `AGENTS.md` 中的 `specgate-codex:begin/end` 受管块                                      |
| 本地排除        | Git `info/exclude`，排除 `.codex/` 和未 tracked 的 `AGENTS.md`                                   |
| 项目状态        | 业务项目 `.specgate/`；由 MCP 管理，不手改状态、hash 和证据                                      |
| 控制面状态      | 默认 Codex home 下 `specgate-control/`；可用 `SPECGATE_CONTROL_HOME` 指定                        |

setup 保留已有非受管配置，拒绝覆盖内容冲突的同名 Agent；`AGENTS.md` 已 tracked
时会报告修改，需要按项目规则提交后再进入测试设计。不要用 exclude 隐藏已 tracked
文件的修改。迁移操作系统或源码目录后，应重新运行 setup 更新绝对路径。

在新的、信任该业务项目的 Codex 会话中逐项检查：

1. 插件方式下，`plugin list --marketplace specgate-source` 显示已安装且启用。
2. 从业务项目执行 `mcp list`，检查 `specgate_project` 启用；会话内用 `/mcp`
   检查实际连接。列表启用只表示配置，成功工具调用才是运行证据。
3. setup check 的 `changed` 为空，六个 Agent 和 `AGENTS.md` 受管块存在。
4. 能看到 `sg-codex` Skill，并能调用 `sg_project_status`，确认返回的项目路径正确。
5. 新项目按 `sg_init_preview` / `sg_init` / `sg_verify` / `sg_project_finalize_new`
   建立基线；存量项目用 `sg_adopt_preview` / `sg_adopt_apply`，随后查询状态等待
   `projectReady: true`。安装完成不代表业务项目已通过基线。

之后可以要求：`按 AGENTS.md 和 sg-codex Skill 执行当前需求，先检查项目基线。`
H1/H3 必须由真实用户审批；没有客户端审批能力时保持 pending/blocked，不得自动放行。

## 8. 可选：异步 supervisor、Web 管理台与飞书

交互式插件安装不要求启动后台服务。需要会话关闭后继续执行 WorkItem 时，在普通
用户终端从源码目录启动控制面；先生成 TOTP secret，并安全保存在本机受控环境中：

```text
npm run codex:control -- mfa
```

将 secret 加入认证器，再在启动 daemon 的同一终端设置环境。下面均为占位值，
不得直接复制为真实凭据，也不要提交 secret、webhook、配对链接或 Codex 登录文件。

Windows：

```powershell
Set-Location -LiteralPath $Source
$env:SPECGATE_CODEX_COMMAND = $Codex
$env:SPECGATE_CODEX_SANDBOX = 'workspace-write'
$env:SPECGATE_MFA_SECRET = '<刚生成的 TOTP secret>'
# 以下两项仅在需要飞书和远程管理时设置
$env:SPECGATE_FEISHU_WEBHOOK_URL = '<飞书机器人 webhook URL>'
$env:SPECGATE_MANAGEMENT_PUBLIC_URL = 'https://management.example.com/'
npm run codex:control -- doctor --project $Project
npm run codex:control -- start --project $Project
npm run codex:control -- status
```

Linux：

```bash
cd "$SG_SOURCE"
export SPECGATE_CODEX_COMMAND="$(command -v codex)"
export SPECGATE_CODEX_SANDBOX='workspace-write'
export SPECGATE_MFA_SECRET='<刚生成的 TOTP secret>'
# 以下两项仅在需要飞书和远程管理时设置
export SPECGATE_FEISHU_WEBHOOK_URL='<飞书机器人 webhook URL>'
export SPECGATE_MANAGEMENT_PUBLIC_URL='https://management.example.com/'
npm run codex:control -- doctor --project "$SG_PROJECT"
npm run codex:control -- start --project "$SG_PROJECT"
npm run codex:control -- status
```

仅本机使用时跳过两项可选变量。默认管理地址为 `http://127.0.0.1:43120`；`start`
返回一次性 `pairingUrl`，用其建立浏览器会话。远程访问应使用受认证的 HTTPS
代理或隧道，不能把本机回环 URL 填进异地飞书卡片。高风险操作还需 TOTP step-up。

`doctor` 的 `ok` 仍只反映 Codex `--version` 能否运行，并报告配置；`ok: true` 不
证明插件、模型认证、原生 Agent、H1/H3 或完整交付已经通过。除此之外，`doctor`
会对宿主 Codex 做只读、非交互、限时的能力探测，并在结果的 `capabilities` 中报告：

- `states`：`plugin`、`execJson`（`exec --json`）、`nativeAgents`（原生 subagents）
  和 `elicitation` 每项为 `available`、`missing` 或 `not-probed`。
- `mode`：有效运行模式，`native` 或降级后的 `project-mcp-skill`。
- `degradations`：触发的显式降级项（如 `plugin-unavailable`）。
- `blocked`：被阻塞的能力（如 `subagents`、`interactive-gates`）。
- `versionGateHint`：升级或降级提示。

探测只运行只读 `--help`、不挂 stdin 且有超时；`missing` 和 `not-probed` 都按不可用
保守降级，不会静默失败：缺少 `plugin` 走项目级 MCP + Skill 路径，缺少 elicitation
时人工门禁保持 pending。supervisor 会隔离宿主
MCP，仅注入项目绑定的 `specgate_control`，并过滤子进程环境。工具链依赖额外
变量时用 `SPECGATE_CODEX_ENV_ALLOWLIST` 显式放行，例如 `JAVA_HOME,MAVEN_HOME`。
飞书 webhook 和 MFA secret 不传给工作子进程。

可用 `SPECGATE_CODEX_HOME` 选择子 Codex 的配置/登录目录；
`SPECGATE_CONTROL_HOME` 决定 daemon 状态位置，两者作用不同。修改环境后需要
停止并重新启动 daemon。默认同一 control home 绑定一个项目，换项目应停止重绑，
或设置另一个 control home 和管理端口 `SPECGATE_MANAGEMENT_PORT`。

控制面支持两种模式（多项目注册表与聚合投影已落地，聚合控制台的完整接线仍在本分支
推进）：

- 聚合（aggregate，默认）：一个控制 home、一个管理端口登记并汇总多个项目，
  聚合视图按项目汇总注意力首页与队列。
- 隔离（isolated）：每个项目使用独立控制 home
  （`<controlRoot>/projects/<projectId>`）和确定性端口，互不共享 MCP 配置、凭据与状态。

在聚合控制台接线完成前，也可用 `SPECGATE_CONTROL_HOME` 与
`SPECGATE_MANAGEMENT_PORT` 为不同项目指定不同控制 home 和端口来实现隔离。控制面的
Web 会话与配对 token 会持久化到控制 home 下的 `web-sessions.json`，daemon 重启后
在其 TTL 内仍然有效，无需重新配对。

```text
npm run codex:control -- list
npm run codex:control -- attention
npm run codex:control -- stop
```

`stop` 保留 WorkItem 和证据；停止时使用与启动相同的 control home。
Windows/Linux 都通过受控停止请求退出。本项目 daemon 的 detached 运行不等于
操作系统开机自启；需常驻时另配任务计划程序或 systemd，并固定工作目录、Node、
Codex、用户身份和受控环境。不要把调度器密码或凭据写进仓库。

## 9. 常见问题

| 现象                                                     | 排查与处理                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| `unexpected argument 'marketplace'` 或无 `plugin` 子命令 | 检查实际 Codex 路径；本机旧 npm CLI 会遮住桌面版                    |
| 市场已添加但没有工具                                     | 市场注册不等于安装；安装后新开会话，检查项目 trust 和 `/mcp`        |
| MCP 状态指向插件缓存                                     | 运行项目 setup，使用 `specgate_project` 显式绑定业务项目            |
| Agent 不出现                                             | 检查六个 TOML、受管指令、项目配置加载与所用 Codex 的 subagents 能力 |
| `AGENT_CONFLICT` / `MCP_CONFIG_CONFLICT`                 | 比较自定义内容，解决冲突后重试，不强行覆盖                          |
| setup check `ok: true` 但 `changed` 非空                 | 这只是待变更预览；执行正式 setup 再复查                             |
| Windows 控制面 doctor 无法启动 Codex                     | 使用真实 `.exe` 路径，确认启动用户的 PATH/登录目录                  |
| `doctor` 成功但交付失败                                  | 检查真实工具调用、认证、项目基线、JDK/Maven、Agent 和审批证据       |
| supervisor 无法在宿主沙箱中创建子进程                    | 在普通用户终端或独立 Linux VM 启动控制面，保留默认安全边界          |
| Linux/WSL 配置引用 `E:\...`                              | 重新执行 Linux 内的 setup，生成 Linux 绝对路径                      |

## 10. 更新、卸载与验证范围

源码方式更新前先确认工作区干净，再在 `sg-codex` 分支执行：

```bash
git pull --ff-only
npm ci
codex plugin add specgate-codex@specgate-source
```

对每个业务项目重新运行 setup/check 并开新会话；同名 Agent 模板升级可能触发
冲突，需人工比较。Git marketplace 可先用
`codex plugin marketplace upgrade specgate-source` 刷新来源。若缓存未刷新，
先用 `plugin list` 核对，再移除和重装插件。

卸载插件/市场（PowerShell 使用所选 `$Codex`）：

```bash
codex plugin remove specgate-codex@specgate-source
codex plugin marketplace remove specgate-source
```

插件卸载不会撤销 setup 的项目级配置或停止独立 daemon。需要完全停用时先 stop，
再审核移除项目中的 SpecGate 受管块、六个受管 Agent、手工 Skill 和本地 exclude
受管段；保留其他配置及业务数据。项目 `.specgate/` 和控制面证据按团队保留策略处理。

本文的本机状态来自 Windows 实际命令和配置检查；Linux 步骤由仓库跨平台脚本及
官方文档核对，没有在本次任务中实际执行 Linux 安装。MCP smoke 只验证协议诊断，
不等于宿主插件安装、原生 subagent、人工审批或完整 Java/Vue 交付通过。
