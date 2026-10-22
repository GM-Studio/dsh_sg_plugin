# Codex 双入口交付保证工作流实施计划

- 状态：实现与真实项目试点完成；待用户决定提交、发布和是否补充真实客户仓库试点
- 日期：2026-10-22
- 计划版本：1.0
- 需求来源：
  `docs/requirements/2026-10-22-codex-delivery-mvp-requirements-analysis.zh.md`
- 需求版本：2.1
- 实现基线：`9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb`
- 当前分支：`sg-codex`
- 首版技术范围：Java/Vue
- 执行方式：可靠串行闭环
- 交付方式：完成真实验证后由用户决定是否提交、合并或推送

## 冻结记录

- 需求 2.1 SHA-256：
  `81171E6A6B8A7E6CB0DA555CA409CEC87278E3A7AAF011DD5460F0916C4B79A8`
- 本计划审批快照 SHA-256：
  `CD8BFBAA25C44B1240716284AA5EF8C3C2EFB81C278ED60DFAD03DAAF4265248`
- P0 基线：`npm test` 161/161 通过；`npm run lint` 通过；
  `npm run format:check` 通过。

本文档只定义任务拆分、依赖、顺序、验证和退出条件，不表示实现已经获批。
在用户明确批准开始实现前，不修改源码、不创建功能分支、不提交、不推送。

## 1. 实施目标

把 2.1 需求落地为一条完整纵向闭环：

```text
新建项目或接入存量项目
  -> ProjectProfile + ProjectBaseline
  -> ChangeContract
  -> H1
  -> 串行实现
  -> 独立验证和风险门禁
  -> H3
  -> DeliveryRecord + 双交付包
  -> 客户反馈
  -> 增量再交付
```

本计划不以“增加 Agent 数量”“实现复杂并行”“完成全部内部阶段”为完成标准。
每个阶段必须产生用户可验证的结果，并留下可复核的测试证据。

## 2. 已确定的设计约束

1. `src/codex/state-machine.js` 继续作为当前 Codex 活动 Change 的状态权威。
2. 不复用或恢复版本命名的 DSH/v3/v4 状态入口。
3. ProjectProfile、ProjectBaseline、Evidence 和 DeliveryRecord 是新增交付模型，
   不与旧 `src/codex/core/state.js` 混用。
4. 新项目与存量项目在建立 Baseline 后进入同一 Change 流程。
5. `sg_init` 只用于新项目；`sg_adopt` 只用于存量项目。
6. 默认串行执行，不实现多工作项并行、文件锁调度或并行 DAG。
7. 格式化、构建、测试和运行继续调用项目已有工具与命令，不自研替代品。
8. 证据必须绑定固定 commit；Agent 自述不能作为验证通过依据。
9. 技术验证、客户验收、推送和部署状态必须分开保存。
10. 默认不部署生产环境，不自动操作生产数据库。
11. 默认不推送；只有目标环境已通过 H3、`remoteUrl` 有效且 `push=true`
    才执行非强制推送。
12. 所有实现任务先写失败测试，再写最小实现，再做最近范围回归。
13. 未经用户明确授权，不使用子 Agent 并行实现本计划。

## 3. 目标模块

新增模块：

- `src/codex/project-model.js`
  - ProjectProfile、ProjectBaseline、ChangeContract、Evidence、
    VerificationAssessment 和 DeliveryRecord 的结构校验与状态规则。
- `src/codex/core/artifact-store.js`
  - 项目内的安全相对路径、不可变 JSON 写入、内容哈希和读取校验。
- `src/codex/project-detect.js`
  - Java/Vue 项目识别、命令发现、测试框架和关键目录的有界只读扫描。
- `src/codex/project-new.js`
  - 新项目生成、验证完成后建立 new-mode ProjectProfile 和 Baseline。
- `src/codex/project-adopt.js`
  - 存量项目只读预览、脏工作区确认提交、adopted baseline 建立。
- `src/codex/baseline.js`
  - Baseline 命令执行、已知失败签名、当前结果差异和测试抖动记录。
- `src/codex/change-policy.js`
  - feature/modify/fix 输入规则、必填字段和风险提示。
- `src/codex/environment-fingerprint.js`
  - 记录运行时、工具链、数据库、浏览器和配置摘要。
- `src/codex/verification.js`
  - AC 证据充分性、验证独立性、代码审查要求和 H3 前验证评估。
- `src/codex/delivery.js`
  - DeliveryRecord、本地 tag、内部工程包和客户交付包。
- `src/codex/incremental.js`
  - 上一 Delivery 引用、影响分析、历史 AC/测试复用和失效规则。
