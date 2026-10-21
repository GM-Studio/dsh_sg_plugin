# Codex 适配层 P0：插件骨架与诊断协议

实施分支：`sg-codex`。本阶段对应 [v1 计划 P0](../plans/codex-sg-change-add-v1.md)，不代表 v1 全流程已交付。

## 仓库扫描与复用边界

源文件清单、内容 hash、导出符号和原入口未变更证据见 [repository-scan.json](../verification/codex-sg-v1/p0/repository-scan.json)。清单覆盖仓库的 `src/`、`scripts/`、`test/` 和根入口/ESLint 配置，不包含依赖、忽略的验收夹具、构建产物和 `.git`。结构化扫描不等于逐行人工安全审计。

| 模块 | 现有职责 | Codex 迁移约束 |
|---|---|---|
| `index.js`、`src/v3/{commands,tools,runtime}.js` | DSH 注册、服务获取、命令入口 | 保持原入口与注册集合；新入口独立 |
| `src/v3/{state,phase}.js` | v3 状态 load/mutate/save、阶段推进 | 缺少新需求的 CAS；不能直接作为 Codex 权威状态 |
| `src/v3/approvals.js` | DSH `userQuestions`、审批 hash | 不是 Codex 可信来源证明；不通过参数批准 H1/H3 |
| `src/v3/{evidence,runs,report}.js` | 命令证据、审计、报告 | 后续状态与事件原子顺序仍需独立验证 |
| `src/v3/{requirements,requirements-doc,reverse}.js` | 需求解析、基线、反推 | 后续补 3×5 澄清、结构化批判与不可变版本 |
| `src/v3/{plan,suites,acceptance}.js` | 任务图、测试套件、AC 映射 | 后续补动态拆分及开发前冻结测试 |
| `src/v3/{dispatch,pool,scheduler,executor}.js` | DSH Agent 调度、重试与执行 | 不能视为已接通 Codex 原生 subagents |
| `src/v3/{worktrees,review,archive}.js` | task/integration/review、审查、归档 | 后续补四角色隔离、三档 Review 与 push 状态 |
| `src/v4/{java-init,java-fullstack-template,java-versions}.js` | 四档 Java/Vue、Task CRUD、模板 hash | 保留模板；非空目录策略与 Codex 审批待 P2 |
| `src/v4/{java-env,java-verify,java-runtime}.js` | 有界发现、真实构建与 HTTP 冒烟 | Codex 入口不得自动下载大型 SDK；迁移待 P3 |
| `src/v4/{verify-evidence,coverage-evidence}.js` | 分阶段真实证据、覆盖率对账 | 仅真实命令/运行时结果可算验证通过 |
| `test/`、`scripts/`、仓库质量配置 | 回归、验收、格式与 lint | 新增协议/打包回归并执行完整质量检查 |

## 产物与协议

- `.codex-plugin/plugin.json`：兼容格式 manifest，适配层版本 `0.1.0`，独立于 DSH 包版本。
- `.mcp.json`：本地 Node stdio，不启动 HTTP 服务。`${PLUGIN_ROOT}` 指向安装包；保留宿主项目的 cwd。
- `src/codex/server.js`：UTF-8、逐行 JSON-RPC；单条消息上限 1 MiB；EOF 退出；截断和超限帧以非零退出码结束。
- `src/codex/protocol.js`：协商 MCP `2025-06-18`；要求 initialize → initialized；只声明 tools 能力；不接受 batch。
- `src/codex/tools.js`：三个显式只读诊断工具，参数均为 `{}`。
- `skills/sg-codex/SKILL.md`：诊断调用与未来角色职责，不保存权威状态，不注册尚未实现的业务命令。
- `scripts/codex-plugin-smoke.mjs`：真实子进程客户端，按请求/响应完成握手、工具调用、ping 与 EOF；可保存完整输入输出。

| 工具 | 返回 | 不可推导的结论 |
|---|---|---|
| `health` | 适配服务在线、P0、stdio | Java/Vue 已初始化或已验证 |
| `version` | 适配层版本、DSH 包版本、协议版本 | 模板 Golden 已通过 |
| `status` | 绑定项目路径、旧状态是否存在、能力边界 | 旧状态可迁移、原生工作流已实现 |

结果同时提供 JSON 文本和 `structuredContent`。`status.verification.status` 为 `not-run`，范围是尚未实施的 Codex 项目工作流，不覆盖或重判已有 DSH 验证结果。工具不读取旧审批内容或写入 `.specgate/`。

非法信封/重复握手返回 `-32600`，JSON 解析失败返回 `-32700`，未知方法返回 `-32601`，参数/工具名错误返回 `-32602`，未完成握手返回 `-32002`。合法通知不产生响应。`sg_approve`、业务命令和任意批准标志均不可调用。

本阶段使用 Node 标准库实现受限的只读协议面，未增加运行时依赖。后续若引入 elicitation、并发长任务或资源订阅，应重新评估协议层与官方 SDK 的集成，不能把本阶段客户端测试等同于这些能力的验收。

## 本地验证

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-protocol.test.js test/codex-plugin-package.test.js
npm run codex:smoke -- --output docs/verification/codex-sg-v1/p0/stdio-smoke.json
npm test
npm run lint
npm run format:check
npm pack --dry-run
```

默认 npm 缓存不可写时，可加 `--cache <可写临时目录>`，保留原始失败报告。本阶段的打包测试在临时目录打包，以 `--offline --ignore-scripts --omit=dev` 安装到隔离夹具，再从独立的中文/空格项目目录启动安装后的入口，并检查 DSH 导出仍可加载。不会安装到用户的 Codex 配置，不提交或发布插件仓库。

stdio 服务也可直接运行：

```powershell
node src/codex/server.js --project-root E:\path\to\project
```

`npm run codex:mcp` 默认绑定启动时 cwd。对于手工 MCP 配置，使用 server 的绝对路径并明确项目目录，避免误把插件安装目录当作业务项目。

## 宿主能力边界

| 能力 | 本阶段证据 | 状态 |
|---|---|---|
| manifest / MCP / Skills 的打包路径 | 产物清单和隔离离线安装 | passed（包结构） |
| MCP 启动、握手、三工具与退出 | 独立真实 stdio 客户端及 transcript | passed（测试客户端） |
| Codex Desktop 真实安装和自动加载 | 未修改宿主配置，未进行 UI 安装 | not-run |
| 宿主实际发现/调用 Skill | 文件校验不等于宿主加载 | not-run |
| Hooks | 未配置，不能承担安全边界 | not-run |
| 原生 subagents 调度与隔离 | 本阶段没有调度适配器 | not-run |
| 原生可信审批及审批人来源 | 没有已验证的来源协议或适配器 | not-run / fail-closed |
| 四档 Windows Java/Vue 真实验证 | 属于 P3，本阶段未执行 | not-run |
| Linux 验收 | 未执行 | not-run |

本机只读探测得到 `codex-cli 0.117.0`；其 `--help` 提供 MCP 管理入口，没有列出 plugin 管理命令。这不能用于推断 Desktop 的安装能力。P0 退出条件允许测试客户端握手，因此上述宿主未验证项不冒充已通过；P1 的可信审批前置条件仍待证实。

包装依据：[OpenAI 插件包装文档](https://developers.openai.com/plugins/build/plugins)、[本地 stdio 插件说明](https://developers.openai.com/plugins/deploy/desktop-only)。协议依据：[MCP 生命周期](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)、[MCP stdio 传输](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。官方支持说明与本机测试证据分别记录。
