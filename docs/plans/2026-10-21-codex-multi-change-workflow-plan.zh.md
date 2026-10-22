# Codex 多变更工作流阶段拆分与实施计划

- 状态：历史输入，已汇总到
  `docs/requirements/2026-10-22-codex-delivery-mvp-requirements-analysis.zh.md`
- 后续执行计划以需求分析文档为准
- 需求来源：`docs/requirements/2026-10-21-codex-multi-change-workflow.zh.md`
- 实现基线：`9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb`
- 工作分支：`codex/multi-change-workflow`
- 目标分支：`sg-codex`
- 目标版本：`4.3.2`
- 交付方式：功能分支形成一次完整提交，验证通过后本地合并，不 push、不发布

## 1. 实施策略

采用“需求冻结 -> 类型策略 -> 动态计划 -> Agent 路由 -> 共用门禁 -> 全量验证”的分阶段实施方式。

实施原则：

1. 先写失败测试，再写最小实现。
2. 每个阶段独立运行 focused tests，不把后续阶段成功作为前置阶段通过的证据。
3. 所有工作累计在 `codex/multi-change-workflow`，最后只形成一次功能提交。
4. 保持现有 `sg_change_add` 调用兼容，内部路由到 `feature`。
5. 不改变 Codex MCP 的审批权威、CAS 状态版本、冻结测试和审计链约束。
6. 不修改 DSH v3 代码、文档或测试。

## 2. 目标实现模型

### 2.1 变更类型

```text
changeType -> workflow -> implementation agents

feature    -> add      -> specgate_frontend / specgate_backend
fix        -> fixbug   -> specgate_frontend_fixer / specgate_backend_fixer
modify     -> modify   -> specgate_frontend / specgate_backend
delete     -> delete   -> specgate_frontend / specgate_backend
refactor   -> refactor -> specgate_frontend_refactorer / specgate_backend_refactorer
```

### 2.2 冻结元数据

需求冻结快照增加以下逻辑数据：

```json
{
  "change": {
    "schemaVersion": 1,
    "type": "fix",
    "workflow": "fixbug",
    "sides": ["frontend", "backend"],
    "compatibility": "compatible",
    "breakingChange": false,
    "docsImpact": []
  }
}
```

约束：

1. `type` 和 `workflow` 必须由服务端按固定映射计算，不能由客户端分别提交后形成不一致组合。
2. `sides` 只能包含 `frontend`、`backend`，至少一个。
3. `breakingChange` 必须为布尔值；为 true 时必须提供兼容性说明和文档影响。
4. 冻结后修改类型、工作流、前后端范围或破坏性判断，必须重新执行需求和 H1 流程。
5. 旧 change 缺少该元数据时，只允许 `sg_change_add` 创建的历史 feature 路径按 `feature` 补齐；其他来源 fail closed。

### 2.3 数据流

```text
用户请求
  -> 主 Agent 分析类型和前后端影响
  -> sg_change
  -> 需求修订 / 澄清 / Critique
  -> sg_change_propose 冻结候选 metadata + requirements
  -> H1
  -> Plan 生成动态任务图
  -> Test Designer
  -> Baseline
       feature/fix/modify/delete: red
       refactor: green
  -> 受影响侧的 Agent
  -> Integration
  -> Tester
  -> Formatter
  -> Reviewer
  -> H3
  -> Archive + local merge
```

## 3. 阶段总览

