# SpecGate 全仓工作流与环境准备链路评审

评审日期：2026-10-30。对象：`specgate-codex@0.3.4`，分支 `sg-codex`，HEAD `54e80c4503b78faffabd3924046b106a2b55743f` 及当前工作树。

后续修复状态与真实双平台验收另见[F01—F04修复结果](2026-10-30-environment-repair-results.zh.md)。以下内容保留初始审查时点的结论和证据。

**结论：当前实现不能通过本次目标验收。** 固定 Java 组合的环境发现能真实复用工具；默认 Core 的“用户自定义栈 → 环境复用 → 缺项审批 → 安装配置 → 复验 → 继续执行”链路未实现完整闭环。存量项目存在接入后环境门禁反而阻断的实际复现，新项目环境选择与自动安装入口未在默认发行版公开。不能通过启用历史工具开关来宣称问题已解决。

本次没有修改产品源码、原有配置和既有评审文件，没有在本仓库提交或推送。新增内容为本报告、审查证据和临时复现脚本。临时 Git 项目的提交、审批 provider 和故障注入只用于隔离测试，不是本仓库提交、真实业务验收或真人审批。

## 待补充信息与判定口径

以下信息尚未给定，列为后续真实环境验收输入，不阻碍下文已有证据的判断：

1. 目标 Codex 桌面版/CLI 版本、插件安装来源及升级策略；当前已安装缓存与仓库虽同为 0.3.4，内容不同。
2. 必须支持的 OS/发行版/CPU 矩阵，尤其 macOS、Windows ARM64、Linux ARM64，以及容器、WSL、代理和离线要求。
3. Node/Python/Go/Java 的版本范围与包管理器范围；是否需要 Gradle、pnpm、Yarn、uv、Poetry、虚拟环境和 wrapper。
4. 安装位置、允许的下载源、证书/代理、系统权限边界，是否允许用户级持久化环境修改。
5. 环境验收最低命令、业务验收标准、人工审批宿主、客户最终验收与 H3 的区别。

严重级别：P1 为阻断目标链路、损害环境/验收可信性或恢复能力的重大问题；P2 为功能或可靠性缺陷；P3 为轻微问题。本轮没有确认 P0。明确区分默认 Core、源码可选模式、历史脚本和当前已安装缓存；没有将历史文档或单元测试通过当作当前真实 E2E 通过。

## 1. 全量扫描与实际执行路径

**结论：已建立全仓文件清单并扫描内容；实际存在三套能力边界。** 扫描了 1065 个跟踪及非忽略未跟踪项目文件，267289 行，其中 `src` 192 文件/69501 行，`test` 133 文件/35692 行，`scripts` 17 文件，`assets` 157 文件，`docs` 493 文件，`openspec` 37 文件。逐文件读取、记录大小与 SHA-256，JSON 解析未见错误；这不是逐行人工审核全部 26 万行的声明。

扫描清单见[清单](../analysis/env-chain-audit-20261030/inventory.json)。排除 Git 对象库、第三方 `node_modules`、忽略的运行时/缓存/构建产物及 `.tmp` 临时审计材料；这些不是本项目实现。核心执行路径、危险变更点、配置、脚本、模板和运行文档另作定向走查，并运行全量测试。

实际路径：

```text
plugin.json / .codex-plugin/plugin.json → mcp.json → node src/codex/server.js
  → protocol.js / peer.js → workflow-tools.js
  → sg_project_bind → project-detect / sg_adopt_preview
  → sg_adopt_apply → baseline-job → baseline-worker → ProjectProfile / Baseline
  → change-add → H1 → plan / frozen tests → development
  → quality → format → 再跑 quality → review → H3 → release / DeliveryRecord

环境独立入口：sg_env_check → core/environment.js → java/java-env.js
历史可选入口：SPECGATE_OPTIONAL_MODULES=1 → 新建、初始化、环境安装、控制面
历史独立脚本：scripts/install-env.{ps1,sh,mjs}（不等于默认 MCP 安装链）
```

**证据（文件与位置）：** [server.js:94](E:/ai_workflow/specgate/src/codex/server.js:94)、[workflow-tools.js:38](E:/ai_workflow/specgate/src/codex/workflow-tools.js:38)、[workflow-tools.js:915](E:/ai_workflow/specgate/src/codex/workflow-tools.js:915)、[package.json:28](E:/ai_workflow/specgate/package.json:28)、[README.md:19](E:/ai_workflow/specgate/README.md:19)。实际 registry 探针显示默认 43 工具、可选模式 54 工具；默认缺少 `sg_env_prepare`、`sg_project_create`、`sg_init`、`sg_project_setup`。

**风险等级：P1。** 入口描述、历史 Skill、源代码存在和发行包公开能力容易混淆。