- `src/codex/project-tools.js`
  - 项目接入、基线、状态和显式推送相关 MCP 工具定义。

主要修改模块：

- `src/codex/workflow-tools.js`
- `src/codex/change-tools.js`
- `src/codex/change-add.js`
- `src/codex/plan.js`
- `src/codex/plan-tools.js`
- `src/codex/development.js`
- `src/codex/quality.js`
- `src/codex/review.js`
- `src/codex/release.js`
- `src/codex/release-tools.js`
- `src/codex/init.js`
- `src/codex/verify.js`
- `skills/sg-codex/SKILL.md`
- `skills/setup/SKILL.md`
- `assets/codex/AGENTS.specgate.md`

## 4. 阶段总览

| 阶段 | 目标                    | 主要依赖        | 退出条件                                 |
| ---- | ----------------------- | --------------- | ---------------------------------------- |
| P0   | 基线和 OpenSpec 工件    | 需求 2.1        | 基线证据完整，规格/设计/任务一致         |
| P1   | 交付领域模型和安全存储  | P0              | 模型单测通过，路径与不可变写入受测       |
| P2   | 新项目可靠基线          | P1              | 生成、验证、ProjectProfile/Baseline 闭环 |
| P3   | 存量项目接入            | P1、P2 共用模型 | 只读预览、确认提交、adopted baseline     |
| P4   | 统一 ChangeContract     | P2、P3          | feature/modify/fix 和旧入口兼容          |
| P5   | 串行实现与独立验证      | P4              | 串行计划、证据、环境指纹和风险门禁       |
| P6   | DeliveryRecord 和交付包 | P5              | H3 生成不可变交付和双包                  |
| P7   | 增量再交付              | P6              | 引用上一 Delivery、复用/失效和回归       |
| P8   | Skill、安装、文档和版本 | P2-P7           | 用户体验收敛，打包与安装通过             |
| P9   | 全量和真实项目试点      | 全部            | 自动化全绿，试点记录真实结果             |

## 5. P0：基线、规格和实现闸门

### P0-01 记录当前基线

- [ ] 执行：

```powershell
git status --short --branch
git rev-parse HEAD
```

- [ ] 确认 HEAD 为
      `9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb` 或记录偏离原因。
- [ ] 保留当前未跟踪的需求和计划文档，不覆盖用户工作区变化。
- [ ] 在实现分支创建前再次确认目标分支和分支命名。

### P0-02 建立 OpenSpec 工件

- [ ] 新增 `openspec/changes/codex-delivery-assurance/proposal.md`。
- [ ] 新增
      `openspec/changes/codex-delivery-assurance/specs/delivery-assurance/spec.md`。
- [ ] 新增 `openspec/changes/codex-delivery-assurance/design.md`。
- [ ] 新增 `openspec/changes/codex-delivery-assurance/tasks.md`。

内容要求：

- proposal 只写为什么做、范围、非目标和受影响能力。
- spec 只写可观察行为，覆盖双入口、基线、证据、交付和增量。
- design 说明 ProjectProfile、Baseline、Evidence、DeliveryRecord 的边界和
  与现有 `state-machine.js` 的关系。
- tasks 与本计划的阶段保持一一对应。

### P0-03 运行基线验证

- [ ] 执行：

```powershell
npm test
npm run lint
npm run format:check
```

- [ ] 逐项记录退出码、失败命令和首个失败原因。
- [ ] 基线失败不得归因于后续实现，也不得在未确认时修复无关问题。

P0 退出条件：

- 基线 commit、工作区和失败状态有真实记录。
- OpenSpec proposal、spec、design、tasks 与需求 2.1 一致。
- 用户明确批准开始实现。

## 6. P1：交付领域模型和安全存储

### P1-01 先定义失败测试

- [ ] 新增 `test/codex-project-model.test.js`。
- [ ] 新增 `test/codex-artifact-store.test.js`。

测试必须覆盖：