| 阶段 | 目标                       | 主要文件                                               | 退出条件                             |
| ---- | -------------------------- | ------------------------------------------------------ | ------------------------------------ |
| P0   | 基线、分支和 OpenSpec 工件 | `openspec/changes/multi-change-workflow/**`            | 基线检查通过，需求、设计、任务完整   |
| P1   | 类型策略和统一入口         | `change-policy.js`、`change-tools.js`、`change-add.js` | 五种类型可校验，`sg_change_add` 兼容 |
| P2   | 需求冻结元数据             | `change-add.js`、`state-machine.js` 相关测试           | H1 快照包含不可变 change metadata    |
| P3   | 动态计划与单端任务         | `plan.js`、`plan-tools.js`                             | 只生成受影响侧任务，冻结计划绑定类型 |
| P4   | Agent 动态路由             | `development.js`、四个新 `.toml`、Skill                | prepare/rework 返回正确 Agent        |
| P5   | 基线、Review 和本地合并    | `quality.js`、`review.js`、`release*.js`               | 五种类型走完整门禁，目标分支可配置   |
| P6   | 文档、版本和包清单         | README、CHANGELOG、manifest、lockfile                  | 版本 4.3.2，文档与实现一致           |
| P7   | 全量验证                   | 所有测试和打包检查                                     | 所有要求命令真实通过                 |
| P8   | 最终 Review、提交和合并    | Git 分支和交付证据                                     | 单次功能提交，本地合并且不 push      |

## 4. P0：基线、分支与 OpenSpec 工件

### 4.1 前置检查

确认需求文稿和本计划已经由用户批准。批准前不得执行以下分支操作。

批准后执行：

```powershell
git status --short --branch
git rev-parse HEAD
git switch -c codex/multi-change-workflow 9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb
```

预期：

1. 当前分支为 `codex/multi-change-workflow`。
2. 需求文稿和计划文稿保留在工作树中。
3. 不创建额外提交。

### 4.2 新增 OpenSpec 工件

新增：

- `openspec/changes/multi-change-workflow/proposal.md`
- `openspec/changes/multi-change-workflow/design.md`
- `openspec/changes/multi-change-workflow/tasks.md`
- `openspec/changes/multi-change-workflow/specs/codex-change-workflow/spec.md`

内容要求：

- proposal 写明背景、范围、非目标、受影响能力和兼容策略。
- spec 使用 `ADDED Requirements`，覆盖五种类型、动态派发、Bug 回归和重构不变量。
- design 写明 metadata、任务图、Agent 路由、baseline 模式和本地 release 决策。
- tasks 与本文档的阶段和验证命令一致。

### 4.3 基线验证

```powershell
npm test
npm run lint
npm run format:check
```

退出条件：

1. 若基线已有失败，记录失败命令、退出码和首个失败点。
2. 不把基线失败归因于本次实现。
3. 若失败阻断后续，先向用户报告，不在未确认时修复无关问题。

## 5. P1：类型策略和统一入口

### 5.1 新增类型策略模块

新增 `src/codex/change-policy.js`，只放可复用纯逻辑：

- `CHANGE_TYPES = ['feature', 'fix', 'modify', 'delete', 'refactor']`
- `WORKFLOW_BY_TYPE`
- `AGENT_BY_TYPE_AND_SIDE`
- `normalizeChangeMetadata(input, { legacyFeature })`
- `validateTypeDetails(type, details)`
- `baselineModeFor(type)`
- `sidesFor(details)`
- `agentFor(type, side)`

校验规则：

| 类型       | 必填                                                      |
| ---------- | --------------------------------------------------------- |
| `feature`  | 现有功能请求描述                                          |
| `fix`      | `bugDescription`、`expectedBehavior`、`actualBehavior`    |
| `modify`   | `targetFeature`、`desiredBehavior`、`compatibility`       |
| `delete`   | `targetFeature`、`compatibility`、`dataImpact`            |
| `refactor` | `scope`、`goals`、`nonGoals`、`invariants`、`constraints` |

所有文本必须有长度上限；`fix` 的可选日志不得超过现有工具参数上限；敏感内容在写入前执行脱敏。

### 5.2 增加统一 MCP 入口

修改 `src/codex/change-tools.js`：

1. 新增 `sg_change`，必填 `expectedVersion` 和通用 `request`，可选 `type` 与 `details`。
2. 保留 `sg_change_add`，默认 `type=feature`，参数语义保持兼容。
3. `sg_change_propose` 增加冻结候选 `change` metadata。
4. 工具描述明确：类型未确认时不得进入计划。
5. `CHANGE_METHODS` 将 `sg_change` 和 `sg_change_add` 都路由到同一服务方法，并记录入口类型。

