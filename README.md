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

`plugin.json` / `mcp.json` 是便携入口，MCP server 为 `src/codex/server.js`。默认公开 43 个工具，完整清单由协议测试锁定。`$sg-codex` 导航到环境检查、已有项目接入、Change 和只读状态 Skill。环境入口只探测与复用，不自动下载或安装 JDK、Maven、Node、Git。

历史新建项目、模板、自动安装、异步 WorkItem、控制面、Worker、Decision、TOTP、Web 和通知代码仍在源码中；默认工具面、启动静态图和 Core tarball 均排除这些能力。源码开发者可显式设置 `SPECGATE_OPTIONAL_MODULES=1` 加载历史工具；该模式及其外部依赖不属于 Core 发行验收。Core 包不包含 `mysql2`。

## 验证

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

`npm test:mysql` 单独运行历史 MySQL 集成测试，需要自行提供数据库和配置；缺项会明确失败。真实阶段验收见 [M0–M4 记录](docs/implementation/specgate-core-mvp-v2/04-m0-acceptance.md) 和批准计划附录。项目生成与远程控制的旧说明保留在仓库历史文档中，不代表默认 Core 功能。