1. `mode` 仅允许 `new` 和 `adopted`。
2. adopted baseline 允许 `green`、`known-failures`、`partial` 和 `unknown`。
3. `unknown` baseline 不能用于开始 Change。
4. ChangeContract 只允许 feature/modify/fix。
5. Evidence 状态不能把 skipped/not-run/timeout 转为 passed。
6. VerificationAssessment 在 Red 风险缺少代码审查时不能进入 `requires-h3`。
7. DeliveryRecord 不接受覆盖已有 deliveryId。
8. 技术验证、客户验收、推送和部署状态保持独立。
9. 明文凭据不能让 ProjectProfile、Evidence 或 DeliveryRecord 通过校验。
10. artifact store 拒绝路径逃逸、符号链接、硬链接和超限文件。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-model.test.js test/codex-artifact-store.test.js
```

### P1-02 实现领域模型

- [ ] 新增 `src/codex/project-model.js`。
- [ ] 为每个模型提供纯校验函数和稳定错误码。
- [ ] 所有文本字段设置长度上限。
- [ ] 所有 ID 使用稳定格式，不接受客户端注入审批或用户身份。
- [ ] DeliveryRecord 状态转换使用显式允许表。

### P1-03 实现安全 artifact store

- [ ] 新增 `src/codex/core/artifact-store.js`。
- [ ] 提供安全路径解析、规范化 JSON、SHA-256 哈希、不可变写入和读取校验。
- [ ] 写入使用同目录临时文件加原子替换。
- [ ] 已存在相同哈希时幂等返回；存在不同内容时拒绝覆盖。
- [ ] 不修改 `src/codex/core/state.js`。

### P1-04 调整持久化边界

- [ ] 修改 `src/codex/init.js` 生成的 `.specgate/.gitignore`。
- [ ] 保持 worktrees、原始日志和大体积运行产物本地忽略。
- [ ] 将 `.specgate/codex/project.json`、baselines、已接受的 Change 契约和
      DeliveryRecord 从全局 `/codex/` 忽略规则中分离。
- [ ] 客户包允许单独导出，不默认把内部原始日志放进版本库。
- [ ] 在 `test/codex-init-adapter.test.js` 增加对应断言。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-model.test.js test/codex-artifact-store.test.js test/codex-init-adapter.test.js test/codex-state-kernel.test.js
```

P1 退出条件：

- 模型校验和持久化测试真实通过。
- 不存在未受测的任意路径写入。
- ProjectProfile 和 DeliveryRecord 可以独立读取，不依赖当前 Agent 会话。

## 7. P2：新项目可靠基线

### P2-01 编写新项目闭环测试

- [ ] 新增 `test/codex-project-new.test.js`。

测试必须覆盖：

1. `sg_init` 只生成时不能形成正式 ProjectBaseline。
2. `sg_verify` 失败或取消时不能形成 new-mode ready 状态。
3. `sg_verify` 完整通过后生成 ProjectProfile 和 `green` Baseline。
4. ProjectProfile 记录命令、目标分支、环境指纹和受保护路径。
5. Baseline 绑定生成的 commit 和验证 run。
6. 旧 `sg_init_preview -> sg_init -> sg_verify` 调用仍然可用。
7. 新项目业务需求不能由初始化步骤直接实现。

### P2-02 实现新项目基线服务

- [ ] 新增 `src/codex/project-new.js`。
- [ ] 复用 `previewInit`、`executeInit` 和 `verifyProject`，不复制生成器。
- [ ] 只在完整验证成功后写入 ProjectProfile 和 ProjectBaseline。
- [ ] 将验证 report、source hash、环境指纹和 commit 绑定到 Baseline。
- [ ] 提供读取和 preview 能力，不允许客户端伪造验证结果。

### P2-03 抽取有界项目探针

- [ ] 新增 `src/codex/project-detect.js`。
- [ ] 从 `src/codex/verify.js` 抽取项目路径、Java/Vue 标记和命令边界判断。
- [ ] `verify.js` 保留现有 Java/Vue 初始化验证语义。
- [ ] 扫描限制目录数、文件数、文件大小和输出大小。
- [ ] 不跟随符号链接或硬链接。
- [ ] 在 `test/codex-verify-adapter.test.js` 增加重命名不改变行为的回归。

### P2-04 接入工具与状态诊断

- [ ] 修改 `src/codex/workflow-tools.js`，注册项目基线工具。
- [ ] 状态诊断区分 `projectReady`、`mode`、`baselineStatus` 和
      `changeReady`。
- [ ] `sg_change_preflight` 不再要求 `.specgate/init-report.json`，改为要求
      有效 ProjectProfile 和可开始 Change 的 Baseline。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-new.test.js test/codex-init-adapter.test.js test/codex-verify-adapter.test.js test/codex-tools-workflow.test.js