修改 `src/codex/change-add.js`：

1. 保留现有服务逻辑，新增统一 `start` 分支。
2. 导出 `createChangeService`；保留 `createChangeAddService` 作为兼容别名。
3. 将入口工具、原始请求、类型提示和结构化 details 写入状态 context。
4. 若通用入口没有 `type`，允许需求分析继续，但 `propose` 时必须提供确认后的 metadata。

修改 `src/codex/workflow-tools.js`：

1. 使用兼容工厂构造 change service。
2. 将 `sg_change` 注册到工具集合。
3. 状态诊断增加 `changeType`、`workflow`、`sides` 和 Agent profile。

### 5.3 测试先行

先在以下文件增加失败测试：

- `test/codex-change-tools.test.js`
- `test/codex-change-add-flow.test.js`
- 新增 `test/codex-multi-change-workflow.test.js`

测试覆盖：

1. 拒绝未知 `changeType`。
2. 拒绝 type/workflow 不一致的 metadata。
3. `fix` 缺期望或实际行为时拒绝。
4. `modify/delete/refactor` 缺必填信息时拒绝。
5. `sg_change_add` 等价于 `type=feature`。
6. `sg_change` 未给类型时保存待确认状态，不进入计划。
7. requirement 文档包含敏感日志时拒绝或脱敏。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-workflow.test.js test/codex-change-tools.test.js test/codex-change-add-flow.test.js
```

退出条件：

1. 五种类型的校验错误码稳定。
2. 旧 `sg_change_add` 测试全部通过。
3. 未确认类型无法请求 H1。

## 6. P2：需求冻结与 change metadata

### 6.1 冻结候选需求

修改 `src/codex/change-add.js` 的 `propose`、`critique`、`requestH1` 和 snapshot 组装：

1. `sg_change_propose` 接收并校验 `change` metadata。
2. 服务端根据 `type` 计算 `workflow`，不接受客户端任意组合。
3. `snapshot` 保存 `change`、`request`、结构化 `details`、requirements 和 revisions。
4. `requestH1` 的 artifact hash 覆盖 change metadata。
5. 修改 metadata 后，旧 critique 和 H1 候选必须失效。

修改 `src/codex/state-machine.js` 仅在需要时增加 context 语义校验，不新增主阶段。

### 6.2 兼容旧快照

1. `sg_change_add` 创建的旧 change 可安全补为 feature。
2. 通用 `sg_change` 创建的旧快照缺 metadata 时返回 `CHANGE_METADATA_REQUIRED`。
3. 不允许按文件名或需求正文中的关键词猜测类型。

### 6.3 测试

扩展：

- `test/codex-change-add-flow.test.js`
- `test/codex-approval-state.test.js`
- `test/codex-state-kernel.test.js`

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-add-flow.test.js test/codex-approval-state.test.js test/codex-state-kernel.test.js
```

退出条件：

1. 修改 type、sides、breakingChange 或 docsImpact 后必须重新 Critique 和 H1。
2. H1 审计记录能追溯所选 workflow。
3. 旧 feature change 无兼容回归。

## 7. P3：动态任务图和单端计划

### 7.1 扩展任务图

修改 `src/codex/plan.js`：

1. `buildTaskGraph(snapshot)` 读取 `snapshot.change`。
2. 仅对 `sides` 中的端生成开发任务。
3. `validateGraph` 不再强制要求 frontend 和 backend 同时存在。
4. contract/model 任务保留，但 integration 依赖只引用实际存在的开发任务。
5. docs 任务按 `docsImpact` 生成，并把文档路径归属给受影响端。
6. `baselineMode` 写入 task acceptance 和 plan：
   - `feature/fix/modify/delete` 使用 `red`
   - `refactor` 使用 `green`
7. Plan body 增加 `changeType`、`workflow`、`sides`、`agentBySide`。

修改 `src/codex/plan-tools.js`：

1. `sg_plan_generate` 返回文件名、workflow、sides 和 Agent 映射。
2. 不向客户端开放任意 role 或 agent 参数。