**修复建议：** 对每项能力登记“实现—注册—打包—宿主装载—实际执行—验收”的追踪关系。默认协议 `instructions` 和插件介绍应与真实工具清单一致；目前 [protocol.js:53](E:/ai_workflow/specgate/src/codex/protocol.js:53) 仍指导调用未公开的安装、新建能力。

## 2. 稳定性评估

**结论：不能判定稳定可用。** 真实环境发现、命令执行、隔离依赖准备和归档恢复存在断点。最关键的三个复现：

- 真实 Windows 只读探测确认 Git 2.45.1、Node 24.14.0/npm 11.9.0、JDK 17.0.18、Maven 3.9.11，返回 `environmentReady=true`。但同一进程的基线执行器调用 `mvn -v` 失败；改用发现到的绝对路径，仍因缺少正确 `JAVA_HOME` 失败。发现用的进程环境未传递给后续基线命令。
- 一个真实临时 Node 项目在原工作树测试成功；隔离基线没有原工作树忽略的依赖，测试报 `MODULE_NOT_FOUND`，却形成 `known-failures`、`projectReady=true`。环境基础设施故障被容忍为既知基线。
- 注入交付目录写入失败后，归档返回 `UNSAFE_ARTIFACT_PATH`，目标分支已快进到受评审提交；修复目录后重试返回 `ARCHIVE_PREVIEW_CHANGED`，重新请求 H3 又因仍在 `ARCHIVING` 返回 `INVALID_TRANSITION`。

**证据（文件与位置）：** [environment.js:97](E:/ai_workflow/specgate/src/codex/core/environment.js:97)、[baseline.js:129](E:/ai_workflow/specgate/src/codex/baseline.js:129)、[project-command.js:9](E:/ai_workflow/specgate/src/codex/core/project-command.js:9)、[project-detect.js:118](E:/ai_workflow/specgate/src/codex/project-detect.js:118)、[baseline.js:260](E:/ai_workflow/specgate/src/codex/baseline.js:260)、[project-model.js:241](E:/ai_workflow/specgate/src/codex/project-model.js:241)、[release.js:405](E:/ai_workflow/specgate/src/codex/release.js:405)。本轮新证据分别见[真实环境](../analysis/env-chain-audit-20261030/actual-discovery.json)、[接入复现](../analysis/env-chain-audit-20261030/adoption-probe.json)、[工作流故障复现](../analysis/env-chain-audit-20261030/workflow-repros.json)。

还发现 detached 基线启动先清理该仓库匹配的 worktree 并递归删除旧任务目录，没有在 `startBaselineJob` 中先检查活跃任务/取得同仓库锁；重复调用可能破坏运行中的基线。[baseline-job.js:66](E:/ai_workflow/specgate/src/codex/baseline-job.js:66)、[baseline-job.js:139](E:/ai_workflow/specgate/src/codex/baseline-job.js:139)。这是静态确认的并发风险，本轮没有另启动并发故障实验。

**风险等级：P1。**

**修复建议：** 用同一份已验证执行上下文贯穿发现、安装、worktree、基线、质量与格式化；基础设施错误阻断基线；基线任务使用同仓库互斥和所有权校验；归档加入可恢复日志，先验证可写与全部前置条件，再执行快进，快进后允许按同一 operation ID 幂等补记证据。

## 3. 端到端评估与实际验证

**结论：MCP 启动及合成生命周期可以运行；本次要求的多栈环境准备端到端不通过。** 不能用 `codex:smoke` 或大批函数测试的绿灯替代真实审批、下载安装及继续推进的证明。

| 本轮检查                  | 实际结果                                              | 证明范围/限制                                                                                            |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 指定 7 文件聚焦测试       | 76/76 通过                                            | 环境计划、发现边界、兼容判定、能力推导、安装方案、栈发现、项目发现的现有断言                             |
| `npm test`                | 1141 项：1139 通过、1 失败、1 跳过，退出 1            | 失败为当前未提交 `.mcp.json` 配置不一致；跳过为当前平台不支持该 symlink 测试                             |
| `npm run lint`            | 退出 0                                                | 静态规范                                                                                                 |
| `npm run format:check`    | 退出 1                                                | 当时已有 `.tmp/audit-20261030` 的 4 个文件及原有评审报告格式不合规；保留用户内容                         |
| `npm run pack:check`      | 默认缓存因沙箱 EPERM 失败；改工作区缓存后退出 0       | dry-run 150 文件；不等于真实宿主安装                                                                     |
| `npm run codex:smoke`     | 退出 0                                                | `stdio-diagnostics`，仅 health/version/status；hostInstallation、trustedApproval、subagents 均为 not-run |
| 本轮栈样例探针            | 6 类已知构建文件可发现，环境全部 `ENV_STACK_REQUIRED` | Node/React/Vue/Python/Go/普通根 POM；安装入口均 `UNKNOWN_TOOL`                                           |
| 本轮真实工具复用          | 固定 Java17+React 选择下环境探测通过                  | Maven 后续执行失败，不能算准备 E2E 通过                                                                  |
| 本轮隔离接入/交付故障探针 | 成功复现缺陷                                          | 临时 Git 项目与合成 provider；不是业务验收或真人回执                                                     |