```

P2 退出条件：

- 新项目可从空目录进入统一 Change 流程。
- 生成-only、验证失败或取消不会生成可用 Baseline。
- 旧新项目调用路径无回归。

## 8. P3：存量项目接入

### P3-01 编写只读预览测试

- [ ] 新增 `test/codex-project-detect.test.js`。
- [ ] 新增 `test/codex-project-adopt.test.js`。
- [ ] 新增 `test/codex-baseline.test.js`。

测试必须覆盖：

1. 已存在 Java/Vue Git 项目无需 `.specgate` 即可只读扫描。
2. 非 Java/Vue 项目返回 `PROJECT_STACK_UNSUPPORTED`。
3. 预览不写文件、不建 commit、不建 tag、不写正式配置。
4. 脏工作区展示 tracked/untracked 文件和拟提交说明。
5. 未批准、批准清单漂移或提交失败时不产生基线。
6. 批准后只提交确认文件，不使用 `git add -A`。
7. 提交后重新扫描，工作区仍脏时不得形成 Baseline。
8. 已知失败记录稳定签名、证据和影响范围。
9. 新失败与 knownFailures 分类正确。
10. 无测试项目产生 `partial` 或明确风险，不伪造 green。

### P3-02 实现项目探测

- [ ] 完成 `src/codex/project-detect.js`。
- [ ] 识别 Java/Vue 根、模块、构建文件、测试目录、运行时和命令候选。
- [ ] 命令以 argv 数组保存，不通过 shell 拼接。
- [ ] 发现结果标记来源：`detected`、`user-confirmed` 或 `default`。
- [ ] 无法安全识别的命令保持未验证，不猜测通过。

### P3-03 实现脏工作区确认提交

- [ ] 新增 `src/codex/project-adopt.js`。
- [ ] 预览返回文件清单、状态、敏感文件风险和内容哈希。
- [ ] 用户批准必须通过现有可信原生审批通道，不接受工具参数伪造。
- [ ] 使用显式路径 `git add -- <approved paths>`。
- [ ] 提交后校验新 commit、文件清单和干净工作区。
- [ ] 提交失败或清单漂移时保留原工作区并返回明确错误码。

### P3-04 实现 adopted baseline

- [ ] 完成 `src/codex/baseline.js`。
- [ ] 执行用户确认的 build/test/lint/runtime 基线命令。
- [ ] 记录命令退出码、耗时、日志路径、哈希和状态。
- [ ] 从失败报告提取稳定签名，但不把偶发失败自动列为 knownFailure。
- [ ] 形成 `green`、`known-failures`、`partial` 或 `unknown` 状态。
- [ ] Baseline 必须绑定当前 commit、环境指纹和 ProjectProfile 版本。

### P3-05 接入存量项目工具与 Change 前置

- [ ] 新增 `src/codex/project-tools.js`。
- [ ] 注册只读 preview、确认提交、应用接入、运行 baseline 和读取状态工具。
- [ ] 修改 `src/codex/change-add.js` 的 `inspectPrerequisites`。
- [ ] 仅允许有效 ProjectProfile 和可开始 Change 的 Baseline。
- [ ] 识别旧 SpecGate 初始化项目时通过迁移预览生成 ProjectProfile，
      不静默覆盖旧状态。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-detect.test.js test/codex-project-adopt.test.js test/codex-baseline.test.js test/codex-change-add-flow.test.js test/codex-change-tools.test.js test/codex-tools-workflow.test.js
```

P3 退出条件：

- 存量 Java/Vue 项目无需 `sg_init` 即可接入。
- 脏工作区只在明确批准后提交确认文件。
- knownFailures 和 newFailures 可区分。
- 无测试或测试不足不会被标记为 green。

## 9. P4：统一 ChangeContract

### P4-01 编写类型和契约测试

- [ ] 新增 `test/codex-change-policy.test.js`。
- [ ] 扩展 `test/codex-change-tools.test.js`。
- [ ] 扩展 `test/codex-change-add-flow.test.js`。

测试必须覆盖：

1. `sg_change` 支持 feature/modify/fix。
2. `sg_change_add` 等价于 feature 兼容入口。
3. fix 缺少问题、期望或实际行为时拒绝。
4. modify 缺少现有行为、目标变化或兼容性时拒绝。
5. ChangeContract 保存非目标、AC、风险和验证方式。
6. H1 artifact hash 覆盖 ChangeContract。
7. 契约变化后旧 critique/H1 失效。
8. 凭据或敏感日志被拒绝或脱敏。
9. 无 parentDeliveryId 的 Change 是普通交付。
10. 未确认 Baseline 或脏工作区不能创建 Change。

### P4-02 实现 ChangePolicy

- [ ] 新增 `src/codex/change-policy.js`。
- [ ] 定义 `feature`、`modify`、`fix` 的必填字段和长度上限。
- [ ] 提供风险建议，但不允许模型自行降低服务端升级后的风险。
- [ ] 所有纯规则有表驱动测试。

### P4-03 接入统一入口