### 7.2 文档任务归属

`docsImpact` 必须给出相对路径。前端文档由 frontend Agent 更新，后端/API/数据文档由 backend Agent 更新。两端共用的文档必须明确唯一 owner，不能两边同时修改同一文件。

### 7.3 测试

扩展：

- `test/codex-plan-core.test.js`
- `test/codex-tools-workflow.test.js`
- 新增 `test/codex-multi-change-plan.test.js`

测试覆盖：

1. frontend-only fix 不生成 backend 开发任务。
2. backend-only refactor 不生成 frontend 开发任务。
3. 双端 modify 生成两个独立任务。
4. delete 的测试和文档任务覆盖删除范围。
5. refactor 的 baselineMode 为 green。
6. 其他四种类型 baselineMode 为 red。
7. 重复 docs owner 或跨端路径冲突时计划失败。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-plan.test.js test/codex-plan-core.test.js test/codex-tools-workflow.test.js
```

退出条件：

1. 单端计划不再被 `PLAN_GRAPH_INVALID` 拒绝。
2. 每个 AC 都被测试、实现和文档任务覆盖。
3. Plan hash 包含类型和工作流，不能替换类型后复用旧计划。

## 8. P4：Agent 安装与动态路由

### 8.1 新增项目级 Agent

新增：

- `assets/codex/agents/specgate_frontend_fixer.toml`
- `assets/codex/agents/specgate_backend_fixer.toml`
- `assets/codex/agents/specgate_frontend_refactorer.toml`
- `assets/codex/agents/specgate_backend_refactorer.toml`

Agent 指令要求：

1. 只修改获分配的端内文件和计划列出的文档路径。
2. 不修改冻结测试、另一侧代码或 `.specgate` 状态。
3. Fixer 必须先阅读回归测试和失败证据。
4. Refactorer 必须先阅读行为不变量和现有测试。
5. 执行 focused checks，提交 commit，并返回实际命令、结果和风险。
6. 不创建子 Agent。

### 8.2 扩展 development 路由

修改 `src/codex/development.js`：

1. `prepare` 从冻结 plan 读取 types、sides 和 agent 映射。
2. 只为实际 sides 创建开发角色；integration/test/review/format worktree 保持现有结构。
3. `development.roles.<side>` 增加 `agentName`，由服务端计算。
4. `prepareRework` 和 `prepareRepair` 保持原 side 和同一 Agent 类型。
5. 未受影响侧标记 `skipped`，不产生空 commit 要求。
6. Role path policy 增加显式 docs paths，但仍阻止测试和其他侧代码。

### 8.3 更新 Skill 和安装器

修改：

- `skills/sg-codex/SKILL.md`
- `assets/codex/AGENTS.specgate.md`
- `src/codex/protocol.js`

更新内容：

1. 需求入口从 `sg_change_add` 改为 `sg_change`。
2. 说明 `sg_change_add` 仍为 feature 兼容别名。
3. 按 `changeType` 使用正确 Agent。
4. 说明 refactor baseline 是 green，其余类型是 red。
5. 说明单端 change 只派发该端 Agent。

`scripts/codex-source-setup.mjs` 继续动态读取 `.toml`，但测试必须锁定新的 10 个 Agent。

### 8.4 测试

扩展：

- `test/codex-development-flow.test.js`
- `test/codex-source-setup.test.js`
- `test/codex-format-rework.test.js`
- `test/codex-plugin-package.test.js`
- 新增 `test/codex-multi-change-routing.test.js`

测试覆盖：

1. 五类 change 的 Agent 名称正确。
2. 单端 change 只要求对应端提交。
3. fixer/refactorer 越界修改失败。
4. rework 使用同类 Agent 和新 round worktree。
5. setup 安装 10 个 Agent。
6. tarball 包含四个新 Agent。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-routing.test.js test/codex-development-flow.test.js test/codex-source-setup.test.js test/codex-format-rework.test.js test/codex-plugin-package.test.js
```

退出条件：

