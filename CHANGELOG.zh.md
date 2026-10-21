# 变更记录

## 4.3.0（sg-java）

- `sg-init` 改为**仅生成**：不安装依赖、不编译、不启动 agent；移除内置多 agent 验收/测试/交付流程与 `sg_init_finalize` / `sg_init_resume` 工具。需要本地验证时执行 `/sg-verify`。
- 新增版本档：`jdk8-boot2.7`（默认）、`jdk17-boot3.5`、`jdk21-boot3.5`、`jdk21-boot4.0`（preview）；`--version` 选择，未指定时交互选择，非法组合在生成前拒绝。
- 重复执行 `sg-init` 在已初始化的 Java/Vue workspace 上幂等跳过；`.specgate/state.json` 不再忽略，clone 后可直接创建 change。
- Golden 清单：每个版本档的模板 hash、验证时间、工具链、命令与结论登记在 `src/v4/java-versions.js`；`sg-init` 写入 `.specgate/golden.json`，未匹配的模板禁止 `sg-change`。
- 新增 `sg_verify` 工具与 `/sg-verify` 命令：后端 `mvn verify`、前端 install/build/test/lint/format:check，并启动后端执行 HTTP CRUD 与正常重启持久化；写 `.specgate/verify-report.json`，通过后状态 `SMOKE_PASSED`。
- Boot 4 兼容：`spring-boot-starter-webmvc-test`、`org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc`、Jackson 3 `tools.jackson.databind.ObjectMapper`。
- 四个版本档均在 Windows + Temurin JDK 8/17/21 + Maven 3.9.9 下完成本地验收：后端 `mvn verify`、前端 build/test/lint/format 全绿。

## sg-java（未发布）

- 默认初始化严格完全空目录，含 .git、空文件、空目录均拒绝；宿主确认前无生成写入。
- 生成 Java8/Boot2.7.18/Maven + 稳定 Vue3/TS/Vite/npm 前后端分离任务 CRUD，H2 文件持久化。
- （历史，4.3 已移除）默认宽松隔离并发多 agent 测试/静态/格式化/语义走查；该流程不再由 sg-init 启动。
- 单仓 monorepo、req v1.0 快照、IDLE 基线，后续 sg-change 独立发起并保留审批。
- 显式 v3/adopt 旧入口保留；默认不再自动创建/归档首个 change 或嵌套 submodule。

## 3.7.0

- 需求先行初始化：`/sg-init` 在任何技术栈问题之前，先盘问功能（MVP）、非功能、约束与验收标准，两者合成一次确认页。
- 新增 `openspec/REQ.md` 需求基线：`REQ-xxx` 连续编号，`AC-xxx` 每条声明 `- covers: REQ-xxx`，并写入逐字一致的只读快照 `openspec/history/v1.0/REQ.md`。
- 基线只在用户确认后写入：`sg_init` 停在 `H0_PENDING`，由 `sg_run`（新项目）或 `sg_approve H0`（老项目）落盘。
- 老项目接入：在已有代码的仓库执行 `/sg-init` 会扫描项目、反推需求草稿，只写 `docs/requirements-scan.md` 与 `.specgate/requirements-scan.json`，不生成任何脚手架；仅在缺少仓库时执行 `git init`，且只提交 SpecGate 自己生成的资产。
- 需求校验通过 `requirements.enabled` 按需启用：`sg-change` 要求基线存在且与快照一致，`M1` 拒绝未引用任何 `REQ-xxx` 或引用不存在编号的 proposal。
- 幂等：重复执行 `/sg-init` 返回“幂等跳过”，保持阶段不变，且绝不覆盖 `REQ.md`。
- 新增 `src/v3/notice.js`：无消息会话中的第一条 `/sg-*` 命令会追加一条 `notice` 上下文消息，确保结果不停留在欢迎页。
- `.specgate/init-result.json` 已加入 `.gitignore`，`/sg-init` 命令执行后不再留下未跟踪文件。
- 修复：H0 批准消息不再把基线对象插值成 `[object Object]`；H0 门控卡从 `state.requirements` 读取验收标准；`configureSuites` 重写配置时不再丢掉 `requirements` 块。
- 277 个测试通过，其中 `test/v3/s36.requirements.test.js` 新增 8 个用例。