- [ ] 修改 `src/codex/change-tools.js`，新增 `sg_change`。
- [ ] 将 `sg_change_add` 路由到 feature 兼容入口。
- [ ] 修改 `src/codex/change-add.js` 保存 ChangeContract 和基线引用。
- [ ] 修改 `src/codex/workflow-tools.js` 注册新入口并保持 CAS 版本。
- [ ] 保留 H1 原生审批和 fail-closed 行为。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-change-tools.test.js test/codex-change-add-flow.test.js test/codex-approval-state.test.js test/codex-state-kernel.test.js
```

P4 退出条件：

- feature/modify/fix 走同一确认和冻结模型。
- 旧 `sg_change_add` 行为兼容。
- 契约修改会正确使 H1 和受影响证据失效。

## 10. P5：串行实现、环境指纹和独立验证

### P5-01 编写串行计划测试

- [ ] 扩展 `test/codex-plan-core.test.js`。
- [ ] 扩展 `test/codex-tools-workflow.test.js`。
- [ ] 新增 `test/codex-serial-execution.test.js`。

测试必须覆盖：

1. 默认计划 `maxParallelDevelopment === 1`。
2. 单端变更不生成无关端实现任务。
3. 双端变更按显式顺序执行，不并发启动。
4. 契约、测试和实现依赖顺序保持可验证。
5. 一个实现任务失败时，后续依赖任务阻断。
6. 无关已完成任务不被重复执行。

### P5-02 调整为可靠串行图

- [ ] 修改 `src/codex/plan.js` 的任务图生成和校验。
- [ ] 仅根据 ChangeContract 的实际 sides 生成实现任务。
- [ ] 将默认并行度设为 1。
- [ ] 保留 contract、test、implementation、integration、review 的可审计关系。
- [ ] 修改 `src/codex/plan-tools.js` 的工具描述和返回值。
- [ ] 修改 `src/codex/development.js`，按依赖顺序执行实现任务。
- [ ] 未受影响角色标记 skipped，不要求空 commit。

### P5-03 编写环境指纹和验证评估测试

- [ ] 新增 `test/codex-environment-fingerprint.test.js`。
- [ ] 新增 `test/codex-verification.test.js`。

测试必须覆盖：

1. 指纹记录 OS、Java、Node、包管理器、数据库和浏览器版本。
2. 指纹不包含环境变量值，只记录名称。
3. 环境主版本变化使旧证据失效。
4. Green/Yellow/Red 对应不同的最低独立性。
5. 同一上下文的自述不能成为独立验证。
6. 只有无关单测无法证明视觉或业务 AC。
7. skipped、not-run、timeout、cancelled 不可转为 passed。
8. Red 风险缺少固定 commit 审查时不能进入 `requires-h3`。
9. 测试抖动、重试和隔离显式记录。
10. 风险只能由服务端规则升级，除非用户明确确认降级。

### P5-04 实现环境指纹和 VerificationAssessment

- [ ] 新增 `src/codex/environment-fingerprint.js`。
- [ ] 复用现有 Java/Vue 验证报告中的环境和工具链信息。
- [ ] 新增 `src/codex/verification.js`。
- [ ] 将 AC、Evidence、风险、独立性、环境和 Review 要求汇总为
      VerificationAssessment。
- [ ] 修改 `src/codex/quality.js` 记录 flaky、重试、隔离和未执行项。
- [ ] 修改 `src/codex/review.js` 读取 VerificationAssessment。
- [ ] 高风险变更要求固定 commit 的独立 Review。

### P5-05 更新 Codex 执行 Skill

- [ ] 修改 `skills/sg-codex/SKILL.md`。
- [ ] 实现者完成后由干净上下文的独立验证者检查 AC 和证据。
- [ ] 验证者不接收实现者的自评结论作为通过依据。
- [ ] 验证失败时只回灌结构化缺陷，不要求用户手工拼接内部阶段。
- [ ] 高风险变更增加固定 diff Review。
- [ ] 不新增并行 Agent 编排。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js test/codex-tools-workflow.test.js test/codex-serial-execution.test.js test/codex-environment-fingerprint.test.js test/codex-verification.test.js test/codex-development-flow.test.js test/codex-quality-gate.test.js test/codex-review-release.test.js
```

P5 退出条件：

- 默认执行路径为串行并有真实依赖测试。
- 每个 AC 有充分性明确的证据。
- 环境变化不会错误复用旧验证。
- Red 风险不能用自动测试替代代码审查。
- 验证失败有结构化恢复路径。

## 11. P6：DeliveryRecord、双交付包和显式推送

### P6-01 编写交付测试

- [ ] 新增 `test/codex-delivery-record.test.js`。
- [ ] 新增 `test/codex-delivery-pack.test.js`。
- [ ] 扩展 `test/codex-review-release.test.js`。

测试必须覆盖：