1. 主 Agent 能从 prepare 结果直接知道应派发哪个 Agent。
2. 不需要通过用户参数提交 Agent 名称。
3. 未受影响侧不能制造空 commit。

## 9. P5：真实基线、质量、Review 和本地合并

### 9.1 Baseline 策略

修改 `src/codex/development.js` 和 `src/codex/native-test-runner.mjs` 相关契约：

1. 将单一 red 基线抽象为 `baseline { mode, report, evidence }`。
2. `red` 模式必须证明测试在实现前真实失败。
3. `green` 模式必须证明重构前现有测试真实通过。
4. refactor 使用 green；其他四种使用 red。
5. 任何缺失、超时、跳过或报告解析失败均阻止开发。

扩展：

- `test/codex-native-runner.test.js`
- `test/codex-development-flow.test.js`

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-native-runner.test.js test/codex-development-flow.test.js test/codex-quality-gate.test.js
```

### 9.2 Review 策略

修改 `src/codex/review.js`：

1. Review challenge 包含 `changeType`、workflow、sides、compatibility 和 docsImpact。
2. Breaking change 必须检查需求、设计、API/OpenAPI、迁移和 CHANGELOG 的随动证据。
3. Refactor Review MUST 检查行为不变量和既有测试未被修改。
4. Delete Review MUST 检查删除范围、残留引用、测试替换和文档更新。

### 9.3 本地合并策略

修改：

- `src/codex/release.js`
- `src/codex/release-tools.js`
- `test/codex-review-release.test.js`

要求：

1. Archive 目标分支不再硬编码为 `main/master`，改为冻结 change metadata 或项目配置中的目标分支。
2. 默认执行本地 merge 和 archive，不自动 push。
3. push 必须由显式用户请求开启，默认关闭。
4. 合并冲突：
   - 简单代码冲突返回 owning agent 的新 round。
   - 测试、API、数据库、安全或语义冲突返回 `ARCHIVE_MERGE_CONFLICT_REQUIRES_USER`。
5. 归档报告记录 `pushed=false`、目标分支和最终 merge commit。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-review-release.test.js test/codex-quality-gate.test.js
```

退出条件：

1. `sg-codex` 可以作为合法目标分支。
2. 无 remote 或未请求 push 时只做本地合并。
3. 破坏性 API 未审批时不能进入 H3/归档。

## 10. P6：文档、版本和发布清单

### 10.1 更新文档

修改：

- `README.md`
- `README.en.md`
- `skills/sg-codex/SKILL.md`
- `CHANGELOG.md`
- `CHANGELOG.zh.md`
- `openspec/changes/multi-change-workflow/proposal.md`
- `openspec/changes/multi-change-workflow/design.md`
- `openspec/changes/multi-change-workflow/tasks.md`
- `openspec/changes/multi-change-workflow/specs/codex-change-workflow/spec.md`

README 必须包含：

1. `sg_change` 统一入口示例。
2. 五种类型各自需要的输入。
3. 单端和双端 Agent 派发示例。
4. Bug red 基线和 refactor green 基线。
5. 破坏性 API 定义和本地合并行为。

### 10.2 版本更新

修改：

- `package.json`
- `package-lock.json`
- `.codex-plugin/plugin.json`
- `plugin.json`

版本统一更新到 `4.3.2`。测试必须验证：

1. npm 包版本为 `4.3.2`。
2. 两个 Codex manifest 版本一致。
3. `.agents/plugins/marketplace.json` 仍指向当前插件。
4. 新 Agent TOML 被打包。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-package.test.js test/codex-source-setup.test.js
node node_modules/prettier/bin/prettier.cjs --check package.json package-lock.json .codex-plugin/plugin.json plugin.json
```

## 11. P7：全量验证

按以下顺序执行：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-workflow.test.js test/codex-multi-change-plan.test.js test/codex-multi-change-routing.test.js
npm test
npm run lint
npm run format:check
npm run pack:check
node scripts/codex-plugin-smoke.mjs
node scripts/verify-codex-matrix.mjs
git diff --check
```

验证矩阵：

