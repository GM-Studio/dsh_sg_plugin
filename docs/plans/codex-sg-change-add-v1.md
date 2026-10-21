# Codex 原生 SG 工作流 v1 实施计划

> 文档状态：**已批准，持续实施**  
> 需求基线：`docs/requirements/codex-sg-change-add-v1.md` v1.0（已批准）  
> 计划版本：v0.1  
> 实施状态：**P0–P9 核心已实施；Task priority P6→P7 原生 Agent E2E 与 Customer CRM P6→P9 隔离闭环已通过；真实宿主 Review/H3 和生产远端 push 待验收**
> 代码/配置/测试：**已在本地提交；仓库未发布**
> Git 提交/推送：**插件仓库本地提交/标签/归档已执行；未 push**
> 适用范围：`sg-init`、`sg-verify`、`sg-change --add` 首版闭环

---

## 1. 计划目的与约束

本计划把已批准需求拆成可独立交付的阶段。每个阶段都必须满足以下条件，才允许进入下一阶段：

1. 有明确、可运行、可验证的产物；
2. 有真实命令或运行时证据；
3. 不把“已生成”写成“已验证”；
4. 未执行项明确标记 `not-run`，不得伪造通过；
5. 不降低需求文档中的验收标准；
6. 不破坏现有 DSH/v3/v4 入口和已有工作树改动；
7. 本计划批准前不进入实施。

### 1.1 当前仓库事实

- 当前入口 `index.js` 是 DSH host plugin，不是 Codex 插件 manifest 入口；
- `src/v3/` 已有状态、审批、执行器、worktree、Review、证据、归档等原型；
- `src/v4/` 已有四档 Java/Vue 初始化、工具链发现、真实验证和覆盖率对账基础；
- 当前 v3 状态写入是 load → mutate → save，尚无版本号或 CAS；
- 当前审批依赖 DSH `userQuestions`，尚未接入 Codex 原生可信审批；
- 当前角色为 `implementer/tester/reviewer`，不是固定前端/后端/测试/审查四角色；
- 当前 worktree 是 integration/task 原型，不是固定 frontend/backend/test/review 拓扑；
- 当前归档没有 push，也没有 `ARCHIVED_NOT_PUSHED` / `PUSH_FAILED` 状态；
- 仓库已有未跟踪需求文档，必须保留，不得覆盖或提交。

### 1.2 实施原则

- **先内核后流程**：先做权威状态、审批、事件和恢复，再做业务编排；
- **先可验证再扩展**：每个阶段只引入本阶段可证明的行为；
- **契约先行**：前端、后端并行前冻结接口契约和数据模型；
- **测试先行**：测试用例和测试骨架在开发前冻结；
- **证据优先**：命令、退出码、日志、覆盖率和 Review 结论必须落盘；
- **fail-closed**：审批、状态、证据、worktree 或质量门任一不满足时拒绝推进；
- **最小侵入**：优先复用 v3/v4 已有模块，新增 Codex 适配层，避免重写已验证能力；
- **可回滚**：每个阶段以独立提交或可恢复检查点结束，不执行不可逆的自动清理。

---

## 2. 范围与非目标

### 2.1 本计划覆盖

- Codex 原生插件骨架与本地 stdio MCP；
- 权威状态机、CAS、append-only 事件、可信审批、暂停/恢复/取消；
- `sg-init` 四档 Java/Vue 初始化、非空目录扫描与覆盖预览；
- `sg-verify` 真实构建、测试、lint、格式、运行时冒烟与证据对账；
- `sg-change --add` 需求澄清、批判、H1 冻结；
- 动态 Plan、接口契约、测试用例/骨架冻结；
- 前后端并行开发与固定 worktree；
- 测试执行与质量门；
- 三档 Review、H3、归档、commit、merge、push；
- 30 条验收标准的证据映射。

### 2.2 本计划不覆盖

- `change-update`、`change-delete`；
- 多 active change；
- DSH 与 Codex 双端同时运行；
- 自动 PR；
- 强制浏览器 E2E；
- 多仓库或 submodule；
- 其他技术栈；
- force push；
- 自动下载大型 SDK；
- 专用 UI 看板。

---

## 3. 阶段总览

| 阶段 | 名称 | 主要产物 | 依赖 | 预计规模 |
|---|---|---|---|---|
| P0 | Codex 插件骨架与兼容基线 | manifest、stdio MCP 空壳、Skills 目录、健康检查 | 无 | 小 |
| P1 | 权威状态、事件、审批与恢复内核 | 状态机、CAS、事件日志、可信审批、pause/resume/cancel | P0 | 中 |
| P2 | `sg-init` 生成能力 | 四档初始化、非空扫描、覆盖预览、GENERATED_ONLY | P0/P1 | 中 |
| P3 | `sg-verify` 真实验证 | 工具链、构建、测试、lint、格式、运行时冒烟、证据 | P2 | 中 |
| P4 | `sg-change --add` 需求闭环 | 需求 Agent、批判 Agent、H1、不可变快照 | P1/P3 | 中 |
| P5 | 动态 Plan、契约和测试冻结 | 任务图、接口契约、测试用例/骨架、hash | P4 | 中 |
| P6 | 前后端并行开发与 worktree | 四角色 worktree、并行开发、integration 合并 | P5 | 中 |
| P7 | 测试执行与质量门 | 静态/单元/接口/集成/冒烟、覆盖率、证据对账 | P6 | 中 |
| P8 | Review 三档与 H3 | 风险选档、只读审查、H3、修复循环 | P7 | 中 |
| P9 | 归档、推送与端到端验收 | commit/merge/push、无 remote 分支、全流程 E2E | P8 | 中 |