1. H3 前不能生成 accepted DeliveryRecord。
2. H3 后生成不可变 DeliveryRecord 和本地 tag。
3. DeliveryRecord 绑定 commit、AC、证据、环境、Review 和回退说明。
4. DeliveryRecord 不覆盖上一版本。
5. 内部包保留原始证据，客户包不泄露内部路径、日志或凭据。
6. 目标分支来自 ProjectProfile，不能硬编码 main/master。
7. 仅 remoteUrl 不推送。
8. push=false 时保持本地交付。
9. H3 后且 push=true 时才推送目标分支。
10. push 失败保留本地交付和错误证据，不强推、不无限重试。
11. 技术验证、验收、推送和部署状态不会混淆。

### P6-02 实现 DeliveryRecord

- [ ] 新增 `src/codex/delivery.js`。
- [ ] H3 通过后写入不可变 DeliveryRecord。
- [ ] 创建本地 annotated tag。
- [ ] DeliveryRecord 引用 ProjectBaseline、VerificationAssessment、H3 审批、
      Review、环境指纹和回滚信息。
- [ ] 生成 `CHANGE_VERIFIED`、`DELIVERY_ACCEPTED`、`PUSHED` 和部署状态记录。

### P6-03 生成双交付包

- [ ] 在 `src/codex/delivery.js` 生成内部工程证据包。
- [ ] 在 `src/codex/delivery.js` 生成客户可读交付包。
- [ ] 客户包只包含范围、AC、验证步骤、已知问题、升级和回退说明。
- [ ] 对客户包执行凭据和内部路径泄漏检查。
- [ ] 两个包引用同一个 deliveryId 和 commit。

### P6-04 改造 Release 和 Review

- [ ] 修改 `src/codex/review.js` 的 H3 preview。
- [ ] 修改 `src/codex/release.js` 的目标分支来源。
- [ ] 修改 `src/codex/release.js` 的 push 决策，要求显式 `push=true`。
- [ ] 修改 `src/codex/release-tools.js` 的输入 schema。
- [ ] 修改 `src/codex/workflow-tools.js` 保证 push 参数不能绕过 H3。
- [ ] 保留现有 H3 事件链和审批哈希校验。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-delivery-record.test.js test/codex-delivery-pack.test.js test/codex-review-release.test.js test/codex-approval-state.test.js test/codex-state-kernel.test.js
```

P6 退出条件：

- H3 可生成真实 DeliveryRecord 和双交付包。
- 目标分支可配置，默认本地交付。
- 远程推送仅在明确授权后发生。

## 12. P7：增量再交付

### P7-01 编写增量测试

- [ ] 新增 `test/codex-incremental-delivery.test.js`。

测试必须覆盖：

1. 新 Change 必须引用已存在且 accepted 的 parent Delivery。
2. parent delivery commit 成为影响分析基线。
3. 历史 AC 和测试被标记为 reused/invalidated。
4. 受需求变化影响的旧测试不得静默覆盖或删除。
5. 增量交付保留上一 Delivery 的证据。
6. 未受影响历史回归可按策略执行，高风险执行完整回归。
7. 新 Delivery 不覆盖父 Delivery。
8. 不属于同一项目的 deliveryId 被拒绝。
9. 已损坏或被篡改的 DeliveryRecord 阻断增量流程。

### P7-02 实现影响分析

- [ ] 新增 `src/codex/incremental.js`。
- [ ] 读取 parent Delivery 和上一契约。
- [ ] 校验 parent commit 与当前项目关系。
- [ ] 生成受影响 AC、代码路径、测试、API、数据、配置和环境清单。
- [ ] 只把 Codex 的结果记录为分析建议。
- [ ] SpecGate 校验文件、测试和证据引用。

### P7-03 接入 Change 和 Delivery

- [ ] 修改 `src/codex/change-policy.js` 支持 `parentDeliveryId`。
- [ ] 修改 `src/codex/change-tools.js` 和 `src/codex/change-add.js` 校验父交付。
- [ ] 修改 `src/codex/delivery.js` 保存 parentDeliveryId。
- [ ] 修改 `src/codex/verification.js` 纳入复用和失效 AC。
- [ ] 历史测试替换必须保留旧版本、原因和新版本。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-incremental-delivery.test.js test/codex-change-policy.test.js test/codex-change-tools.test.js test/codex-delivery-record.test.js test/codex-verification.test.js
```

P7 退出条件：

- 客户反馈能够从上一已接受交付开始。
- 历史 AC、测试和证据可复用或受控失效。
- 新 DeliveryRecord 与父交付形成不可变血缘。

## 13. P8：Skill、安装、文档和版本

### P8-01 收敛用户体验