**证据（文件与位置）：** 原始输出在[本轮证据目录](../analysis/env-chain-audit-20261030/)。[scripts/run-tests.mjs:9](E:/ai_workflow/specgate/scripts/run-tests.mjs:9) 将 5 个 MySQL 测试文件放在显式外部套件，本轮没有运行；[codex-plugin-smoke.mjs:103](E:/ai_workflow/specgate/scripts/codex-plugin-smoke.mjs:103) 和 [:137](E:/ai_workflow/specgate/scripts/codex-plugin-smoke.mjs:137) 明确冒烟边界。全量中的离线 tarball 装载及合成完整交付测试本轮通过，不能沿用其他旧评审里的失败结果。

历史 Windows/Linux 平台证据存在，但引用其他提交，不是本 HEAD 的复验：[platform-linux-x64.json:23](E:/ai_workflow/specgate/docs/verification/stack-neutral-adoption/platform-linux-x64.json:23)、[platform-win32-x64.json:22](E:/ai_workflow/specgate/docs/verification/stack-neutral-adoption/platform-win32-x64.json:22)。真实业务金丝雀最新书面进度仍标注质量、Review、H3 和交付未完成：[10-m6-verification.md](E:/ai_workflow/specgate/docs/implementation/specgate-core-mvp-v2/10-m6-verification.md)。是否有更晚的仓库外完成记录：**待确认**。

**风险等级：P1。**

**修复建议：** 按本报告末尾矩阵建立可重复环境 E2E；真实下载安装只在展示确切方案并获得对应用户批准之后执行。当前没有执行真实下载、系统安装、原生 AI 角色、Linux/macOS 实机或生产部署，不登记为通过。

## 4. Codex 安装、配置与装载