> 规模为相对估算，不代表工时承诺。每阶段应在进入下一阶段前完成一次独立验收。

---

## 4. 阶段详情

### P0：Codex 插件骨架与兼容基线

**目标**

建立可安装、可启动、可健康检查的 Codex 原生插件骨架，同时保留现有 DSH 入口，不迁移业务逻辑。

**前置条件**

- 计划已批准；
- 工作树状态已记录；
- 明确不发布、不提交插件仓库。

**任务**

1. 增加 Codex 插件 manifest（`.codex-plugin/plugin.json` 或仓库约定的等价位置）；
2. 增加本地 stdio MCP 配置，指向独立 server 入口；
3. 建立 Skills 目录骨架，仅放职责说明，不承载权威状态；
4. 提供 MCP `health`、`version`、`status` 空壳工具；
5. 保持 `index.js` 的 DSH 注册路径不变；
6. 增加插件打包/安装/启动的 smoke test；
7. 记录 Codex 宿主对 manifest、MCP、Skills、Hooks 和 subagents 的实际支持边界。

**涉及文件/模块**

- `.codex-plugin/plugin.json`（新增）
- `.mcp.json` 或等价 MCP 配置（新增）
- `skills/`（新增骨架）
- `src/codex/`（新增 MCP server 入口）
- `test/codex-plugin-*.test.js`（新增）
- `package.json`（仅在确有必要时增加脚本/打包配置）

**交付物**

- 可启动的 stdio MCP server；
- `health/version/status` 可返回结构化 JSON；
- 插件骨架文档；
- DSH 入口兼容性证明。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-*.test.js
npm run lint
npm run format:check
npm pack --dry-run
```

另需执行一次 stdio MCP 启动/握手 smoke test，并保存命令、输入、输出和退出码。

**退出标准**

- MCP server 能被 Codex 或测试客户端启动并完成握手；
- 三个空壳工具可调用；
- 现有 v3/v4 测试不受影响；
- 未把任何生成行为标记为已验证。

**风险与回滚**

- 风险：Codex manifest 字段或目录约定与当前宿主版本不一致；
- 回滚：删除新增骨架文件，恢复 `package.json`，不触碰现有 `index.js` 和 v3/v4；
- 不在本阶段提交或推送。

---

### P1：权威状态、事件、审批与恢复内核

**目标**

建立所有后续阶段共用的安全内核：合法迁移、并发保护、不可篡改审计、可信人工审批和可恢复检查点。

**前置条件**

- P0 退出标准满足；
- 已确认 Codex 原生审批通道的实际调用方式。

**任务**

1. 定义 v1 状态枚举和统一迁移表；
2. 为状态增加单调递增版本号与 CAS 写入；
3. 增加 append-only 事件日志及 hash 链；
4. 实现状态变更与事件写入的原子顺序；
5. 实现 H1/H3 审批记录：审批人、时间、过期时间、nonce、artifact hash、消费状态、意见、结果；
6. 确保模型参数和普通文本不能签发审批；
7. 实现审批过期、hash 不匹配、重复使用、内容变化的失效逻辑；
8. 实现 `PAUSED`、恢复和 `CANCELLED` 检查点；
9. 实现统一重试计数和 `BLOCKED` 迁移；
10. 增加并发写入、进程中断恢复和审计链测试。

**涉及文件/模块**

- `src/codex/state-machine.*`（新增）
- `src/codex/events.*`（新增）
- `src/codex/approvals.*`（新增）
- `src/codex/checkpoints.*`（新增）
- `src/v3/state.js`、`src/v3/evidence.js`、`src/v3/approvals.js`（只读参考或兼容适配）
- `test/codex-state-*.test.js`、`test/codex-approval-*.test.js`（新增）

**交付物**

- 状态机 API；
- CAS 冲突返回结构化错误；
- append-only 事件日志；
- 可信审批 API；
- pause/resume/cancel API；
- 并发与恢复测试报告。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-*.test.js test/codex-approval-*.test.js
npm test
npm run lint
npm run format:check
```

**退出标准**

- 非法迁移被拒绝；
- 两个并发写入只有一个成功，另一个得到版本冲突；
- 旧审批、重复审批、过期审批和内容变化后的审批均被拒绝；
- 进程退出后可从最后检查点恢复；
- 事件链可验证；
- AC 27–29 有可执行测试证据。

**风险与回滚**

- 风险：Codex 审批能力若不能提供可验证的用户来源，必须 fail-closed；
- 风险：CAS 与 append-only 日志顺序设计错误会导致状态与证据不一致；
- 回滚：保留旧状态文件格式的只读兼容层，新增内核可单独关闭；
- 不在未验证审批来源时继续 P2 之后的人工门。