- 修复 H0 门控死锁：`sg_approve` 现在接受 `gate: "H0"`（schema 枚举与运行时校验），且 H0 批准不再要求已存在 change。新项目可用 `sg_approve` → `sg_run` 离开 `H0_PENDING`。
- H0 相关提示改为指向 `sg_approve` 工具，不再引用不存在的 `/sg-approve` 命令。
- 重构 README：中文为默认 `README.md`，英文移至 `README.en.md`，两版均新增目录，删除 `README.zh.md`。

## 2.1.0

- 新增开发角色推断（architect/ddd/developer）；显式 `role:` 优先，低置信度任务在创建任何 Agent 前停止。
- 在实施与测试之间新增 `G7.5` 格式化/Lint 门控。
- 新增独立 `sg-agent-formatter`：只处理变更文件，配置/package.json 命令探测，输出 `format-report.md`。
- 复用 `sg-agent-reviewer` 作为独立只读审查者，输出 `review-report.md`；blocking 阻止 G9。
- 新增 `sg-apply` / `sg_apply` 阶段编排：每次只推进一个阶段并停在门控；dev → format → test → review。
- 新增按阶段的失败重试状态，同一阶段失败 2 次后阻塞。
- 新增 formatter/reviewer worktree 与双语资产。11 个 Agent、17 个工具、113 项测试通过。

## 2.0.0

- 新增 v2 需求模型：唯一 `requirements/REQUIREMENTS.md`、不可变 `history/vX.Y.Z/` 快照、change 级 `requirements/changes/<id>/` 增量包。
- 新增 `/sg-change` 与 `sg_change`；G3 现在应用需求增量并写入下一个已批准版本。
- 新增专用 `sg-agent-tester`、`tests/cases.md`、`tests/matrix.md`、`tests/test-report.md`，以及 `/sg-test <change> plan|run` 独立 test worktree。
- G5 校验并冻结测试用例；G8 校验通过的测试报告与覆盖率（P0/P1 100%、P2 90%、行 80%、分支 70%）。
- 新增 `/sg-requirements-migrate` 与 `sg_requirements_migrate` 显式迁移旧项目；未迁移项目保持旧流程。
- 开发任务与测试使用独立 worktree；主 Agent 仍是唯一合并者。
- 新增 10 个 Agent 资产、v2 模板/文档与回归测试。99 项测试通过。

## 未发布

- `/sg-*` 命令现在通过 `agent.followup` 把完整输出交回 agent（`source.kind=specgate`，消息为 `role=user`），结果以正常对话消息呈现，并可接着追问下一门控，不再只剩折叠的命令卡片或 `notice` 小条。
- 交回在活跃会话中同样生效，不再只限新会话；`agent.status === 'running'` 时仍然跳过，以保护 `tool_use`/`tool_result` 配对。
- runtime 没有 `followup` 或交回被拒绝时，降级为原有的 `notice`，命令结果不会丢失。
- 测试：90 项通过（`test/commands-report.test.js` 新增交回覆盖）。

## 1.0.1

- 修复 `sg_doctor` 在 composition 未注入 `agents` 服务时直接崩溃（`cannot get property "agents" without inject`）：改为优先通过 `ctx.get('agents')` 解析，并在 `try` 内构造 runner；不可用时自动降级为本地确定性体检。
- 修复并行派发的子 Agent 未继承父级模型路由。

## 1.0.0

SpecGate 首个公开版本，源自 AgentKit47-Qoder。

- 插件、命令、工具、数据目录、Skill、Agent 全部从 AK47 标识迁移为 SpecGate（`sg-*`、`.specgate/`）。
- 所有修改类命令/工具增加幂等：状态检查、追加类操作 24h 去重、并发锁。
- `/sg-apply` 增加多 Agent 并行派发（worktree、`[P]`/`depends` 波次、冲突保留）；`/sg-doctor` 四维并行体检。
- 新增 `/sg-migrate` 与 `sg_migrate`：`.ak47/` → `.specgate/` 迁移，包含备份与受管引用重写。
- 新增中英双语资产与 `language` 选择。
- 新增项目级与全局配置（`defaultEnabled`、`enforcement`、`maxConcurrency`、`git`、`language`、`materializeSkills`、`materializeAgents`）。
- 增加 npm 发布元数据、打包检查、GitHub Actions CI 与 tag 发布流程。
- 修复 Skill 加载：运行时注册补充必需的 `source` 字段。
- 89 项测试通过。