**结论：可以基于 Codex 实现，当前已有可工作的 stdio MCP/Skill 结构；所需环境闭环没有随默认插件交付。** 官方文档支持根 `plugin.json`/`mcp.json` 和 Codex 兼容布局，仓库的入口方案方向可行。[OpenAI 官方插件打包文档](https://developers.openai.com/plugins/build/plugins)

**证据（文件与位置）：** [plugin.json:14](E:/ai_workflow/specgate/plugin.json:14)、[.codex-plugin/plugin.json:9](E:/ai_workflow/specgate/.codex-plugin/plugin.json:9)、[mcp.json:5](E:/ai_workflow/specgate/mcp.json:5) 配置本地 Node stdio。当前会话已安装插件 `health` 真实返回 ok；仓库自己的 MCP 冒烟通过。当前工作树 [.mcp.json:3](E:/ai_workflow/specgate/.mcp.json:3) 的 `mcpServers={}` 与 `mcp.json` 不同，导致 [codex-plugin-package.test.js:76](E:/ai_workflow/specgate/test/codex-plugin-package.test.js:76) 实际失败；兼容 manifest 显式引用的是 `mcp.json`，所以不能把空 `.mcp.json` 解释为所有加载路径均失败。

此外，当前缓存 `C:/Users/Administrator/.codex/plugins/cache/specgate-source/specgate-codex/0.3.4` 的环境 Skill 仍宣称自动安装，与仓库只读 Core Skill 内容和哈希不同。当前已装工具面还公开 prepare/create，仓库默认面没有它们。**当前会话插件不能代表本工作树交付物。**

原生角色通过 [native-role-agent.js:268](E:/ai_workflow/specgate/src/codex/native-role-agent.js:268) 的 `SPECGATE_CODEX_COMMAND`/`codex exec` 单独进程运行，依赖可执行文件、认证、该 CLI 的参数支持和读写权限；`sg_env_check` 的 required 清单未检查这些能力。可信 H1/H3 使用 [server.js:97](E:/ai_workflow/specgate/src/codex/server.js:97)、[host-input.js:38](E:/ai_workflow/specgate/src/codex/host-input.js:38)、[approvals.js:115](E:/ai_workflow/specgate/src/codex/approvals.js:115) 的宿主身份和关联表单，不应将 peer 的 `trustedUserIdentity:false` 单独误读为审批永久失效：服务端会独立传入身份。

**风险等级：P1（目标能力缺口及当前工作树配置），P2（版本/缓存漂移与宿主兼容未验）。**

**修复建议：** 统一入口声明，发布可区分的新版本，增加安装包内容指纹和 tool-surface 对比；从确切发行包在新 Codex 会话测试。补齐 Node 缺失时的宿主引导和 Codex 执行器/认证诊断；不要让尚未启动的 Node MCP 负责修复自身。不能仅开启可选标志：发行 `files` 明确排除了初始化、安装等模块及相关模板/安装脚本。

## 5. 存量与新建项目接入

**结论：存量项目可以发现、预览和建立基线，但通用后续链路不通；新项目的自定义技术栈环境准备在默认 Core 未实现。**

| 项目类型                                      | 发现/选择                           | 复用                   | 缺项审批安装                        | 后续执行                                               |
| --------------------------------------------- | ----------------------------------- | ---------------------- | ----------------------------------- | ------------------------------------------------------ |
| 存量 Java17/Boot3.5 + 标准 frontend Vue/React | 有固定布局推断                      | 当前 Windows 探测可用  | 默认未实现；可选仅固定组件          | 发现的工具环境未贯穿基线执行                           |
| 存量纯 Node/React/Vue                         | 能识别 package.json                 | 环境入口要求 Java 组合 | 默认未实现                          | 接入后 `ENV_STACK_REQUIRED`；根目录 formatter 也不支持 |
| 存量 Python/Go/Gradle                         | 能识别构建标记                      | 未接入通用环境服务     | 默认未实现；无 Python/Go 安装适配器 | 项目命令发现仍只产生 Maven 与前端脚本，不能验证对应栈  |
| 新建用户选择 Node/Python/Go/Java 等           | 默认未实现通用 StackSpec 表单       | 无通用入口             | 默认未实现                          | 不能证明闭环                                           |
| 源码可选新建                                  | 只可选 3 种 Java preset + Vue/React | 固定组件发现           | 有历史安装服务                      | 不是通用栈，且默认发行包不含完整实现                   |

**证据（文件与位置）：** [project-detect.js:231](E:/ai_workflow/specgate/src/codex/project-detect.js:231) 调用通用发现，却在 [:288](E:/ai_workflow/specgate/src/codex/project-detect.js:288) 用旧前后端命令拼接，未使用通用工具链套件；[project-adopt.js:92](E:/ai_workflow/specgate/src/codex/project-adopt.js:92) 将所有 profile 写成 `java-vue`；[project-model.js:142](E:/ai_workflow/specgate/src/codex/project-model.js:142) 只允许该标签；[workflow-tools.js:1048](E:/ai_workflow/specgate/src/codex/workflow-tools.js:1048) 在 profile 存在后强制调用旧环境检查；[onboarding.js:20](E:/ai_workflow/specgate/src/codex/onboarding.js:20) 固定后端选择；[skills/sg-codex-project/SKILL.md:15](E:/ai_workflow/specgate/skills/sg-codex-project/SKILL.md:15) 明确 Core 不新建。

本轮[接入复现](../analysis/env-chain-audit-20261030/adoption-probe.json) 确认 `javascript-npm → profile java-vue → baseline known-failures/ready → sg_development_prepare ENV_STACK_REQUIRED`。这不是仅根据命名猜测。

**风险等级：P1。**

**修复建议：** 存量由事实推导 ToolRequirements，新建由用户选择 StackSpec，二者进入同一环境状态机；环境准备应可以独立于模板生成运行。先支持项目的根目录、workspace、多模块和锁文件，再衔接业务流程。Python/Go 的模板生成不必成为这轮环境闭环的前置范围。

## 6. 操作系统、技术栈及其他依赖

**结论：目前不满足操作系统与技术栈可替换的目标。** 可以建立跨平台适配，但当前支持边界不能描述成任意 OS/任意栈。

| 实际依赖                                             | 依据                                                                                           | 影响                                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 本地 Node 运行时                                     | package.json:64、mcp.json:7                                                                    | 插件启动要求 Node >=20.19；业务发现另限制 Node 22.12+/24，需区分宿主 Node 与项目 Node           |
| Windows/Linux x64                                    | core/environment.js:142                                                                        | darwin、arm64 在环境计划阶段直接 `ENV_PLATFORM_UNSUPPORTED`；platform.js:13 只预留 macOS/ARM64  |
| 固定 Java8/17/21、Boot2.7/3.5、Maven3.9 与 Vue/React | environment.js:145、java/java-env.js:464、:549、onboarding.js:20                               | 纯前端、Python、Go、Java11/25、Gradle 等不能按真实约束准备环境；Node24 也可能不满足项目锁定版本 |
| Git、附着分支、干净工作树、worktree                  | project-adopt.js:85、project-state.js:206、baseline-worker.mjs:111                             | 无 Git/空历史/脏文件不能直接当 ready；Git 身份与写 Git 元数据权限为前置条件                     |
| 独立 Codex 执行器、认证与宿主表单                    | native-role-agent.js:268、host-input.js:38、environment-tools.js:63                            | 有桌面聊天能力不等于指定 CLI 可运行；表单通道缺失阻断审批，当前缺项安装比 H1 更严格要求能力广告 |
| tar、HTTPS、下载源、校验值、用户目录权限             | environment-install.js:129、:152、:175；environment-catalog.js:58                              | 可选安装依赖解压程序及网络；没有独立预检 tar；真实镜像可达性和当前校验值未在本轮联网下载验收    |
| 项目包管理器、锁文件、依赖仓库与代理                 | project-detect.js:118、core/env/install.js:8                                                   | pnpm/Yarn/uv/Poetry 的可执行环境与锁文件语义未统一接入；存在目录不代表隔离工作树有可用依赖      |
| 历史远程控制的 MySQL、systemd/Caddy、凭据            | scripts/run-tests.mjs:9、deploy/systemd/specgate-control.service:12、deploy/mysql/backup.sh:69 | 仅可选源码路径；不应把 MySQL/Linux 服务部署说成默认 Core 的必需依赖，相关 E2E 本轮未验          |

通用发现只扫描 root 加有限顶层目录，[core/discovery/stack.js:211](E:/ai_workflow/specgate/src/codex/core/discovery/stack.js:211)。本轮 `apps/web/package.json + services/api/go.mod` 没有被发现；超过预算的结构也需要“扫描不完整”而非无项目结论。存量 symlink/特殊文件保护见 [project-detect.js:67](E:/ai_workflow/specgate/src/codex/project-detect.js:67)，会影响一些现成 `.venv` 与链接式目录布局，需定义安全复用边界。

**风险等级：P1（平台/栈阻断），P2（布局和版本约束）。**

**修复建议：** 以 OS/CPU/provider 注册表封装执行、探测、下载与配置；以项目真实版本约束选择工具。读取 `engines`、`packageManager`、`.nvmrc`、`requires-python`、`go.mod`、Java toolchain/wrapper，明确受支持语法并拒绝不确定兼容状态。先交付有验收证据的矩阵，再扩大支持范围。

## 7. 缺依赖提示、用户确认、下载安装及继续推进

**结论：默认链路未实现；源码可选模式部分实现；历史独立脚本不符合要求的审批式闭环。**

默认 `sg_env_check` 只报告，`sg_env_prepare` 被过滤且 installer 被排除出包；[skills/sg-codex-env/SKILL.md:10](E:/ai_workflow/specgate/skills/sg-codex-env/SKILL.md:10) 和 [docs/environment-codex.zh.md:3](E:/ai_workflow/specgate/docs/environment-codex.zh.md:3) 直接说明由用户/维护者补齐。

可选服务的确有“重查 → consent → 逐项安装 → 再探测”：[environment.js:233](E:/ai_workflow/specgate/src/codex/core/environment.js:233)，下载先验证固定 checksum，失败保持阻塞：[environment-install.js:151](E:/ai_workflow/specgate/src/codex/core/environment-install.js:151)。不能说仓库完全没有安装代码。但 catalog 只覆盖 Node/Maven/JDK；Git 返回 `ENV_HOST_INSTALL_REQUIRED`，没有自动执行宿主安装并自动恢复的实现，Python/Go installer 未实现。安装表单还要求 advertised elicitation，而 H1 可以尝试真实通道；本轮缺广告探针中安装请求数为 0，没有触发确认。

`core/env/capability.js`、`compatibility.js`、`install-plan.js`、`post-install-verify.js` 的单元测试存在，但导出能力没有在真实环境主入口中被消费，不能据此认定需求闭环已交付。安装方案应有任务用途、组件、版本、来源、校验、位置、配置变化、权限；当前实际 consent 未使用该完整审批契约，缺少可恢复的 plan/receipt 绑定。

历史 `scripts/install-env.ps1/.sh` 在 Node 不可用时会先安装/下载 Node，之后才将 `--check` 转给 mjs；因此“只检查”也可能写环境。包装脚本直接解压下载文件，没有 checksum 验证；mjs 默认准备全部 6 类工具（包含 3 个 JDK），自动尝试包管理器和归档，默认写用户配置，未接入对应可信方案审批。该风险限定于显式运行历史脚本，**不是默认 MCP 已执行了这些操作**。

**证据（文件与位置）：** [environment-tools.js:58](E:/ai_workflow/specgate/src/codex/environment-tools.js:58)、[environment-install.js:103](E:/ai_workflow/specgate/src/codex/core/environment-install.js:103)、[install-env.ps1:34](E:/ai_workflow/specgate/scripts/install-env.ps1:34)、[install-env.sh:26](E:/ai_workflow/specgate/scripts/install-env.sh:26)、[install-env.mjs:528](E:/ai_workflow/specgate/scripts/install-env.mjs:528)、[install-env.mjs:599](E:/ai_workflow/specgate/scripts/install-env.mjs:599)。

**风险等级：P1。**

**修复建议：** 建立持久的 `DISCOVERED → PLAN_READY → WAITING_APPROVAL → INSTALLING → VERIFYING → READY/BLOCKED` 流程；用户批准精确 planHash 后才下载、安装和改配置；取消/拒绝零变更；变更版本、源、目录、配置或权限必须重批。默认用户/项目隔离配置，系统提权独立审批；通过复验后将上下文交回原接入/新建操作，从同一 checkpoint 继续。

## 8. 验收标准、真实执行与人工审批门禁

**结论：并非没有验收/人工门禁；已实现一部分严格机制，但不足以支持“每次都真实合格且之后才进入后续审批”的完整保证。**

已实现的证据：

- H1/H3 由服务端可信身份、关联请求、短期 handle、对象哈希、审计和消费约束控制；工具参数不能直接构造批准。[approvals.js:115](E:/ai_workflow/specgate/src/codex/approvals.js:115)、[:332](E:/ai_workflow/specgate/src/codex/approvals.js:332)、[state-machine.js:342](E:/ai_workflow/specgate/src/codex/state-machine.js:342)。
- 冻结用例映射 AC，运行 green 报告，检查日志、退出状态和覆盖率；固定 Java 路径具有默认行 80%、分支 70% 以及变更覆盖率校验。[plan.js:746](E:/ai_workflow/specgate/src/codex/plan.js:746)、[quality.js:322](E:/ai_workflow/specgate/src/codex/quality.js:322)、[:962](E:/ai_workflow/specgate/src/codex/quality.js:962)。
- 格式化后重新质量验证、Review 对齐 integration commit，H3 绑定 Review 和归档预览，archive 检查 H3 事件。[review.js:441](E:/ai_workflow/specgate/src/codex/review.js:441)、[:738](E:/ai_workflow/specgate/src/codex/review.js:738)、[release.js:249](E:/ai_workflow/specgate/src/codex/release.js:249)。本轮合成交付和多个负向测试真实通过。

实际缺口：

1. 环境基线并非严格验收门：`known-failures` 和 `partial` 都可启动 Change，缺依赖/超时还可能被收为 known failure。允许已知业务问题应有显式风险准入，不能包容基础设施未就绪。
2. 新增场景档案读 `state.validationProfile/state.type`，现有状态只允许更新 context，实际变更类型位于 `context.changeAdd.change.type`。本轮 refactor 样例仍选 legacy 全红策略，返回 `RED_BASELINE_NOT_FAILING`；默认重构/既成立约束可能无路可进。[validation-profile.js:131](E:/ai_workflow/specgate/src/codex/core/validation-profile.js:131)、[development.js:686](E:/ai_workflow/specgate/src/codex/development.js:686)、[state-machine.js:290](E:/ai_workflow/specgate/src/codex/state-machine.js:290)。
3. H3 选择“要求修改”/“取消变更”后，审批层返回相应决定，但 Review service 原样返回，phase 仍是 H3_PENDING；返工返回 REWORK_NOT_REQUIRED，取消也没有自动进入 CANCELLED。手动 sg_cancel 存在，但表单动作与状态闭环未对齐。[approvals.js:309](E:/ai_workflow/specgate/src/codex/approvals.js:309)、[review.js:831](E:/ai_workflow/specgate/src/codex/review.js:831)。
4. 非阻断 Review finding 已写入 Review 报告，却未加入 DeliveryRecord.knownIssues 和客户摘要；本轮 P3 finding fixture 交付成功但已知问题为空。[review.js:650](E:/ai_workflow/specgate/src/codex/review.js:650)、[release.js:440](E:/ai_workflow/specgate/src/codex/release.js:440)。
5. 五类审批隔离、分层报告等辅助模块主要有函数测试，真实 workflow 没有完整消费；相应历史验收记录自己也列出尚未接入 quality/H 门禁的部分。[core/approval-separation.js:7](E:/ai_workflow/specgate/src/codex/core/approval-separation.js:7)、[10-m7-acceptance.md](E:/ai_workflow/specgate/docs/implementation/stack-neutral-adoption/10-m7-acceptance.md)。
6. Review 的 VerificationAssessment 将所有 AC 绑定到一条聚合 automated-test 记录并补默认时间，没有保留每 AC 的实际 case/命令及非自动化证据要求。[review.js:459](E:/ai_workflow/specgate/src/codex/review.js:459)。但上游 quality 的确执行并校验冻结用例，不能据此单独宣称“所有测试证据伪造”。应补齐逐 AC 追溯及不同证据类型标准。`DeliveryRecord.customerAcceptance=null` 是真实现状，不应解释成客户已验收；本轮亦未执行客户验收。

**风险等级：P1（环境准入及恢复），P2（审批分支、已知问题和证据追溯）。**

**修复建议：** 为每个阶段定义独立标准与证据，环境 READY、技术质量通过、H3 发布批准、客户接受分别报告。H1/安装审批本来就发生于对应实施之前，不应要求“所有审批都在业务验收以后”；应保证 H3 仅在所要求的技术验收真实合格后发生，拒绝/修改分支有可执行后继。归档前检查 assessment 非 blocked 和全部绑定，避免等到 merge 之后才发现交付记录不合法。

## 缺陷汇总

下表仅把可追溯的问题列为缺陷；真实下载、当前 Linux、真实宿主审批兼容等无本轮证据事项列为未验，不凭推测增加“已复现”结论。

| 编号 | 严重级别         | 位置                                                                                  | 问题描述                                                                                | 影响                                                  | 建议                                                 |
| ---- | ---------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| F01  | P1               | workflow-tools.js:38、:943；package.json:48                                           | 默认过滤新建/安装且发行包排除实现                                                       | 目标闭环入口未实现                                    | 决定公开能力并端到端打包验收，不能只开历史标志       |
| F02  | P1               | project-adopt.js:92；project-model.js:142；environment.js:145；workflow-tools.js:1048 | 通用发现被固定 java-vue profile 和 Java组合门禁覆盖                                     | Node/Python/Go 等接入后被阻断                         | ProjectFacts/StackSpec/ToolRequirements 统一接线     |
| F03  | P1               | environment.js:97；baseline.js:129；project-command.js:9                              | 发现时的工具绝对路径与 JAVA_HOME/PATH 未贯穿执行                                        | 当前宿主可真实复现 READY 后 Maven 不可用              | 同一执行上下文用于基线、验证和 worktree              |
| F04  | P1               | project-detect.js:118；baseline-worker.mjs:111；baseline.js:260；project-model.js:241 | 根据原工作树 node_modules 跳过 install；隔离依赖缺失计为既知失败                        | 原项目测试绿，接入后故障被认可为 ready                | 在隔离环境重建锁定依赖，基础设施失败阻断             |
| F05  | P1               | baseline-job.js:66、:139                                                              | 重复启动先移除匹配 worktree/旧任务目录，未先排除活跃 owner                              | 可能破坏正在验证的任务与状态                          | 同仓库锁、单飞、只回收死 owner；本轮静态确认         |
| F06  | P1               | format.js:163                                                                         | Formatter 仅识别 backend POM/frontend package，并硬用 npm                               | 根 Node、Python、Go、非 npm 项目卡格式化阶段          | 采用 profile 的栈适配与显式 format check/apply       |
| F07  | P1               | release.js:405、:541                                                                  | 先快进，再创建交付证据；失败后审批 hash 不再一致                                        | 实测不可直接重试，分支已变而交付未完成                | 预检+操作日志+幂等恢复                               |
| F08  | P1（历史脚本）   | install-env.ps1:34、:61；install-env.sh:26、:78；install-env.mjs:528                  | Node 缺失时包装脚本 --check 也可安装，缺对应审批与下载校验；mjs 默认全工具/用户配置写入 | 显式运行历史入口可能超出检查和精确安装范围            | 只读开关在 bootstrap 前处理，统一批准方案与 checksum |
| F09  | P2               | core/env/node.js:43；core/env/python.js:35；core/env/compatibility.js:76              | Node/Python 范围及最低版本过度简化                                                      | 实测 Node22.22.0满足>=22.24.0，Python3.12满足==3.11.9 | 标准版本约束解析和边界测试；接线前先修               |
| F10  | P2               | core/discovery/stack.js:91、:211；project-detect.js:288                               | 只查 root+顶层，不读取 workspace/go.work；Python/Go 命令未导出                          | 两层 monorepo 漏扫，识别不等于可执行                  | 构建文件驱动有界遍历，公开截断与未识别状态           |
| F11  | P2（可选模式）   | environment-tools.js:63                                                               | 安装同意依赖 elicitation 广告，与 H1 真实通道探测不同                                   | 可支持表单但漏广告的宿主永远没有安装确认机会          | 共用可信宿主能力探测，失败保持阻塞                   |
| F12  | P2               | release.js:440                                                                        | knownIssues 未消费 Review 的非阻断 findings                                             | 实测客户包漏掉已知问题                                | 按 finding ID 合并并保留级别/位置/处置               |
| F13  | P2               | approvals.js:309；review.js:831                                                       | H3 修改/取消决定未驱动返工/取消相位                                                     | 表单操作后流程没有按决定闭合                          | 修改进入明确 rework，取消调用正式状态转换            |
| F14  | P2               | validation-profile.js:131；development.js:686；state-machine.js:290                   | 场景/验证档案存取位置与 Change 类型不一致                                               | refactor 实测仍要求全红，无法使用新增策略             | 统一持久化 schema 和公共设置入口                     |
| F15  | P2               | protocol.js:76；core/bootstrap-diagnostics.js:44                                      | 协议兜底丢失具体原因，启动诊断辅助模块未接主链                                          | 无法稳定区分依赖/权限/网络/认证问题                   | 脱敏结构化 code/stage/cause/retryAction              |
| F16  | P1（当前工作树） | .mcp.json:3；test/codex-plugin-package.test.js:76                                     | 原有未提交 MCP 配置与 mcp.json 不一致                                                   | 全量测试实败；依赖该入口的加载无 server               | 明确保留空配置意图后同步入口；本轮保留原改动         |

另外存在安装缓存与源码同版本漂移、平台证据未绑定本 HEAD、每 AC 证据聚合过粗等验收限制，详见第 3/4/8 节。未将合法的失败阻断、重试上限、特殊文件防护或没有生产部署证据本身一律记成实现缺陷。

## 优先实施范围及可执行验收矩阵

建议下一轮先只完成环境准备功能，暂不扩展模板和业务交付：

1. 统一事实模型：存量扫描实际 manifest/workspace/版本约束；新建由用户选 frontend/backend/包管理器及版本，允许纯单端；未知栈输出缺口，不替用户选择 Java。
2. 接通环境执行：按所选任务要求发现工具、虚拟环境、wrapper、版本管理器和项目配置；输出已验证绝对路径、真实版本和进程级环境，后续命令直接使用同一上下文。
3. 接通审批安装：持久化完整 InstallPlan，真实宿主批准绑定精确 planHash；安装适配 Git、Node/npm、pnpm/Yarn、Python/venv/pip/uv/Poetry、Go、JDK/Maven/Gradle；只安装缺项，失败可恢复，任何扩权/换源/版本变化重新审批。
4. 复验与恢复：安装后真实执行版本、包管理器和最小编译/导入/测试；READY 只代表环境准备通过。返回原接入/新建任务，保留选择、审批和日志；第二次执行零重复安装、零重复审批。

下面是**建议标准，尚未执行通过**：

| 维度/用例                                                     | 必须观察到的结果                                                       | 当前状态                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------- |
| 存量/新建 × Node/React/Vue/Python/Go/Java × Windows/Linux x64 | 先准确发现/选择，再复用或审批补齐，真实最小项目命令退出0，继续原操作   | 不通过；尚无完整矩阵                   |
| 已有兼容依赖；多版本并存                                      | 选满足项目范围的版本，记录 path/version/arch；下载和安装调用数均为0    | 固定 Java 组合发现已实测；通用链待实现 |
| 缺 1 项/多项；用户批准                                        | 只安装对应缺项；方案来源/校验/目录/配置/权限与回执一致                 | 默认未实现，真实安装未验               |
| 用户拒绝/关闭/取消                                            | 无下载安装与配置写入；返回可恢复 BLOCKED/WAITING_APPROVAL              | 部分函数覆盖；真实宿主 E2E 未验        |
| 版本/来源/位置/配置/权限改变                                  | 旧回执无效，未经重新批准不执行                                         | 辅助模块有测试；主链未完整接线         |
| checksum/网络/代理/权限/tar/磁盘错误与中途退出                | 保留准确失败原因、已完成项和用户环境；无假 READY；可从 checkpoint 重试 | 部分可选测试覆盖，跨平台实装待验       |
| PATH 未包含可复用工具，JAVA_HOME 失效                         | 后续命令仍使用被验证上下文成功运行                                     | 本轮反例已复现，不通过                 |
| 新隔离 worktree                                               | 依赖按锁文件在实际执行环境准备，基础设施故障不得变为可容忍业务基线     | 本轮反例已复现，不通过                 |
| apps/web、services/api、workspace、venv、wrapper              | 有界完整发现或明确报告截断；不默默漏模块                               | 当前两层目录反例失败                   |
| 重复调用/并发/重启                                            | 同仓库单任务；不删除活任务；复验后复用；审批与安装不重复消费           | detached 路径需修复                    |
| Node 缺失而 MCP 尚未启动                                      | 宿主层只读发现→用户批准→校验安装→重连；--check 永不安装                | 默认缺实现，历史包装脚本有越界风险     |
| 从精确发行包装入新 Codex 会话                                 | 工具/Skill/代码 hash 与报告一致；真实安装表单可提交、拒绝与恢复        | 部分离线装载已测，真人审批未验         |
| macOS/ARM64                                                   | 明确支持范围，完成本平台同样 E2E 才升级支持声明                        | 当前未支持/预留                        |

通过标准应至少是上述必选矩阵全部实际成功、负向场景保持正确阻断，并生成含提交/包指纹、OS/CPU、真实 argv/可执行路径、版本、起止时间、退出码、日志哈希、planHash 和对应审批回执的证据包。现有环境发现和审批/校验组件可以复用，但必须以主链实测结果决定是否达成，而非以新增函数测试数判断。