- [ ] 修改 `skills/sg-codex/SKILL.md`。
- [ ] 用户可见流程只表达四个状态：
  - 项目就绪
  - 变更已确认
  - 证据已就绪
  - 交付已接受
- [ ] Skill 负责内部工具顺序，用户不需要手工串联。
- [ ] 项目接入、Change、验证、交付和反馈各有明确入口。

### P8-02 更新项目 Agent

- [ ] 修改 `assets/codex/AGENTS.specgate.md`。
- [ ] 保留实现者与独立验证者边界。
- [ ] 高风险变更要求固定 commit Reviewer。
- [ ] 不让实现 Agent 写测试结果或验证评估的通过结论。
- [ ] 如新增 Agent 模板，必须同步更新
      `scripts/codex-source-setup.mjs` 和 `test/codex-source-setup.test.js`。

### P8-03 更新文档和包

- [ ] 修改 `README.md` 和 `README.en.md`。
- [ ] 修改 `CHANGELOG.md` 和 `CHANGELOG.zh.md`。
- [ ] 修改 `plugin.json`、`.codex-plugin/plugin.json` 和 `package.json`。
- [ ] 修改 `package-lock.json`。
- [ ] 在发布前单独确认版本号；不在 P0-P7 提前修改版本。
- [ ] 更新 `test/codex-plugin-package.test.js` 和
      `test/codex-plugin-protocol.test.js`。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-source-setup.test.js test/codex-plugin-package.test.js test/codex-plugin-protocol.test.js test/codex-peer-server.test.js
npm run format:check
npm run pack:check
```

P8 退出条件：

- 用户体验不再暴露复杂内部编排。
- Skill 与工具 schema 一致。
- 包内包含新模型、工具、文档和 Agent 模板。

## 14. P9：全量验证和真实项目试点

### P9-01 自动化验证

- [ ] 按阶段运行 focused tests。
- [ ] 执行：

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
node scripts/codex-plugin-smoke.mjs
node scripts/verify-codex-matrix.mjs
git diff --check
```

- [ ] 记录每条命令的退出码、耗时、通过/失败状态。
- [ ] 任何未执行、跳过或失败项保持原状态并单独报告。

### P9-02 真实项目试点

- [ ] 选择至少 3 个真实 Java/Vue 项目。
- [ ] 覆盖至少 3 个新建项目场景。
- [ ] 覆盖至少 6 个存量项目变更场景。
- [ ] 覆盖 feature、modify 和 fix。
- [ ] 覆盖脏工作区确认提交。
- [ ] 覆盖 known-failures 或 partial baseline。
- [ ] 覆盖至少一次失败恢复。
- [ ] 覆盖至少一次增量再交付。
- [ ] 覆盖远程 push 成功和失败路径。

每个试点记录：

- 接入耗时。
- 首次可演示时间。
- 最终验收时间。
- 人工决策次数。
- 恢复所需操作次数。
- 手工阶段数量。
- 返工轮次。
- 新失败和遗漏回归。
- token 和工具执行成本。
- DeliveryRecord 和双交付包是否实际可用。

### P9-03 产品判断

首轮临时阈值：

- 存量项目接入不超过 10 分钟，不含依赖安装时间。
- 每次变更主要人工决策不超过 2 次。
- 常规变更相对裸用 Codex 的额外耗时不超过 30%。
- 返工轮次、遗漏回归或验收争议中至少一项降低 30%。
- 所有交付结论绑定当前 commit 和真实验证环境。
- 没有无证据通过、静默跳过或未确认脏提交。

若只增加时间而没有降低返工、验收成本或交付风险：

- 停止扩张功能。
- 删除冗余阶段和 Agent。
- 先修复价值闭环，再继续实现高级能力。

P9 退出条件：

- 自动化验证全部有真实结果。
- 试点证据完整。
- 是否继续、裁剪或停止有明确结论。

## 15. 需求追踪矩阵

| 需求                    | 实现阶段   |
| ----------------------- | ---------- |
| FR-001 新项目基线       | P2         |
| FR-002 存量项目接入     | P3         |
| FR-003 双入口统一       | P2、P3、P4 |
| FR-004 脏工作区         | P3         |
| FR-005 基线失败         | P1、P3     |
| FR-006 Change 类型      | P4         |
| FR-007 Fix 红转绿       | P4、P5     |
| FR-008 H1 和 H3         | P4、P6     |
| FR-009 串行交付         | P5         |
| FR-010 证据绑定         | P1、P5     |
| FR-011 DeliveryRecord   | P6         |
| FR-012 双交付包         | P6         |
| FR-013 增量再交付       | P7         |
| FR-014 恢复             | P3、P5、P7 |
| FR-015 回退说明         | P6         |
| FR-016 远程推送         | P6         |
| FR-017 旧入口兼容       | P4         |
| FR-018 项目模式隔离     | P2、P3     |
| FR-019 验证独立性       | P5         |
| FR-020 证据充分性       | P5         |
| FR-021 环境指纹         | P1、P5     |
| FR-022 测试稳定性       | P3、P5     |
| FR-023 交付状态         | P6         |
| FR-024 注意力预算       | P8、P9     |
| FR-025 交付记录可迁移性 | P1、P6     |