---

### P2：`sg-init` 生成能力

**目标**

把现有四档 Java/Vue 初始化能力迁入 Codex 插件，并补齐非空目录扫描、覆盖预览和可信覆盖审批。

**前置条件**

- P0 完成；
- P1 的状态与审批接口可用；
- v4 模板和 Golden 基线已确认。

**任务**

1. 实现 `/sg-init [--preset <preset>] [path]` 与 `sg_init` 工具；
2. 迁移四档 preset：`jdk8-boot2.7`、`jdk17-boot3.5`、`jdk21-boot3.5`、`jdk21-boot4.0`；
3. 默认 preset 为 `jdk8-boot2.7`，提示 legacy 风险；
4. `jdk21-boot4.0` 提示 preview 风险；
5. 生成后端、前端、Task CRUD、错误处理、H2 持久化、OpenAPI、测试配置和 README；
6. 生成 `.specgate/config.yaml`、`.specgate/monorepo.json`、`.specgate/init-report.json`；
7. 实现非空目录扫描：已有、将新增、冲突、将覆盖、将保留、Git 状态；
8. 默认只补齐缺失文件，不覆盖已有业务文件；
9. 已有 `.specgate/` 默认拒绝重新初始化；
10. 覆盖策略必须通过可信审批；
11. 生成后状态为 `GENERATED_ONLY`，`initializationComplete = false`；
12. 不安装、不编译、不启动服务；
13. 建立 Git 基线 commit 和 `init-baseline` tag；
14. 增加四档生成快照和 hash 测试。

**涉及文件/模块**

- `src/v4/java-init.js`
- `src/v4/java-versions.js`
- `src/v4/catalog.js`
- `src/v4/java-fullstack-template.js`
- `src/codex/commands/init.*`（新增）
- `src/codex/tools/init.*`（新增）
- `test/codex-init-*.test.js`（新增）
- `test/fixtures/init-*`（新增）

**交付物**

- 四档可生成脚手架；
- 示例 CRUD 与常见接口代码；
- 非空目录预览报告；
- 覆盖审批记录；
- `init-report.json`；
- Git 基线和 tag；
- 生成与验证分离的证据。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-init-*.test.js
npm test
npm run lint
npm run format:check
```

对四个 preset 分别执行生成，并校验文件清单、模板 hash、Git baseline 和 `GENERATED_ONLY`。此阶段不执行构建。

**退出标准**

- AC 1、2、4、5 有测试证据；
- 四档均能生成；
- 非空目录未获批准时零文件修改；
- 已有 `.specgate/` 不被覆盖；
- 生成结果不被标记为验证通过。

**风险与回滚**

- 风险：模板迁移导致 Golden hash 变化；
- 风险：非空目录预览与真实写入不一致；
- 回滚：删除新增 Codex 适配层，保留 v4 原实现；模板变更必须用真实生成结果更新 hash，不能手填。

---

### P3：`sg-verify` 真实验证

**目标**

把 v4 的真实构建、测试、运行时冒烟和覆盖率对账能力接入 Codex，并确保未执行项不被标记为通过。

**前置条件**

- P2 退出标准满足；
- 目标环境有可发现的 JDK/Maven/Node/npm，或明确记录缺失。

**任务**

1. 实现 `/sg-verify` 与 `sg_verify`；
2. 有界、跨平台发现工具链，优先复用已有安装；
3. 执行后端依赖安装、编译、单元测试、静态检查、格式检查；
4. 执行前端依赖安装、构建、单元测试、lint、格式检查；
5. 启动后端和前端，执行健康检查；
6. 执行基础 CRUD 冒烟测试；
7. 执行重启持久化验证；
8. 收集测试总数、通过/失败/跳过、覆盖率和失败原因；
9. 将命令、cwd、时间、退出码、stdout/stderr 写入证据；
10. 实现 `passed` / `failed` / `not-run` 对账；
11. 四档 Windows 真实验证并保存报告；
12. Linux 明确记录 `not-run`。

**涉及文件/模块**

- `src/v4/java-verify.js`
- `src/v4/verify-evidence.js`
- `src/v4/java-env.js`
- `src/v4/provision.js`（只读复用，不扩展自动下载）
- `src/codex/commands/verify.*`（新增）
- `src/codex/tools/verify.*`（新增）
- `test/codex-verify-*.test.js`（新增）

**交付物**

- 可执行 `sg-verify`；
- 真实验证报告；
- 四档 Windows 证据；
- `not-run` 清单；
- 覆盖率对账结果。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-verify-*.test.js
npm test
npm run lint
npm run format:check
```

对四个 preset 分别执行真实 `sg-verify`，不得只做静态检查。工具链缺失时记录 `not-run`，不得标记通过。

**退出标准**

- AC 3、6、30 有真实命令和运行时证据；
- 构建、测试、lint、格式和冒烟均有证据；
- 任一失败或未执行项不会被汇总为通过；
- 四档 Windows 结果可查询；
- Linux 未验证状态如实保留。

**风险与回滚**