| 场景               | 必验结果                             |
| ------------------ | ------------------------------------ |
| feature 双端       | add 工作流、frontend/backend         |
| fix 单端           | fixbug 工作流、只派一端              |
| fix 双端           | 两个 fixer 并行、回归测试由红转绿    |
| modify             | 现有 frontend/backend、兼容性文档    |
| delete             | 删除测试、残留引用和文档检查         |
| refactor           | green baseline、行为不变量、测试不改 |
| breaking change    | H1/H3 均显示风险，未审批时阻断       |
| 旧 `sg_change_add` | 等价 feature，行为不回归             |
| 合并冲突           | 简单冲突回 Agent，语义冲突停走       |
| 本地归档           | 合并 sg-codex，不 push               |

真实命令输出必须保存为最终交付证据。任何未执行或失败项必须明确列出。

## 12. P8：Review、单次提交和合并

### 12.1 最终 Review

检查：

1. 需求、spec、design、tasks、README、CHANGELOG 与实现一致。
2. 五种类型均有正反路径测试。
3. 前后端 Agent 边界无法绕过。
4. 旧 `sg_change_add` 兼容。
5. H1/H3、冻结测试、CAS 和审计链未被削弱。
6. 本地合并不触发 push。
7. 没有无关文件、Golden hash 或 DSH v3 改动。

### 12.2 单次提交

提交前：

```powershell
git status --short
git diff --check
git diff --stat
```

提交：

```powershell
git add --all
git commit -m "feat(codex): support multi-change workflows"
```

要求：

1. 仅形成一个功能提交。
2. 需求和计划文稿包含在该提交中。
3. 不提交 `.specgate` 临时运行产物、node_modules、dist 或 tgz。

### 12.3 本地合并

目标分支没有新提交时：

```powershell
git switch sg-codex
git merge --ff-only codex/multi-change-workflow
```

目标分支已有新提交时：

```powershell
git switch codex/multi-change-workflow
git rebase sg-codex
git switch sg-codex
git merge --ff-only codex/multi-change-workflow
```

合并后重新运行：

```powershell
npm test
npm run lint
npm run format:check
git status --short --branch
```

禁止：

1. 不 push。
2. 不发布 npm 包。
3. 不使用 force push。
4. 不在测试失败时合并。

## 13. 风险与处理

| 风险                       | 影响                          | 处理                                    |
| -------------------------- | ----------------------------- | --------------------------------------- |
| 现有 Plan 强制双端         | 单端 Bug/重构会产生空任务     | P3 先写单端失败测试并动态生成 sides     |
| 现有 Development 强制 red  | refactor 无法使用行为不变基线 | P5 引入 red/green baseline              |
| docs 任务无实际执行角色    | 文档随动可能只存在于计划      | P3 明确 docs owner，P4 role policy 校验 |
| `sg_change_add` 参数变化   | 旧调用方回归                  | 统一服务保留别名和默认 feature          |
| release 只允许 main/master | 无法合并 sg-codex             | P5 改为冻结目标分支                     |
| release 自动 push          | 违反本地交付要求              | P5 默认 push=false，显式请求才启用      |
| 旧快照缺少 metadata        | 读取失败或错误归类            | P2 仅对 legacy add 安全补齐             |
| 一提交包含较多变更         | Review 难度高                 | 阶段测试和最终完整 diff Review          |

## 14. 最终完成定义

以下条件全部满足才算完成：

1. 需求文稿和本计划已确认。
2. `sg_change` 支持五种类型并在 H1 冻结类型、工作流、sides 和兼容性。
3. `sg_change_add` 向后兼容。
4. Plan 能正确生成单端或双端任务。
5. Bug 使用前后端 fixer，重构使用前后端 refactorer。
6. Modify/delete 复用现有前后端 Agent。
7. 所有类型复用测试、格式化、Review、H3、归档和本地合并。
8. 文档和版本号 `4.3.2` 已同步。
9. focused tests、全量测试、lint、格式、打包、smoke 和 matrix 均有真实结果。
10. `codex/multi-change-workflow` 只有一个功能提交，并已本地合并到 `sg-codex`。
