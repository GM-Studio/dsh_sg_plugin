# SpecGate Core for Codex

SpecGate Core 为**已有 Git 项目**提供本地、可审计的需求到交付流程。默认 MCP 使用本地文件、Git worktree 和 append-only 事件链；启动无需 MySQL、Web 服务、通知凭据或开放端口。

[English](README.en.md) · [v1 冻结需求](docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md) · [批准执行计划](docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md)

## 默认流程

1. 绑定已有 Git 项目，读取 ProjectProfile / ProjectBaseline；需要时只读预览并接入存量项目。
2. 澄清和审阅需求，由真实用户经可信宿主批准 H1。
3. 冻结契约、AC、任务白名单和可执行测试，观察全红基线。
4. Test Designer、Implementer、Reviewer 分别执行受约束任务；实现按任务串行集成。
5. 运行冻结测试和项目声明的验证命令。确定性格式化后，在新的 integration commit **完整重跑质量门**，再只读 Review。
6. 真实用户批准 H3 后，生成绑定提交和证据的 DeliveryRecord、回滚说明与包含全部已知问题的客户包。推送必须显式请求，禁止 force push。

任何未运行、跳过、超时或失败检查都不能标记通过。Core v1 的金丝雀发布验收属于计划 M6；当前仓库测试与 fixture 不能代替真实业务项目、人工审批和原生 Reviewer 会话。

## 安装和工具

`plugin.json` / `mcp.json` 是便携入口，MCP server 为 `src/codex/server.js`。默认公开 45 个工具，完整清单由协议测试锁定。`sg_env_check` 只读发现和复用，`sg_env_prepare` 在可信用户确认安装方案后补齐并复验；Git 等需要宿主原生安装的缺项明确阻断。`sg_project_create` 由用户选择新项目目录与环境，只准备目录和工具链，不生成业务模板，不宣称项目基线或业务验收通过。

存量环境按真实构建文件识别 Node/React/Vue、Python、Go、Maven/Gradle Java，并校验声明的版本约束；新项目可选择纯前端、纯后端或带 Vue/React 的组合。Go 与 Python portable 安装仅在显式选择官方源后解析确切版本/校验并申请批准；没有适配器或匹配归档时明确阻断，不冒充已支持。

格式化按根目录和嵌套模块配置执行：Node 遵循 `packageManager`/锁文件及 format 脚本，Python 使用已声明的 Ruff/Black，Go 使用 gofmt，Maven 使用声明的 Spotless 与已安装 Maven。依赖准备仅离线复用缓存；缺工具、缺配置或版本不匹配会阻断。Gradle 或自定义技术栈可在绑定项目的 `.specgate/format.json` 中配置 `{ "schemaVersion": 1, "commands": [{ "id": "custom", "cwd": ".", "apply": ["tool", "--write"], "check": ["tool", "--check"] }] }`，命令为 argv 数组。该配置优先于同目录 ProjectProfile 命令，工作目录绑定实际格式化 worktree。check 必须有显式命令，且源码前后指纹一致；apply 完成后仍须重新通过完整质量门才进入 Review。扫描超限会明确阻断，不能把未扫描模块视为已格式化。

发布在目标分支快进前预检 DeliveryRecord 和交付包，并持久化绑定 H3、目标提交、配置及证据的操作记录。同一操作遇到存储失败可读取最新状态版本重试；证据、目标或选项发生非预期变化会阻断并保留现场。已有交付文件逐字节复用，冲突不覆盖；本地归档完成后的重试也不能追加推送授权。工作树仅在交付证据与最终状态持久化后清理，清理结果单独记录。显式推送已到达远程但回执保存失败时，恢复流程实际查询远程提交，记录观察结果。

历史业务模板、异步 WorkItem、控制面、Worker、Decision、TOTP、Web 和通知代码仍在源码中；默认工具面和 Core tarball 排除这些能力。源码开发者可显式设置 `SPECGATE_OPTIONAL_MODULES=1` 加载历史工具；该模式及其外部依赖不属于 Core 发行验收。环境安装器按需加载并随包提供；Core 包不包含 `mysql2`。

## 验证

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

`npm test:mysql` 单独运行历史 MySQL 集成测试，需要自行提供数据库和配置；缺项会明确失败。真实阶段验收见 [M0–M4 记录](docs/implementation/specgate-core-mvp-v2/04-m0-acceptance.md) 和批准计划附录。项目生成与远程控制的旧说明保留在仓库历史文档中，不代表默认 Core 功能。