- 风险：依赖下载或端口占用导致环境性失败；
- 风险：前端/后端启动后未清理进程；
- 回滚：保留失败证据，不删除 worktree；修正环境后重新执行，不把失败覆盖成通过；
- 不自动下载大型 SDK。

---

### P4：`sg-change --add` 需求闭环

**目标**

实现模糊需求输入、最多三轮澄清、结构化批判、H1 可信审批和不可变需求快照。

**前置条件**

- P1 的审批与状态内核可用；
- P3 的初始化验证证据存在；
- 目标仓库满足 clean、单一 active change 等前置条件。

**任务**

1. 实现 `/sg-change --add [change-name] "需求描述"` 与 `sg_change_add`；
2. 支持可选 name；缺省时生成稳定 slug；
3. 校验项目已初始化、已有真实验证证据、Git clean、无其他 active change；
4. 实现需求 Agent：最多 3 轮，每轮最多 5 个问题；
5. 覆盖功能、非功能、约束、验收、边界和失败场景；
6. 实现需求批判 Agent：反向复述、歧义、矛盾、不可实现点、遗漏风险、测试盲区；
7. 输出结构化批判报告并引用需求条目；
8. 区分阻断性未决问题与非阻断假设；
9. 展示需求草案并进入 H1；
10. H1 通过后生成不可变需求快照和 hash；
11. 记录审批人、时间、意见和审批 hash；
12. 旧审批在需求变化后自动失效。

**涉及文件/模块**

- `src/v3/requirements.js`
- `src/v3/reverse.js`
- `src/v3/requirements-doc.js`
- `src/codex/commands/change-add.*`（新增）
- `src/codex/agents/requirements.*`（新增）
- `src/codex/agents/critique.*`（新增）
- `test/codex-change-add-*.test.js`（新增）

**交付物**