## 16. 关键风险与处理

| 风险                             | 影响                     | 处理                                     |
| -------------------------------- | ------------------------ | ---------------------------------------- |
| 现有 Change 前置强制 init-report | 存量项目无法接入         | P2/P3 改为 ProjectProfile + Baseline     |
| `verify.js` 与 init 产物耦合     | 存量项目无法验证         | P2 抽取只读项目探针，保留旧验证能力      |
| Release 硬编码 main/master       | 客户项目目标分支不可交付 | P6 从 ProjectProfile 读取目标分支        |
| Release 有 remote 就推送         | 未授权上传               | P6 改为 H3 + remoteUrl + push=true       |
| Plan 和 Development 仍并行       | 违反串行决策             | P5 强制 maxParallel=1 并按依赖顺序执行   |
| Agent 自己实现并自证             | 责任真空未解决           | P5 使用干净上下文独立验证和高风险 Review |
| Evidence 只有测试报告            | 业务 AC 可能无覆盖       | P5 引入证据充分性矩阵                    |
| 环境变化复用旧结果               | 假通过                   | P5 环境指纹和失效规则                    |
| Flaky test 洗成通过              | 新缺陷被掩盖             | P3/P5 保留所有重试和隔离证据             |
| DeliveryRecord 被覆盖            | 增量血缘丢失             | P1/P6 使用不可变写入和版本化             |
| 客户包泄露内部信息               | 商业和安全风险           | P6 客户包脱敏和独立生成                  |
| 试点只追求速度                   | 产品价值未证明           | P9 同时比较返工、验收成本和注意力        |

## 17. 执行规则

每个任务必须遵循：

1. 先写或修改测试，确认失败原因与任务目标一致。
2. 实现最小变更使目标测试通过。
3. 运行目标测试和最近相关回归。
4. 只有在测试保持通过时才做必要重构。
5. 每个阶段结束运行一次 focused suite。
6. 不在失败测试基础上继续堆叠后续阶段。
7. 不把初始化生成、计划生成、Agent 摘要或打包成功当作真实验证。
8. 不静默跳过、删除或重试失败测试。
9. 不修改用户未授权的分支、提交或远程仓库。

## 18. 审批点

### 实施前

用户必须明确批准：

- 本计划。
- 实现目标分支和分支命名。
- 是否允许创建功能分支。

### 每个阶段完成

阶段完成后展示：

- 完成的任务。
- 修改的文件。
- focused test 命令和结果。
- 未执行或失败项。
- 下一阶段依赖和风险。

### 交付或推送前

用户必须明确确认：

- H3 交付内容。
- 本地 tag 和 DeliveryRecord。
- 是否设置 `push=true`。
- 远程仓库 URL 和目标分支。

## 19. 明确不纳入本计划

- 多工作项并行执行。
- 文件锁调度器和复杂 DAG。
- 通用 Agent Runtime 或自研 Harness。
- 任意技术栈自动接入。
- 客户 CRM、报价、发票或项目组合管理。
- 自动生产部署。
- 自动生产数据库回滚。
- 依赖不存在证据的自动“合规评分”。

## 20. 最终完成定义

1. 新项目和存量 Java/Vue 项目可进入同一交付内核。
2. 存量项目无需 `sg_init`，脏工作区按 B 方案处理。
3. ProjectProfile、ProjectBaseline、Evidence、VerificationAssessment 和
   DeliveryRecord 均有真实测试覆盖。
4. Change feature/modify/fix 走统一契约和 H1。
5. 默认可靠串行执行，不依赖并行调度完成交付。
6. 独立验证、环境指纹、证据充分性和风险审查按需求工作。
7. H3 生成不可变 DeliveryRecord、本地 tag 和双交付包。
8. 只有显式授权且 H3 通过后才推送，不 force push。
9. 客户反馈能引用上一 Delivery 完成增量再交付。
10. 失败恢复不会重跑无关工作。
11. focused tests、全量测试、lint、格式、打包、smoke 和 matrix 均有真实结果。
12. 真实项目试点完成，并依据指标决定继续、裁剪或停止。