- 需求澄清记录；
- 批判报告；
- H1 审批记录；
- 不可变需求快照；
- 单一 active change 锁；
- 前置条件拒绝报告。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-add-*.test.js
npm test
npm run lint
npm run format:check
```

**退出标准**

- AC 7–11 有测试证据；
- 最多 3 轮、每轮最多 5 个问题的限制可验证；
- 阻断性问题不能冻结；
- H1 前不能进入 Plan；
- 需求 hash 变化后旧审批失效；
- 第二个 active change 被拒绝且不排队。

**风险与回滚**

- 风险：需求 Agent 通过普通文本冒充用户回答；
- 风险：H1 审批通道不可用；
- 回滚：保留需求草稿和问答记录，状态停在 `H1_PENDING` 或 `BLOCKED`，不继续开发。

---

### P5：动态 Plan、契约和测试冻结

**目标**

根据冻结需求动态生成任务图，先冻结接口契约和数据模型，再冻结测试用例与可执行测试骨架。

**前置条件**

- P4 的 H1 已通过；
- 需求快照 hash 可验证；
- 状态处于 `REQ_FROZEN`。

**任务**

1. 根据 AC 动态拆分任务，不预设固定数量；
2. 生成接口契约任务、数据模型任务、后端任务、前端任务、测试任务、集成任务、文档任务；
3. 建立任务依赖图，最大并行开发任务数为 2；
4. 每个任务映射 AC、测试用例、负责角色、依赖和验收条件；
5. 先冻结接口契约和数据模型，再允许前后端任务并行；
6. 由 Test Agent 生成人类可读测试用例；
7. 生成可执行测试骨架、测试数据和夹具；
8. 生成 AC 与测试用例映射；
9. 计算并冻结测试资产 hash；
10. 实现受控解冻，记录原因、变更内容和影响范围；
11. 解冻后重新冻结并记录新 hash；
12. 将任务图、计划 hash、测试冻结信息写入 `.specgate/`；
13. 完整展示 Plan 和测试设计，但不设置 H2。

**涉及文件/模块**

- `src/v3/plan.js`
- `src/v3/acceptance.js`
- `src/v3/suites.js`
- `src/codex/plan/*`（新增）
- `src/codex/agents/test-design.*`（新增）
- `test/codex-plan-*.test.js`、`test/codex-test-freeze-*.test.js`（新增）

**交付物**

- 动态任务图；
- 契约冻结记录；
- 测试用例和骨架；
- AC 映射；
- 测试资产 hash；
- 受控解冻记录。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-*.test.js test/codex-test-freeze-*.test.js
npm test
npm run lint
npm run format:check
```

**退出标准**

- AC 12–14 有测试证据；
- 契约任务在前后端并行任务之前；
- 测试资产在开发前冻结；
- 每个任务都能映射到 AC 和测试用例；
- 无 H2 人工门；
- 未冻结测试时不得进入 `DEVELOPING`。

**风险与回滚**

- 风险：动态任务粒度过大或依赖环；
- 风险：测试骨架不可执行；
- 回滚：保留冻结 hash 和失败原因，重新生成 Plan 或测试资产，但必须记录新版本。

---

### P6：前后端并行开发与 worktree

**目标**

实现固定 frontend/backend/integration/test/review worktree，以及前端和后端两个开发 Agent 的并行执行和状态汇报。

**前置条件**

- P5 的契约和测试资产已冻结；
- 状态处于 `TEST_CASES_FROZEN`；
- Git 基线可用。

**任务**

1. 创建并登记 frontend、backend、integration、test、review worktree；
2. 前后端从同一契约冻结 commit 创建分支；
3. 前端 Agent 只修改前端 worktree；
4. 后端 Agent 只修改后端 worktree；
5. 两个 Agent 并行执行，最大并行数为 2；
6. 每个 Agent 汇报开始、完成、失败、阻塞；
7. 开发 Agent 不得修改测试资产；
8. 各自执行格式化和局部检查；
9. 各自提交到自己的分支；
10. 主 Agent 负责合并到 integration；
11. 合并冲突退回对应开发 Agent，不自动解决业务冲突；
12. 实现 task/worktree 状态与主状态同步；
13. 实现失败任务最多自动重试 2 次；
14. 取消后保留 worktree、分支、证据和日志。

**涉及文件/模块**

- `src/v3/worktrees.js`
- `src/v3/executor.js`
- `src/v3/pool.js`
- `src/v3/scheduler.js`
- `src/codex/worktrees/*`（新增）
- `src/codex/agents/frontend.*`、`src/codex/agents/backend.*`（新增）
- `test/codex-worktree-*.test.js`、`test/codex-parallel-dev-*.test.js`（新增）

**交付物**

- 五个 worktree；
- 前后端独立分支；
- 并行开发记录；
- integration 合并结果；
- 冲突退回记录；
- 状态同步事件。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-worktree-*.test.js test/codex-parallel-dev-*.test.js
npm test
npm run lint
npm run format:check
```

**退出标准**

- AC 15 有真实 Git/worktree 证据；
- 前后端确实并行且互不修改对方 worktree；
- 开发 Agent 未修改测试资产；
- integration 只由主 Agent 推进；
- 冲突不会静默自动解决；
- 取消后现场保留。

**风险与回滚**

- 风险：Codex subagent 并发上限或状态汇报能力不足；
- 风险：Windows 路径长度和 worktree 清理；
- 回滚：保留分支和 worktree，回到最后稳定 commit；不删除用户改动。

---

### P7：测试执行与质量门

**目标**

由 Test Agent 按冻结用例执行静态、单元、接口、集成和冒烟测试，并以真实覆盖率与缺陷级别做阻断判断。

**前置条件**

- P6 的 integration 合并完成；
- 测试资产 hash 未变化；
- 测试 worktree 可用。

**任务**

1. Test Agent 在 test worktree 检出 integration 分支；
2. 执行格式化检查、静态检查、lint、typecheck；
3. 执行前端和后端单元测试；
4. 执行接口测试和集成测试；
5. 启动真实后端并使用隔离测试配置；
6. 验证核心 CRUD 路径；
7. 执行前后端契约一致性检查；
8. 收集行覆盖率、分支覆盖率和变更代码覆盖率；
9. 校验行覆盖率 ≥80%、分支覆盖率 ≥70%、变更代码覆盖率 ≥90%；
10. 校验 P0/P1 = 0；
11. 校验所有冻结测试用例均已执行，无跳过；
12. 保存命令、cwd、时间、退出码、stdout/stderr、测试统计和覆盖率；
13. Test Agent 只写测试相关文件，不修改生产代码；
14. 失败时退回对应开发 Agent，最多自动重试 2 次；
15. 超过上限进入 `BLOCKED`。

**涉及文件/模块**

- `src/v3/quality.js`
- `src/v3/suites.js`
- `src/v3/testrunner.js`
- `src/v3/java-reports.js`
- `src/v4/coverage-evidence.js`
- `src/codex/quality/*`（新增）
- `src/codex/agents/test-runner.*`（新增）
- `test/codex-quality-*.test.js`（新增）

**交付物**

- 测试执行报告；
- 覆盖率报告；
- 缺陷统计；
- 质量门结论；
- 失败与重试证据。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-quality-*.test.js
npm test
npm run lint
npm run format:check
```

**退出标准**

- AC 16、19–21 有真实测试证据；
- 三类覆盖率阈值均达标；
- P0/P1 为 0；
- 所有冻结用例执行；
- 无静默跳过；
- 质量门失败时状态不能进入 `REVIEWING`。

**风险与回滚**

- 风险：覆盖率工具输出格式差异；
- 风险：集成测试端口、数据库或环境不稳定；
- 回滚：保留原始日志和报告，修正测试或实现后重跑；不得修改阈值或删除失败记录。

---

### P8：Review 三档与 H3

**目标**

实现按风险自动选择宽松/标准/严格三档 Review，只读审查，结构化报告和 H3 最终审批。

**前置条件**

- P7 质量门通过；
- 待审 commit 固定；
- review worktree 可用；
- 测试证据可引用。

**任务**

1. 计算结构化风险信号；
2. 根据风险自动选择 Review 档位；
3. 允许用户在 Review 前覆盖档位；
4. 宽松档只阻断 P0/P1；
5. 标准档阻断 P0/P1/P2；
6. 严格档阻断 P0/P1/P2/P3；
7. Review Agent 只读审查，不修改代码；
8. 输出 verdict、findings、严重级别、文件行号、需求映射、证据、修复建议；
9. 引用测试结果；
10. 生成结构化 Review 报告；
11. 展示 H3 审批所需的变更摘要、测试结果、Review 结果和归档预览；
12. H3 通过前禁止归档；
13. 普通缺陷在原 change 内修复、重测、复审；
14. 需求级问题或高风险设计问题新建关联 change；
15. 每次循环保留失败报告和修复证据；
16. 超过统一重试上限进入 `BLOCKED`。

**涉及文件/模块**

- `src/v3/review.js`
- `src/v3/gate-card.js`
- `src/v3/gate-summary.js`
- `src/codex/review/*`（新增）
- `src/codex/agents/reviewer.*`（新增）
- `test/codex-review-*.test.js`、`test/codex-h3-*.test.js`（新增）

**交付物**

- 三档 Review 实现；
- 风险选档记录；
- 结构化 Review 报告；
- H3 审批记录；
- 修复/重测/复审循环证据。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-review-*.test.js test/codex-h3-*.test.js
npm test
npm run lint
npm run format:check
```

**退出标准**

- AC 17–18 有测试证据；
- Review Agent 的只读约束可验证；
- 高风险信号触发严格审查；
- H3 前归档被拒绝；
- H3 审批与报告 hash 绑定；
- 报告变化后旧审批失效。

**风险与回滚**

- 风险：风险信号规则过宽或过窄；
- 风险：Review Agent 产生无证据 finding；
- 回滚：保留报告和测试证据，重新选档或复审；不删除失败记录。

---

### P9：归档、推送与端到端验收

**目标**

完成 H3 后的自动归档、commit、merge、push，覆盖无 remote 和 push 失败分支，并完成端到端验收。

**前置条件**

- P8 的 H3 已通过；
- 归档预览与当前 commit/证据一致；
- 目标分支和 remote 状态已确认。

**任务**

1. 展示归档前预览：目标分支、remote、commit、变更摘要、测试结果、Review 结果、未推送提交、未跟踪文件、合并影响；
2. H3 通过后自动 commit；
3. 合并到目标分支；
4. 有 remote 时推送目标分支；
5. 无 remote 时完成本地归档，状态为 `ARCHIVED_NOT_PUSHED`，明确提示“未推送”；
6. push 失败时状态为 `PUSH_FAILED`，不自动重试，不自动回滚或继续归档；
7. 永不执行 force push；
8. 移动 change 到归档目录；
9. 更新文档和任务归档；
10. 写入归档证据；
11. 实现暂停、恢复、取消在长流程中的端到端行为；
12. 完成 `sg-init` → `sg-verify` → `sg-change --add` → H1 → Plan → 测试冻结 → 并行开发 → 测试 → Review → H3 → 归档 的 E2E；
13. 执行四档初始化回归；
14. 生成 AC 1–30 的证据映射；
15. 记录残余风险和未验证平台。

**涉及文件/模块**

- `src/v3/archive.js`
- `src/v3/change.js`
- `src/v3/status.js`
- `src/codex/archive/*`（新增）
- `src/codex/git/*`（新增）
- `test/codex-archive-*.test.js`、`test/codex-e2e-*.test.js`（新增）
- `docs/verification/codex-sg-v1/*`（新增证据目录）

**交付物**

- 自动归档和推送；
- 无 remote/push failure 分支；
- 全流程 E2E 报告；
- 四档回归报告；
- AC 映射表；
- 残余风险清单。

**验证命令**

```powershell
node --import ./test/setup-temp.mjs --test test/codex-archive-*.test.js test/codex-e2e-*.test.js
npm test
npm run lint
npm run format:check
```

E2E 必须在隔离的临时仓库中执行，不得修改插件仓库或用户真实项目。

**退出标准**

- AC 22–26 有测试证据；
- H3 前归档被拒绝；
- 无 remote 时明确显示“未推送”；
- push 失败不自动重试；
- 无 force push；
- E2E 全流程通过；
- 30 条 AC 均有证据或明确 `not-run`；
- 四档 Windows 结果完整，Linux 未验证项如实保留。

**风险与回滚**

- 风险：push 失败后的本地状态与远端不一致；
- 风险：归档移动导致证据路径失效；
- 回滚：保留原分支、worktree、日志和归档上下文；由用户决定重试、保留本地归档、回滚或取消；
- 不自动执行 force push 或破坏性 Git 操作。

---

## 5. 阶段依赖图

```text
P0 插件骨架
  ↓
P1 状态/审批/恢复内核
  ↓
P2 sg-init 生成
  ↓
P3 sg-verify 真实验证
  ↓
P4 sg-change --add 需求闭环
  ↓
P5 动态 Plan/契约/测试冻结
  ↓
P6 前后端并行开发/worktree
  ↓
P7 测试执行/质量门
  ↓
P8 Review 三档/H3
  ↓
P9 归档/推送/E2E
```

依赖规则：

- P1 是 P2–P9 的安全前提；
- P3 是 P4 的前置条件；
- P5 的契约冻结必须先于 P6；
- P5 的测试冻结必须先于 P6 开发；
- P7 质量门必须先于 P8；
- P8 的 H3 必须先于 P9；
- 任一阶段失败时停在当前检查点，不跳阶段。

---

## 6. 全局验证策略

### 6.1 测试层级

1. **单元测试**：状态迁移、hash、审批失效、任务图、质量门；
2. **契约测试**：MCP 工具输入输出、错误码、事件结构；
3. **集成测试**：MCP 启动、命令路由、worktree、Git 合并、证据写入；
4. **运行时测试**：Java/Vue 构建、启动、健康检查、CRUD、重启持久化；
5. **E2E**：隔离仓库中的完整 change-add 闭环；
6. **回归测试**：四档初始化、现有 v3/v4 入口和打包。

### 6.2 每次变更的最小验证

```powershell
node --import ./test/setup-temp.mjs --test <focused-files>
npm test
npm run lint
npm run format:check
```

插件相关阶段增加：

```powershell
npm pack --dry-run
```

### 6.3 证据要求

每个检查记录：

- 命令；
- 工作目录；
- 开始/结束时间；
- 退出码；
- stdout/stderr；
- 测试统计；
- 覆盖率；
- 失败原因；
- 证据文件路径；
- 执行平台和工具链版本。

未执行项必须记录 `not-run`，不得省略或写成通过。

---

## 7. 质量门

### 7.1 代码质量门

- 格式化检查通过；
- lint 通过；
- typecheck 通过；
- 静态检查通过；
- 单元测试通过；
- 集成测试通过；
- 无 P0/P1 缺陷；
- 无静默跳过。

### 7.2 覆盖率门

- 行覆盖率 ≥ 80%；
- 分支覆盖率 ≥ 70%；
- 变更代码覆盖率 ≥ 90%。

### 7.3 流程质量门

- 需求冻结前不得开发；
- 测试资产冻结前不得开发；
- 契约冻结前不得并行前后端；
- Review 只读；
- H3 前不得归档；
- 审批 hash 不匹配不得推进；
- 状态版本冲突不得覆盖；
- 事件日志不可篡改。

### 7.4 证据门

- 生成成功不等于验证通过；
- 失败、跳过、未执行必须显式记录；
- 只有真实命令和运行时结果才能标记通过；
- 证据链必须可复核。

---

## 8. 失败与恢复策略

| 场景 | 状态 | 自动行为 | 用户可做 |
|---|---|---|---|
| 状态 CAS 冲突 | 当前状态 | 拒绝写入，返回版本冲突 | 重新读取后重试 |
| 审批过期/hash 不匹配 | 当前门 | 拒绝推进 | 重新审批 |
| 需求阻断问题未解决 | `BLOCKED` | 停止 | 修改需求或取消 |
| 测试资产变化 | `BLOCKED` | 停止开发 | 受控解冻并重新冻结 |
| 合并冲突 | `BLOCKED` | 退回开发 Agent，不自动解决 | 修复后恢复 |
| 质量门失败 | `BLOCKED` | 最多重试 2 次 | 修复、恢复或取消 |
| Review 高风险问题 | `BLOCKED` | 停止归档 | 修复、复审或新建关联 change |
| 无 remote | `ARCHIVED_NOT_PUSHED` | 本地归档，提示“未推送” | 配置 remote 后由用户决定 |
| push 失败 | `PUSH_FAILED` | 不自动重试、不回滚 | 重试、保留本地归档、回滚或取消 |
| 用户暂停 | `PAUSED` | 保留现场 | 恢复或取消 |
| 用户取消 | `CANCELLED` | 保留 worktree/证据/日志 | 查看或手动清理 |

恢复规则：

- 从最后稳定检查点继续；
- 不重复执行已确认完成的副作用；
- 不覆盖失败证据；
- 不删除用户代码或 worktree；
- 不无限循环。

---

## 9. 验收标准映射

| AC | 验收要求摘要 | 主要阶段 | 证据类型 |
|---|---|---|---|
| 1 | 四档生成脚手架和 CRUD | P2 | 生成清单、模板 hash、测试 |
| 2 | 默认 preset 与 legacy 提示 | P2 | 命令输出、测试 |
| 3 | 四档 Windows 真实验证 | P3 | 构建/测试/运行时报告 |
| 4 | 非空目录预览与不确认不修改 | P2 | 扫描报告、审批、文件快照 |
| 5 | init 不标记验证通过 | P2 | `GENERATED_ONLY` 报告 |
| 6 | verify 真实证据 | P3 | 命令日志、退出码、覆盖率 |
| 7 | change-add 模糊输入和可选名称 | P4 | 命令/工具测试 |
| 8 | 单一 active change | P4 | 锁与拒绝测试 |
| 9 | 最多 3 轮、每轮 5 问 | P4 | 访谈记录与限制测试 |
| 10 | 结构化批判报告 | P4 | 报告 schema 与样例 |
| 11 | H1 后不可变快照和 hash | P4 | 快照、hash、审批记录 |
| 12 | 动态拆分任务 | P5 | 任务图与 AC 映射 |
| 13 | 契约任务先于并行任务 | P5 | 依赖图断言 |
| 14 | 开发前冻结测试 | P5 | 测试资产 hash 与状态 |
| 15 | 前后端独立 worktree 并行 | P6 | Git/worktree/并行日志 |
| 16 | Test Agent 不改生产代码 | P7 | diff 约束与测试 |
| 17 | Review Agent 只读 | P8 | diff 为空与审查记录 |
| 18 | 三档 Review 与风险选档 | P8 | 风险信号与档位测试 |
| 19 | 覆盖率 80/70/90 | P7 | 覆盖率报告 |
| 20 | P0/P1 为 0 | P7 | 缺陷统计 |
| 21 | 静态/单元/接口/集成/冒烟通过 | P7 | 分类测试报告 |
| 22 | H3 前不得归档 | P8/P9 | 状态门测试 |
| 23 | H3 后自动 commit/merge/push | P9 | Git 与归档证据 |
| 24 | 无 remote 本地归档并提示未推送 | P9 | `ARCHIVED_NOT_PUSHED` 测试 |
| 25 | 永不 force push | P9 | 命令审计与测试 |
| 26 | push 失败不自动重试 | P9 | `PUSH_FAILED` 测试 |
| 27 | 状态版本/CAS | P1 | 并发测试 |
| 28 | append-only 事件日志 | P1 | hash 链验证 |
| 29 | 暂停/恢复/取消 | P1/P9 | 状态与 E2E 测试 |
| 30 | 未执行/失败不标记通过 | 所有阶段 | `not-run` 对账测试 |

---

## 10. 未决技术风险

1. Codex 原生审批通道的可用性和可测试方式必须以当前宿主版本为准；若不能证明用户来源，H1/H3 必须 fail-closed。
2. Codex subagents 的并发上限、生命周期和状态回报能力受宿主限制；P6 需要真实并发验证。
3. Codex 插件 manifest、MCP 配置、Skills 目录和 Hooks 的实际加载规则需要 P0 用可执行 smoke test 确认。
4. Windows 上 Java/Vue 工具链路径、端口、长路径和进程清理可能影响 P3/P7。
5. 四档模板的 Golden hash 必须由真实生成和验证结果产生，不能手填。
6. 前后端并行会增加合并冲突概率，P6 必须验证冲突退回而不是自动解决。
7. push 失败后的远端状态不可完全控制，P9 只能保证本地状态和证据一致，不承诺自动恢复远端。
8. 首版不覆盖 Linux 真实验收，Linux 只能记录 `not-run`。
9. Java 8/Spring Boot 2.7 是 legacy，Spring Boot 4.0 是 preview，风险需在初始化输出中明确提示。
10. 现有 v3 审批和状态实现不能直接视为满足新需求，必须通过 P1 的独立测试。

---

## 11. 当前状态

- 需求文稿：**v1.0 已批准**
- 实施计划：**v0.1 已批准并执行**
- 实施：**P0–P9 核心完成；Task priority 原生 Agent P6→P7 与 Customer CRM P6→P9 隔离闭环均已通过**
- 代码/配置/测试：**首个实现提交 `416303e` 已创建；Customer CRM 验收支持文件随第二个本地提交收敛，DSH/v3/v4 兼容**
- 本地验证：**首个提交质量门 `npm test` 553 总计，553 通过，0 失败，0 跳过；lint、format、JDK8 Java/Vue 构建与运行时验证通过**
- 原生 Agent E2E：**2/2 冻结 cases、后端 14/14、前端 12/12、9/9 验证阶段、changed-line 96.24%、P0/P1=0，最终 `REVIEWING`**
- Customer CRM E2E：**4/4 cases、后端 15/15、前端 12/12、9/9 stages、changed-line 91.36%、strict Review pass、本地 bare remote merge/push 成功，最终 `ARCHIVED`**
- 证据：[原生 Agent P6→P7 验收](../verification/codex-sg-v1/p6-p7-native-agent-e2e/README.md)、[Customer CRM P6→P9 验收](../verification/codex-sg-v1/customer-crm-native-e2e/README.md)、[阶段进度](codex-sg-change-add-v1-progress.md)
- Git 提交/推送：**插件分支 `sg-codex` 本地提交、tag `codex-sg-v1-local-20261021` 和源码归档已完成；未 push 或发布**
- 未完成：**Customer CRM 原生角色消费、真实 Review Agent、可信 H1/H3 宿主审批、产品 MCP 自动 subagent 桥、生产 remote push E2E**
- 下一步：**接入可信宿主链路并重放角色与审批；不得把 synthetic H3 或本地 bare remote 写成真实宿主/生产远程验收**

---

## 12. 阶段验收记录

- 用户已明确批准开始实施并要求从暂停点继续。
- P0–P9 核心与本地自动化回归已实施。
- 原生 Test/Frontend/Backend Agent 已在隔离生成产品上完成 P6→P7 E2E。
- P8/P9 已实现并通过隔离 Git/remote 回归；真实人工门不得由模型文本或测试夹具替代。
- Customer CRM 已从 red baseline 完整跑到 `ARCHIVED`，P7 changed-line coverage 91.36%，strict Review 与本地 bare remote push 均通过。
- Customer CRM 的 Test/Frontend/Backend/Review 原生 Agent 均未消费任务，证据保持 `not-run`。
- 插件仓库已创建本地提交和标签，仍未 push 或发布。
