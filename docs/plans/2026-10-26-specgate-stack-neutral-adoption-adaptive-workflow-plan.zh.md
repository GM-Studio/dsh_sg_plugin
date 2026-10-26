# SpecGate 技术栈无关接入与自适应开发工作流 · 任务拆分与里程碑计划（v0.1）

- 计划状态：**v0.1-candidate（未批准）**
- 日期：2026-10-26
- 适用仓库：SpecGate Codex 插件（当前 `package.json` 版本 `0.3.4`，分支 `sg-codex`）
- 需求来源：`docs/requirements/2026-10-26-specgate-stack-neutral-adoption-adaptive-workflow.zh.md`（需求候选 v0.1）
- 本文件性质：**只做任务拆分与里程碑**。不含实施、不改源码/测试/配置/插件清单、不改既有需求与计划、不建业务 Change、不提交推送。

## 关联文档

| 文档                                                                                   | 状态          | 本计划如何使用                                                                      |
| -------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `docs/requirements/2026-10-26-specgate-stack-neutral-adoption-adaptive-workflow.zh.md` | 需求候选 v0.1 | **唯一需求来源**：D01–D09、FR-01–FR-10、AC-01–AC-36、NFR-01–09、E2E-01–09、OI-01–08 |
| `docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md`              | v2.0-approved | 历史已批准计划；**不被本计划取代**，本计划在其交付语义之上演进                      |
| `docs/implementation/specgate-core-mvp-v2/13-canary-closure-correction.md`             | 候选          | AC-32 的实证依据（运行约束被误建为业务 AC）                                         |
| `AGENTS.md`                                                                            | 生效          | HTTP 契约、用户改动保护、运行时目录、验证要求；本计划不撤销                         |

## 计划权威与边界

### 权威来源

本计划只把需求 doc 的 D01–D09 与 FR/NFR/E2E 拆成可执行顺序与门槛，**不新增需求、不放宽需求、不改写语义**。

发生下列任一情况必须停止实施并回到需求层重新审批，不得就地改计划：

1. 需要改变某条 AC 的判定口径；
2. 需要放宽某条 NFR 的边界（尤其 NFR-02 数据边界、NFR-03 敏感内容、NFR-07 用户改动保护）；
3. 需要突破 D08 的默认资源限制；
4. 某条 OI 的结论会改变里程碑划分。

### 本计划明确不做的事

- 不把「任意技术栈可扫描」解释为「任意技术栈可完整自动执行」。能力缺口必须显式表达（需求 §4 末段、AC-03）。
- 不引入版本命名的兼容运行时目录或导入（`AGENTS.md`、需求 §8）。因此实施产物目录采用 `docs/implementation/stack-neutral-adoption/`，不带版本后缀。
- 不为 FR-05 之外的平台（macOS/ARM64）承诺真实验收，只做预留标注（AC-17）。
- 不把业务生产灰度纳入本计划（需求 §4、FR-09 末段）。

### 文档授权边界

本文件只记录拆分与里程碑。写入本文件不构成：需求已冻结、计划已批准、安装已授权、开发已授权、交付已授权（对应 AC-36 的分离原则）。

---

## 1. 现状基线（本次只读扫描结论）

以下全部为本次扫描的**真实代码证据**，不是推测。扫描方式：文件读取、ripgrep、`git status`、模块导出核对。未运行任何业务脚本、未安装依赖、未创建工作树、未提交。

### 1.1 技术栈绑定证据

| #    | 观察                                                                   | 证据                                                                                      | 影响需求             |
| ---- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------- |
| B-01 | 接入检测强制「Maven 根 + 前端 package 根」，否则整体拒绝               | `src/codex/project-detect.js:235-241`（`PROJECT_STACK_UNSUPPORTED`）                      | FR-01 / AC-01、AC-02 |
| B-02 | ProjectProfile 校验把 `stack` 硬钉为 `java-vue`                        | `src/codex/project-model.js:128`                                                          | FR-02 / AC-02、OI-08 |
| B-03 | ProjectProfile 字段集含 Java/Vue 专属约定字段                          | `src/codex/project-model.js:101-121`（`backendPackage`/`frontendFramework`/`javaPreset`） | FR-02 / AC-04、OI-08 |
| B-04 | 采纳预览与落盘把 `stack: 'java-vue'` 写死                              | `src/codex/project-adopt.js:91`、`:116`                                                   | FR-02 / AC-02        |
| B-05 | 新建项目写死 `stack: 'java-vue'`                                       | `src/codex/project-new.js:117`                                                            | FR-01 / AC-02        |
| B-06 | 初始化模板固定 `codex-java-vue-template` 与 java-vue 预设              | `src/codex/init.js:754`、`src/codex/core/java/java-init.js:243-247`                       | FR-01 / AC-02        |
| B-07 | 环境计划从固定 `backend/pom.xml` 与 `frontend/package.json` 推断       | `src/codex/core/environment.js:38`、`:54`                                                 | FR-03 / AC-11        |
| B-08 | 环境工具参数枚举固定 3 组 JDK/Boot 与 `vue`/`react`                    | `src/codex/environment-tools.js:2-4`                                                      | FR-03 / AC-11、D02   |
| B-09 | 验证阶段固定 8 段 Java/Vue 流水线，质量门再追加 `frontend-runtime`     | `src/codex/core/java/verify-evidence.js:7-17`、`src/codex/quality.js:14`                  | FR-06 / AC-22、FR-09 |
| B-10 | 验证入口以 `metadata.stack !== 'java-vue'` 直接拒绝                    | `src/codex/verify.js:166`、`src/codex/core/java/java-verify.js:348`                       | FR-01 / AC-01        |
| B-11 | 计划图校验强制 `maxParallelDevelopment === 1`，生成时写死 1            | `src/codex/plan.js:162`、`:403`                                                           | FR-08 / AC-26、D08   |
| B-12 | 任务种类固定 8 种、角色固定 6 种，且 `contract`/`model` 映射到 backend | `src/codex/plan.js:19-38`                                                                 | FR-07 / AC-22、AC-23 |
| B-13 | 开发角色固定 `frontend`/`backend` 两角色并行实施                       | `src/codex/development.js:13-14`                                                          | FR-07 / AC-22、FR-08 |
| B-14 | 开发前置要求每个冻结 case 真实失败（全红基线）                         | `src/codex/development.js:469`（`redBaseline`）；失败即 `RED_REPORT_INVALID`              | FR-06 / AC-20、AC-21 |

### 1.2 可复用但当前未接线的能力

| 能力                                | 证据                                                                                                            | 复用价值                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 多构建系统套件探测与执行            | `src/codex/core/suites.js:54`（`suggestSuites`）、`:42-143`（maven/gradle/pytest/node-test/command）            | 直接支撑 FR-01 AC-01 与 FR-06    |
| 上述套件在 `src/` 内**零引用**      | ripgrep `core/suites.js` 在 `src/ scripts/ test/` 无导入方                                                      | 属「已实现未接通」，是低成本起点 |
| 有界环境发现（根目录数/条目数上限） | `src/codex/core/java/java-env.js:136-139`（`maxEntries`、`roots.slice(0,16)`）、`:380`/`:495`（`slice(0,128)`） | 直接满足 NFR-01 的「有界」原则   |
| 安装包校验                          | `src/codex/core/environment-install.js:14-31`（`verifyArchive`）                                                | 支撑 FR-04 AC-14                 |
| 审批权威（一次性消费 + 门禁授权）   | `src/codex/approvals.js:332`（`consume`）、`:377`（`authorizeGate`）                                            | 支撑 FR-10 AC-36 的分离          |
| 验证结果分类状态                    | `src/codex/adopted-verification.js:15-16`（`RESULT_STATES`/`FAILURE_STATES`，含 not-run）                       | 支撑 FR-10 AC-34                 |
| 已知失败基线索引                    | `src/codex/adopted-verification.js:21`（`knownFailureIndex`）                                                   | 支撑 OI-03 准入                  |

### 1.3 语义漂移与不一致（必须在重基线中收敛）

| #    | 问题                                                                   | 证据                                                                                           |
| ---- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| D-01 | 变更类型词表三处不一致：`feature/modify/fix` 与 `…/remove` 并存        | `src/codex/change-policy.js:3` vs `src/codex/core/state.js:22`、`src/codex/core/change.js:398` |
| D-02 | 需求要求的「重构」既不在 `change-policy` 词表，也无对应验证策略        | 需求 FR-06 / AC-19；`src/codex/change-policy.js:57-72` 仅对 fix/modify 设必填                  |
| D-03 | 「并发必须为 1」与 D06/D08 冲突，且是**校验层**拒绝而非配置项          | `src/codex/plan.js:162`（`!== 1` → `PLAN_GRAPH_INVALID`）                                      |
| D-04 | 「所有冻结 case 必须全红」为全局约束，无法按场景豁免                   | `src/codex/development.js:469-503`；需求 §8 明确要求正式重基线化                               |
| D-05 | 发行包排除项与「源码保留能力/默认公开能力/发行能力」三态未显式建模     | `package.json:38-48`（排除 control/management/channels/installer 等）                          |
| D-06 | 工具面数字漂移：`CHANGELOG` 声称 43 个工具，源码实存 51 个 `sg_*` 名称 | `CHANGELOG.zh.md:5` vs `src/codex/**` 的 `sg_` 定义集合                                        |

### 1.4 跨平台与发行现状

| 观察                                       | 证据                                                                        | 影响                          |
| ------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------- |
| CI 仅在 Windows 上验证                     | `.github/workflows/codex.yml:10`（`runs-on: windows-latest`）               | FR-05 / AC-16                 |
| 清单要求 win32 + linux 双平台记录          | `src/codex/core/java/java-versions.js:54`（`requiredPlatforms`）            | AC-16、AC-17                  |
| 矩阵脚本只为一个平台背书，其余留 `not-run` | `scripts/verify-codex-matrix.mjs:16-31`                                     | 与 AC-16 方向一致，可直接复用 |
| 路径/可执行文件已有平台分支                | `src/codex/core/env/java.js`、`maven.js`、`gradle.js` 的 `isWindows()` 分支 | 支撑 NFR-08                   |

### 1.5 影响面规模

- 测试文件总数：**102**（`test/*.test.js`）。
- 直接钉住 `java-vue` / `PROJECT_STACK_UNSUPPORTED` / `maxParallelDevelopment` 的测试文件：**13** 个 —— `codex-adopted-verification`、`codex-change-add-flow`、`codex-dev-launcher`、`codex-development-flow`、`codex-plan-core`、`codex-plugin-package`、`codex-project-conventions`、`codex-project-detect`、`codex-project-model`、`codex-project-new`、`codex-quality-gate`、`codex-review-release`、`codex-verify-adapter`。
- 结论：**这不是「放宽一个入口」的改动**，是一次跨检测/模型/计划/执行/验证/发行六层的重基线。M1 独立成门禁里程碑正基于此。

### 1.6 工作树状态（本次扫描时）

`git status --porcelain` 显示存在未提交修改（`src/codex/development.js`、`src/codex/management/server.js`、`eslint.config.js` 及 3 个 docs/test 文件）与未跟踪产物。**NFR-07 要求保留**：任何里程碑不得覆盖、回退或提交这些改动。

---

## 2. 里程碑总览

| 里程碑 | 名称                     | 目标                                                                   | 覆盖需求                   | 退出后状态                     |
| ------ | ------------------------ | ---------------------------------------------------------------------- | -------------------------- | ------------------------------ |
| M0     | 基线取证与影响面测绘     | 把第 1 节结论固化为可复核产物，给出 AC/NFR/OI 三向追溯                 | NFR-04、NFR-07             | 实施有可信起点                 |
| M1     | **约束重基线门禁**       | 把全红门禁/并发=1/类型词表/Profile schema 版本化，旧约束不再硬编码拒绝 | AC-19、AC-20、AC-24、OI-08 | 后续里程碑无需绕过校验即可演进 |
| M2     | 技术栈无关发现与候选基线 | 任意仓库可只读识别并产出带证据类别的候选需求基线                       | FR-01、FR-02               | 存量仓库先被理解，而非先被拒绝 |
| M3     | 环境能力发现与受批安装   | 按任务推导能力、优先复用、缺项受批安装并真实复验                       | FR-03、FR-04               | 环境状态可区分、不伪造         |
| M4     | 跨平台执行与引导边界     | Windows/Linux x64 双平台真实证据；macOS/ARM64 明确预留                 | FR-05                      | 平台差异被隔离，预留不冒充验收 |
| M5     | 四类场景验证策略         | 新增/修改/修复/重构各有合法验证策略                                    | FR-06                      | 场景与验证一一对应             |
| M6     | 可调度计划与动态并发     | 按模块与依赖建图、动态并发、预算与集成绑定                             | FR-07、FR-08               | 并行受控且可追溯               |
| M7     | 影响范围验证与证据审批   | 按影响选验证集、结论分层报告、五类审批分离                             | FR-09、FR-10               | 证据真实、授权不互相顶替       |
| M8     | 端到端验收与发布         | E2E-01–09 全部真实通过，双平台证据齐备                                 | E2E-01–09、全部 NFR        | 可发布                         |

### 2.1 依赖链

```text
M0 基线取证与影响面测绘
 └─ M1 约束重基线门禁        ← 硬门禁：未通过不得进入 M2
     └─ M2 技术栈无关发现与候选基线
         └─ M3 环境能力发现与受批安装
             └─ M4 跨平台执行与引导边界
                 └─ M5 四类场景验证策略
                     └─ M6 可调度计划与动态并发
                         └─ M7 影响范围验证与证据审批
                             └─ M8 端到端验收与发布
```

约束：

- 每个里程碑必须通过自身「退出门」才能进入下一个；不得并行跳过。
- M1 未通过时，M2 及之后**一律不得开工**——否则会在既有硬编码上再叠一层临时绕过，违反需求 §8。
- M3 与 M4 的 Windows 部分可交错推进，但 M4 的 Linux 证据必须在 M5 之前到位（否则 FR-06 的平台无关性无法成立）。
- M8 未完成前不得宣称「技术栈无关接入已交付」。

### 2.2 FR → 里程碑覆盖矩阵

| 需求  | 里程碑 | 关键交付                                                    |
| ----- | ------ | ----------------------------------------------------------- |
| FR-01 | M2     | 语言/构建/包管理器/锁文件/模块/入口/CI/文档的只读识别       |
| FR-02 | M2     | 候选需求基线 + 证据类别 + 快照标识 + 确认/纠正/拒绝         |
| FR-03 | M3     | 能力推导 + 有界发现 + 兼容性判定 + 复用优先                 |
| FR-04 | M3     | 安装方案契约 + 批量批准 + 隔离位置 + 安装后真实复验         |
| FR-05 | M4     | 双平台真实证据 + 平台抽象 + 预留标注 + 启动依赖反馈         |
| FR-06 | M5     | 四类场景验证矩阵 + 类型接入 + 基础设施错误区分              |
| FR-07 | M6     | 模块/依赖驱动的任务图 + 追溯 + 自动调整边界                 |
| FR-08 | M6     | 动态并发 + 冲突串行化 + 预算/时限 + 集成绑定                |
| FR-09 | M7     | 影响范围选取 + 关键版本触发 + 约束与业务 AC 分离 + 分层报告 |
| FR-10 | M7     | 证据状态真实性 + 提交绑定 + 五类审批分离                    |

### 2.3 AC 总表（AC-01–AC-36）

状态列此刻全部为 `NOT_IMPLEMENTED`；本计划不预先标记任何 AC 通过。

| AC    | 摘要                                     | 来源  | 里程碑 | 主责任务           |
| ----- | ---------------------------------------- | ----- | ------ | ------------------ |
| AC-01 | 无 Maven/Vue/React 仓库不被直接拒绝      | FR-01 | M2     | SNA-0201           |
| AC-02 | 纯后端/纯前端/CLI/库/多模块均能表达      | FR-01 | M2     | SNA-0202           |
| AC-03 | 缺工具链仍可只读分析并列出缺口           | FR-01 | M2     | SNA-0203           |
| AC-04 | 候选需求可查看来源与证据类别             | FR-02 | M2     | SNA-0204           |
| AC-05 | 静态读取测试不标为运行验证通过           | FR-02 | M2     | SNA-0204           |
| AC-06 | 用户可确认/纠正/拒绝，修订保留历史       | FR-02 | M2     | SNA-0205           |
| AC-07 | 需求基线与执行基线分别表达               | FR-02 | M2     | SNA-0206           |
| AC-08 | 复用已存在兼容工具的真实路径与版本       | FR-03 | M3     | SNA-0301           |
| AC-09 | 不兼容工具列为不兼容                     | FR-03 | M3     | SNA-0302           |
| AC-10 | 只读检查不下载/不安装/不改配置           | FR-03 | M3     | SNA-0303           |
| AC-11 | 只准备当前任务需要的能力                 | FR-03 | M3     | SNA-0301           |
| AC-12 | 未授权前不发生下载安装或配置写入         | FR-04 | M3     | SNA-0304           |
| AC-13 | 版本/来源/位置/权限不一致不沿用旧授权    | FR-04 | M3     | SNA-0304           |
| AC-14 | 安装成功但复验失败时环境不通过           | FR-04 | M3     | SNA-0305           |
| AC-15 | 环境通过与构建/测试/Review 分别报告      | FR-04 | M3     | SNA-0305           |
| AC-16 | 双平台各有真实发现/复用/缺项/复验记录    | FR-05 | M4     | SNA-0402           |
| AC-17 | macOS/ARM64 未验收前明确标为预留         | FR-05 | M4     | SNA-0403           |
| AC-18 | 启动失败/权限不足/认证缺失原因可区分     | FR-05 | M4     | SNA-0404           |
| AC-19 | 重构可合法进入工作流，不必伪装           | FR-06 | M1/M5  | SNA-0103、SNA-0501 |
| AC-20 | 目标用例失败+回归通过不被拒绝            | FR-06 | M1/M5  | SNA-0101、SNA-0502 |
| AC-21 | 超时/缺依赖/进程异常不能冒充业务缺陷     | FR-06 | M5     | SNA-0503           |
| AC-22 | 纯模块变更不强制附加无关前后端任务       | FR-06 | M5     | SNA-0504           |
| AC-23 | 独立模块可并行，依赖任务等待             | FR-07 | M6     | SNA-0601           |
| AC-24 | 无效/循环依赖或输入缺失不派发            | FR-07 | M1/M6  | SNA-0102、SNA-0601 |
| AC-25 | 任务可追溯，自动调整限于批准范围         | FR-07 | M6     | SNA-0602           |
| AC-26 | 宿主能力不足时按实际可用调度             | FR-08 | M6     | SNA-0603           |
| AC-27 | 文件冲突/资源互斥/接口未稳定时串行       | FR-08 | M6     | SNA-0604           |
| AC-28 | 达时限或预算边界保存进度并停新任务       | FR-08 | M6     | SNA-0605           |
| AC-29 | 集成结果绑定任务/输入版本/会话/提交      | FR-08 | M6     | SNA-0606           |
| AC-30 | 常规变更展示验证选择及依据               | FR-09 | M7     | SNA-0701           |
| AC-31 | 关键版本缺真实闭环证据不得宣称通过       | FR-09 | M7     | SNA-0702           |
| AC-32 | 已成立约束不被要求先变业务失败           | FR-09 | M7     | SNA-0703           |
| AC-33 | 技术验证/人工验收/归档/推送/部署分别报告 | FR-09 | M7     | SNA-0704           |
| AC-34 | 仅有脚本或生成文档不产生通过结论         | FR-10 | M7     | SNA-0705           |
| AC-35 | 修改后提交不复用修改前 PASS              | FR-10 | M7     | SNA-0706           |
| AC-36 | 五类审批分别表达，不相互代替             | FR-10 | M7     | SNA-0707           |

### 2.4 NFR 与 OI 归属

| 编号   | 要求             | 里程碑     | 说明                                        |
| ------ | ---------------- | ---------- | ------------------------------------------- |
| NFR-01 | 扫描有界         | M2         | 复用 `java-env.js` 的有界原则；数值见 OI-01 |
| NFR-02 | 数据边界         | M2         | 扫描不出宿主、不额外上传                    |
| NFR-03 | 敏感内容保护     | M2         | 默认跳过疑似密钥；跳过项不得描述为已分析    |
| NFR-04 | 可复现与可追溯   | M0、M2、M7 | 快照标识、计划版本、证据类别                |
| NFR-05 | 状态真实         | M7         | 复用 `RESULT_STATES` 的 `not-run` 语义      |
| NFR-06 | 资源受控         | M6         | D08：≤4 并发、单次 ≤30 分钟                 |
| NFR-07 | 用户改动保护     | M0、M8     | 当前工作树已有改动，任何里程碑不得覆盖      |
| NFR-08 | 平台与技术栈解耦 | M4         | 只读分析不因平台/语言不可用而整体阻断       |
| NFR-09 | 效率可解释       | M6、M8     | 记录扫描/准备/排队/执行/集成/返工耗时       |

| 编号  | 待确认项               | 首个需要答案的里程碑 |
| ----- | ---------------------- | -------------------- |
| OI-01 | 扫描与性能预算         | M2                   |
| OI-02 | 平台验收样例           | M4                   |
| OI-03 | 缺失/已知失败基线准入  | M2                   |
| OI-04 | 工具与启动引导         | M3、M4               |
| OI-05 | 并发预算作用域与恢复   | M6                   |
| OI-06 | 金丝雀触发判定         | M7、M8               |
| OI-07 | 候选基线确认与冲突规则 | M2                   |
| OI-08 | 历史模型与约束迁移     | M1                   |

---

## 3. 横切约定

### 3.1 测试文件策略

- 新增能力**先写测试再实现**；仅追加断言，不删改既有断言（沿用既有 M2 计划 `CORE2-0204` 的做法）。
- 冻结测试不可由实现方替换；测试创建与实现分属不同角色（沿用 `assets/codex/agents/` 的角色配置）。
- 若某里程碑必须改变既有断言语义（尤其 13 个钉住旧约束的测试文件），改动必须**逐条列出旧断言 → 新断言 → 理由**，写入该里程碑的验收产物，不得静默放宽。

### 3.2 证据格式

每条验证记录至少含：命令、起止时间、退出码、关键输出尾部、提交哈希（若适用）、执行者角色。未运行一律写 `NOT_RUN`，不得留空、不得写「预计通过」。

### 3.3 统一验证命令

聚焦（按任务列出的文件）：

```powershell
node --import ./test/setup-temp.mjs --test test/<file>.test.js
```

里程碑门（全量，M1 起每个里程碑退出前必跑）：

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

说明：`npm test` 走 `scripts/run-tests.mjs core`，不含 MySQL 用例；MySQL 相关变更另跑 `npm run test:mysql`。

---

## 4. M0：基线取证与影响面测绘

### 4.1 目标

把第 1 节的扫描结论变成可独立复核的产物，并给出 AC/NFR/OI 的三向追溯，使后续里程碑的每次判断都有据可依。

### 4.2 覆盖需求

NFR-04（可追溯）、NFR-07（改动保护）。支撑 AC-04、AC-30 的证据形态。

### 4.3 任务

#### SNA-0001 固化工作树与工具链基线证据

- 产物：`docs/implementation/stack-neutral-adoption/00-baseline-evidence.md`
- 操作：
  - 记录 `git status --porcelain`、`git branch --show-current`、`git rev-parse HEAD`；
  - 记录 `node --version`、`npm --version`、`git --version`、当前 `package.json` version；
  - 记录测试文件总数与本次扫描时点；
  - 逐项标注哪些是**既有未提交改动**（NFR-07 必须保留）。
- 验证：

```powershell
git status --porcelain
git branch --show-current
git rev-parse HEAD
node --version
npm --version
git --version
```

- 完成条件：三条 git 命令与三条版本命令都有真实输出；未修改任何文件。
- 失败与回滚：无（只读）。若工作树在取证过程中被外部改动，重新取证并保留两份，不覆盖。

#### SNA-0002 建立技术栈绑定影响面矩阵

- 产物：`docs/implementation/stack-neutral-adoption/01-binding-matrix.md`
- 操作：
  - 把 §1.1 的 B-01–B-14 与 §1.3 的 D-01–D-06 逐条展开为：文件、行号、当前行为、目标行为、受影响测试文件；
  - 对 13 个钉住旧约束的测试文件逐个列出「钉住的具体断言」；
  - 标注每项改动是否触及 `AGENTS.md` 的 HTTP 契约、用户改动保护、运行时目录或验证要求。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-detect.test.js test/codex-project-model.test.js
```

（此命令只用于确认取证前基线可运行，其通过**不作为**任何 AC 的证据。）

- 完成条件：B/D 条数齐全；每条至少一个 `文件:行号`；13 个测试文件全部出现。
- 失败与回滚：若某测试基线本身失败，原样记录失败并在矩阵中标注，不得修改测试使其通过。

#### SNA-0003 建立 AC/NFR/OI 三向追溯表

- 产物：`docs/implementation/stack-neutral-adoption/02-traceability.md`
- 操作：以 §2.3、§2.4 为底稿，为 36 条 AC、9 条 NFR、8 条 OI 各标注：来源条款、里程碑、主责任务、验证方式（自动化测试/人工验收/双平台证据）、当前状态 `NOT_IMPLEMENTED`。
- 完成条件：36/9/8 全部出现且无重复；每条至少映射一个里程碑与一个验收来源。
- 失败与回滚：若发现需求 doc 内部编号冲突，停止并回报，不自行改号。

#### SNA-0004 记录未接线能力与复用清单

- 产物：`docs/implementation/stack-neutral-adoption/03-unwired-capabilities.md`
- 操作：登记 §1.2 七项能力，逐项写明：现状（已实现未接通 / 已接通）、复用方式、首次被哪个里程碑消费、复用时需补的缺口。
- 验证：

```powershell
rg -n "core/suites.js" src scripts test
```

- 完成条件：`suites.js` 零引用的事实被记录，并在文档中给出接入计划入口（SNA-0201）。
- 失败与回滚：无。

### 4.4 M0 退出门

- [ ] 00–03 四份产物存在且内容自洽；
- [ ] 36 条 AC 全部有里程碑归属；
- [ ] 13 个受影响测试文件全部登记；
- [ ] 未修改任何源码、测试、配置、插件清单或既有文档。

---

## 5. M1：约束重基线门禁（硬门禁）

### 5.1 目标

需求 §8 指出「所有冻结 case 必须全红」与「开发并发必须为 1」与 D03/D06 冲突，且必须**正式重基线化，不能通过临时绕过校验实现**。M1 的唯一目标是把这些约束变成**版本化、可判别、可追溯的规则**，让后续里程碑在法律上允许演进，而不是偷偷放宽。

M1 **不实现**任何新功能。它只回答：「哪条约束仍然有效、以什么条件有效、旧状态如何迁移」。

### 5.2 覆盖需求

AC-19、AC-20、AC-24 的**前置结构**；OI-08。M5/M6 才是这些 AC 的功能实现，二者不重复计数。

### 5.3 任务

#### SNA-0101 引入版本化的验证策略档案

- 对应：AC-20（前置）、D03；D-04
- 文件：
  - 新增 `src/codex/core/validation-profile.js`（策略档案定义 + 校验）
  - `src/codex/core/state.js`（记录当前档案版本）
  - 新增 `test/codex-validation-profile.test.js`
- 先写测试：
  - 档案缺失版本字段 → 拒绝，码 `VALIDATION_PROFILE_INVALID`；
  - 档案声明 `requiresAllFrozenCasesRed: true` 时，`development.js` 保持现行为（向后兼容）；
  - 档案声明按场景差异化时，校验接受且能读到「场景 → 策略」映射；
  - 未知场景 ID → 拒绝并列出合法场景。
- 实现：档案为纯数据 + 纯校验，**不接线到执行路径**（接线在 SNA-0502）。旧状态无档案时按 `legacy` 档案解释。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-validation-profile.test.js test/codex-state-kernel.test.js
```

- 完成条件：四条断言全绿；既有状态文件可无损读出 legacy 解释。
- 失败与回滚：若无法在不改 `state.js` 状态机的前提下承载档案版本，停止并输出 schema 方案，不做隐式字段塞入。

#### SNA-0102 解除并发硬编码为计划级可配置约束

- 对应：AC-24（前置）、AC-26（前置）、D08；D-03
- 文件：
  - `src/codex/plan.js:162`（`maxParallelDevelopment !== 1` → 上界校验）
  - `src/codex/plan.js:403`（生成时按计划预算取值）
  - `test/codex-plan-core.test.js`（追加断言，不改旧断言）
- 先写测试：
  - `maxParallelDevelopment` 为 `0`、`-1`、`4.5`、`'4'` → 拒绝；
  - `maxParallelDevelopment = 1` → 通过（旧计划全部仍可冻结）；
  - `maxParallelDevelopment = 5` → 拒绝，码 `PLAN_PARALLEL_LIMIT_EXCEEDED`，信息含 D08 上界 4；
  - 计划未声明时默认 1。
- 实现：上界来自常量而非散落字面量；超界拒绝而非截断（截断会静默改变用户批准的资源预算）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js
```

- 完成条件：四条断言全绿；既有 v2 计划字节级可重新冻结（或明确拒绝并给迁移说明）。
- 失败与回滚：若既有已批准计划的哈希绑定因字段变化失效，**先**产出迁移方案再由用户决定，不得静默重算哈希。

#### SNA-0103 统一变更类型词表

- 对应：AC-19（前置）、D-01、D-02
- 文件：
  - `src/codex/change-policy.js:3`（对齐词表）
  - `src/codex/core/state.js:22`、`src/codex/core/change.js:398`
  - `test/codex-change-policy.test.js`、`test/codex-state-kernel.test.js`
- 先写测试：
  - 四处导出的类型集合**逐一相等**（用集合比较断言，非手工列举）；
  - `remove` 在 `change-policy` 中的必填细节与 `state` 一致；
  - `refactor` 此刻**尚未**合法（由 SNA-0501 引入），断言其返回 `CHANGE_TYPE_INVALID`。
- 实现：抽单一常量作为来源，其余引用它。不改任何必填字段语义。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-state-kernel.test.js test/codex-change-add-flow.test.js
```

- 完成条件：一致性断言通过；既有 `feature/modify/fix` 行为零变化。
- 失败与回滚：若 `remove` 在 `change-policy` 中补齐必填细节会改变既有 `remove` 契约，改为「词表统一但细节仍可选」，并记录为 OI-08 的后续项。

#### SNA-0104 ProjectProfile schema 演进方案（含迁移器）

- 对应：AC-02（前置）、OI-08；B-02、B-03
- 文件：
  - `src/codex/project-model.js:100-140`（`validateProjectProfile`）
  - 新增 `src/codex/core/profile-migration.js`
  - `test/codex-project-model.test.js`（追加断言）
- 先写测试：
  - v2 档案（`stack: 'java-vue'`）继续通过校验；
  - v2 → v3 迁移是**纯函数**：同输入同输出，不写文件；
  - 迁移后 `javaPreset`/`frontendFramework`/`backendPackage` 落到通用约定字段，原字段不再出现在 v3 顶层；
  - 未知 `stack` 值在 v3 下不因「不是 java-vue」而拒绝，而由能力声明校验；
  - v3 缺失能力声明 → 拒绝，码 `PROJECT_PROFILE_INVALID`。
- 实现：schemaVersion 3 增加通用 `capabilities` 与 `modules` 描述；v2 只读兼容。**本任务只加 schema 与迁移器，不改检测产出**（检测在 M2）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-model.test.js test/codex-project-adopt.test.js test/codex-project-conventions.test.js
```

- 完成条件：五条断言全绿；`adopt`/`conventions` 既有测试一条未改。
- 失败与回滚：若 v3 设计无法同时表达「Java/Vue 等价能力」与「未知技术栈的观察」而不引入歧义，停止并回到需求层确认 AC-04 的证据类别口径（OI-08）。

#### SNA-0105 重基线记录与旧约束处置声明

- 产物：`docs/implementation/stack-neutral-adoption/04-rebaseline-record.md`
- 操作：
  - 逐条记录被重基线的约束：原文、新规则、生效条件、迁移路径、回滚方式；
  - 明确旧计划 `v2.0-approved` 的处置（**不删除、不改写**，只声明哪些条款被新档案覆盖）；
  - 明确既有冻结资产（`.specgate/` 下的计划/契约/测试冻结件）是否需要迁移，以及不迁移时的解释语义；
  - 记录本次改动触及的 13 个测试文件清单与断言变更。
- 完成条件：每条约束都有「旧 → 新 → 条件 → 回滚」四要素；无「临时放过」表述。
- 失败与回滚：无。

### 5.4 M1 退出门

- [ ] `validation-profile` 可被状态机读取并给出确定解释；
- [ ] `maxParallelDevelopment` 不再是字面量 `1` 的相等判断，且超界返回专门错误码；
- [ ] 四处变更类型词表集合相等，且一致性由测试断言而非人工检查保证；
- [ ] ProjectProfile v2 只读兼容 + v3 迁移器为纯函数；
- [ ] 重基线记录四要素齐全；
- [ ] `npm test`、`npm run lint`、`npm run format:check`、`npm run pack:check`、`npm run codex:smoke` 全部真实退出 0；
- [ ] **反例门禁**：每一条被解除的硬约束，都有一条测试断言「旧写法仍被拒」或「新写法明确受上界约束」——不允许出现无上界的自由。

### 5.5 M1 失败与回滚

- 若某条约束无法在不破坏已批准计划哈希的前提下重基线：**停止 M1**，产出迁移方案供审批，不得继续 M2。
- 若 `npm test` 因外部原因失败：保留失败日志、标注受影响文件，**不得**降断言或加 `skip`。

---

## 6. M2：技术栈无关发现与候选需求基线

### 6.1 目标

任意仓库——不要求 Maven、不要求前端、不要求业务工具链已安装——都能获得只读扫描结果，并据此形成**带证据类别**的候选需求基线。

### 6.2 覆盖需求

FR-01（AC-01–03）、FR-02（AC-04–07）、NFR-01、NFR-02、NFR-03、NFR-04。

### 6.3 任务

#### SNA-0201 技术栈与构建系统探测

- 对应：AC-01、AC-08（发现侧）、NFR-01；B-01、B-10
- 文件：
  - 新增 `src/codex/core/discovery/stack.js`（语言/构建/包管理器/锁文件）
  - `src/codex/project-detect.js:235-241`（移除 Maven + 前端二元拒绝）
  - `src/codex/verify.js:166`、`src/codex/core/java/java-verify.js:348`（不再以 stack 字符串拒绝）
  - 新增 `test/codex-stack-detect.test.js`；`test/codex-project-detect.test.js`
- 先写测试：
  - 只有 `pom.xml`（无前端）→ `ok: true`，模块为纯后端；
  - 只有 `package.json`（无 Java）→ `ok: true`，模块为纯前端；
  - 纯 Python（`pyproject.toml`）→ `ok: true`；
  - 空目录/无构建文件 → `ok: true` 且 `capabilities: []`、`gaps` 非空；
  - `PROJECT_STACK_UNSUPPORTED` **不再**因技术栈出现；
  - 符号链接/非常规文件仍拒绝（安全断言必须保留）。
- 实现：探测结果分裂为「观察」与「能力」两个字段；`stack` 退化为描述性标签，不参与准入判断。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-stack-detect.test.js test/codex-project-detect.test.js test/codex-verify-adapter.test.js
```

- 完成条件：六条断言全绿；`PROJECT_STACK_UNSUPPORTED` 在源码中不再作为技术栈门禁（有测试断言）。
- 失败与回滚：若移除该错误码会破坏既有调用方契约，保留错误码但只用于「目标目录不可用」，并在重基线记录中标注语义变更。

#### SNA-0202 模块边界与入口识别

- 对应：AC-02、AC-22（前置）
- 文件：
  - 新增 `src/codex/core/discovery/modules.js`
  - `src/codex/project-detect.js`（`modules: { backend, frontends }` → 通用列表）
  - 新增 `test/codex-module-discovery.test.js`
- 先写测试：
  - 单模块 CLI → 一个模块，`role` 不臆造为 backend/frontend；
  - 同仓库 Maven 多模块（`<modules>`）→ 每个子模块一条；
  - 同仓库 npm workspaces → 每个 workspace 一条；
  - 目录名含 `backend`/`frontend` 但无构建文件 → **不**判为模块（需求 FR-01「不能仅凭目录名称判断」）；
  - 每个模块带 `evidence`（`文件:行`）。
- 实现：模块识别基于构建文件与锁文件，不基于目录名。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-module-discovery.test.js test/codex-project-detect.test.js
```

- 完成条件：五条断言全绿，尤其第 4 条的「不凭目录名」反例。
- 失败与回滚：若通用模块列表无法兼容既有 `modules.backend`/`modules.frontends` 消费方，改为双写过渡，并在 M2 验收产物中登记退场条件与截止里程碑。

#### SNA-0203 扫描预算、跳过规则与缺口报告

- 对应：AC-03、NFR-01、NFR-02、NFR-03；OI-01
- 文件：
  - 新增 `src/codex/core/discovery/budget.js`
  - 新增 `test/codex-scan-budget.test.js`
- 先写测试：
  - 超出文件数上限 → 停止扩展，返回 `scanned` 与 `unscanned` 两个范围，且 `truncated: true`；
  - 单文件超上限 → 跳过并记录，不读入内存；
  - 依赖目录（`node_modules`、`.git`、`dist`、`target`、`venv`）→ 默认跳过且计入 `skipped`；
  - 疑似密钥文件（`.env`、`*.pem`、`id_rsa*`）→ 跳过且**不**出现在 `scanned`（NFR-03：跳过项不能被描述为已分析）；
  - 超时 → 返回部分结果 + `timeout` 原因，不抛出。
- 实现：预算参数集中可配置（数值待 OI-01 确认，先用保守默认并在产物中标注「待确认」）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scan-budget.test.js
```

- 完成条件：五条断言全绿；`unscanned` 非空时结果不得标为完整。
- 失败与回滚：若无法在超时路径返回部分结果（进程级依赖不支持），改为「超时即整体 `timeout`」，但**必须**保留已完成清单，不得丢弃。

#### SNA-0204 候选需求基线与证据类别

- 对应：AC-04、AC-05、NFR-04
- 文件：
  - 新增 `src/codex/core/discovery/candidates.js`
  - 新增 `src/codex/core/discovery/evidence-class.js`
  - 新增 `test/codex-candidate-requirements.test.js`
- 先写测试：
  - 证据类别只有四值：`static-observed` / `inferred-intent` / `runtime-verified` / `user-confirmed`；
  - 仅静态读取测试文件 → 类别为 `static-observed`，**不得**为 `runtime-verified`（AC-05）；
  - 模型推断 → `inferred-intent`，且**不得**渲染为用户确认（AC-04）；
  - 每条候选带 `sourceRefs`（文件:行 / 符号 / 文档 / 测试）；
  - 基线带 `snapshotId`（依赖内容快照而非仅 commit，覆盖无 Git 仓库）。
- 实现：类别为枚举且不可由自由文本覆盖；渲染层强制展示类别。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-candidate-requirements.test.js
```

- 完成条件：五条断言全绿；不存在把 `inferred-intent` 渲染成用户确认的路径（有反例断言）。
- 失败与回滚：无。

#### SNA-0205 候选基线的确认、纠正与拒绝

- 对应：AC-06、AC-04；OI-07
- 文件：
  - 新增 `src/codex/core/discovery/baseline-revision.js`
  - 复用 `src/codex/approvals.js:332`（一次性消费）承载确认动作
  - 新增 `test/codex-baseline-revision.test.js`
- 先写测试：
  - 用户确认 → 该条类别升为 `user-confirmed`，原始 `static-observed` 记录**保留**（不覆盖）；
  - 用户纠正 → 生成 revision N+1，N 完整可读；
  - 用户拒绝 → 该条标记 `rejected`，**不**从历史中删除；
  - 同一确认动作重复消费 → 拒绝（沿用 `consume` 语义）；
  - 无 Git 仓库 → 仍可确认并记录内容快照 ID。

- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-baseline-revision.test.js test/codex-approval-authority.test.js
```

- 完成条件：五条断言全绿；任何路径都不删除历史 revision。
- 失败与回滚：若确认动作需要新网关而非复用 H1，先产出审批分离方案（关联 AC-36），不得把「确认候选基线」与「H1 冻结需求」混为一谈。

#### SNA-0206 需求基线与执行基线分离

- 对应：AC-07、AC-15（前置）、NFR-05
- 文件：
  - `src/codex/project-model.js`（`validateProjectProfile` 与 `validateProjectBaseline` 的关联表达）
  - 新增 `test/codex-baseline-separation.test.js`
- 先写测试：
  - 生成候选需求基线**不**产生任何执行通过结论；
  - 执行基线缺失时，候选基线仍可存在，但状态明确为「执行基线未建立」；
  - 两类基线各有独立标识与时间戳，互不冒充；
  - 以生成文档冒充执行通过 → 拒绝（AC-34 前置）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-baseline-separation.test.js test/codex-project-model.test.js test/codex-adopted-verification.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：无。

### 6.4 M2 退出门

- [ ] 无 Maven/Vue/React 的仓库可获得扫描结果（AC-01）；
- [ ] 纯后端/纯前端/CLI/库/多模块样例均能表达实际结构，未补造模块（AC-02）；
- [ ] 缺工具链时完成只读分析并列出无法识别/无法验证/未扫描（AC-03）；
- [ ] 候选需求可查看来源与证据类别（AC-04）；
- [ ] 静态读取不标为运行验证通过（AC-05）；
- [ ] 确认/纠正/拒绝可用且历史保留（AC-06）；
- [ ] 两类基线分别表达（AC-07）；
- [ ] 扫描有界且敏感文件默认跳过（NFR-01、NFR-03）；
- [ ] 里程碑门五条命令真实退出 0。

### 6.5 M2 失败与回滚

- 若某仓库形态无法在预算内识别：保留 `unscanned` 范围并申请分批继续（NFR-01），不得宣称分析完整。
- 若 NFR-03 的跳过规则与某用户明确要求分析的路径冲突：停下来请求批准，不扩大默认跳过或默认扫描范围。

---

## 7. M3：环境能力发现与受批安装

### 7.1 目标

从**项目事实 + 拟执行任务**推导所需能力，优先复用已存在工具，缺项时给出具体安装方案并受批执行，安装后真实复验。环境通过与构建/测试/Review 通过分别报告。

### 7.2 覆盖需求

FR-03（AC-08–11）、FR-04（AC-12–15）、D07（安装授权：按任务批量批准具体方案、优先用户目录/项目隔离、系统级安装与变更来源另行批准）。

### 7.3 任务

#### SNA-0301 能力需求推导与复用优先

- 对应：AC-08、AC-11；B-07、B-08
- 文件：
  - 新增 `src/codex/core/env/capability.js`
  - `src/codex/core/environment.js:32-74`（`projectEnvironmentSelection` 去掉固定 pom/package 推断）
  - `src/codex/environment-tools.js:2-4`（不再以 JDK/Boot 预设为唯一入口）
  - 新增 `test/codex-capability-derivation.test.js`
- 先写测试：
  - 任务是「跑 maven test」→ 能力为 jdk + maven，**不**要求 node；
  - 任务是「跑 pytest」→ 能力为 python + pytest，**不**要求 jdk/maven（AC-11）；
  - 已存在兼容工具 → 复用其真实路径与版本，不进入缺项列表（AC-08）；
  - 任务无任何构建需求（纯文档）→ 能力为空集，不安装任何工具。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-capability-derivation.test.js test/codex-environment.test.js
```

- 完成条件：四条断言全绿；无「先安装全套已知工具」路径。
- 失败与回滚：若移除预设入口破坏 `sg_env_check` 既有契约，保留预设为**可选快捷方式**，但能力推导为唯一权威，并在重基线记录登记。

#### SNA-0302 兼容性与可运行性判定

- 对应：AC-09；B-08
- 文件：
  - 新增 `src/codex/core/env/compatibility.js`
  - 复用 `src/codex/core/java/java-env.js:189`（`probeTool`）
  - 新增 `test/codex-env-compatibility.test.js`
- 先写测试：
  - 工具文件存在但版本不满足项目约束 → `incompatible`，**不**为 `ok`（AC-09）；
  - 架构不匹配（如 arm64 二进制在 x64 期望下）→ `incompatible`；
  - 版本探测超时 → `unknown`，**不**为 `ok`；
  - `probeTool` 非零退出 → 保留原始 stderr 摘要并判 `incompatible`。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-env-compatibility.test.js test/codex-install-env.test.js
```

- 完成条件：四条断言全绿；不存在「文件存在即通过」的分支。
- 失败与回滚：无。

#### SNA-0303 有界只读发现

- 对应：AC-10、NFR-01
- 文件：
  - `src/codex/core/java/java-env.js:136-139`、`:380`、`:495`（把上限抽为共享常量）
  - 新增 `src/codex/core/env/discovery-bounds.js`
  - 新增 `test/codex-env-discovery-bounds.test.js`
- 先写测试：
  - 只读路径下调用发现 → 不产生任何网络请求、不写任何文件（用临时目录快照比对前后文件树）；
  - 根目录数超过上限 → 停止并报告 `truncated`；
  - 单目录条目数超过上限 → 停止该目录，继续下一个；
  - 发现过程不修改 PATH、不写用户级/系统级配置（AC-10）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-env-discovery-bounds.test.js test/codex-environment.test.js
```

- 完成条件：四条断言全绿，尤其「文件树前后一致」的机械断言。
- 失败与回滚：无。

#### SNA-0304 安装方案契约与批量批准

- 对应：AC-12、AC-13；D07、OI-04
- 文件：
  - 新增 `src/codex/core/env/install-plan.js`
  - `src/codex/core/environment-install.js`（消费方案而非自由参数）
  - `test/codex-install-env.test.js`（追加断言）
- 先写测试：
  - 方案必含：任务用途、组件、版本、来源、校验方式、位置、配置变动、权限要求；缺任一 → 拒绝（AC-12 前提）；
  - 未取得对应方案批准 → 不下载、不安装、不写配置（AC-12）；
  - 批准后执行时版本/来源/位置/权限与批准不一致 → 停止并重新申请，**不**沿用旧授权（AC-13）；
  - 批量批准一组方案后逐项消费，已消费项不可复用（复用 `approvals.js:332`）；
  - 系统级/提权/换源 → 强制重新申请。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-install-env.test.js test/codex-approval-authority.test.js test/codex-approval-state.test.js
```

- 完成条件：五条断言全绿；存在「改源后仍复用旧批准」的反例断言且被拒。
- 失败与回滚：若批量批准需要新网关，先产出审批分离方案（关联 AC-36），不复用 H1/H3 语义。

#### SNA-0305 隔离安装位置与安装后真实复验

- 对应：AC-14、AC-15
- 文件：
  - `src/codex/core/environment-install.js:14-31`（`verifyArchive` 已具备，复用）
  - 新增 `src/codex/core/env/post-install-verify.js`
  - 新增 `test/codex-post-install-verify.test.js`
- 先写测试：
  - 安装命令退出 0 但复验探测失败 → 环境状态为 `not-ready`（AC-14）；
  - 优先用户目录/项目隔离位置；系统级位置需要独立批准；
  - 复验逐能力执行，不因一项通过而标记全部通过；
  - 环境通过、项目构建通过、测试通过、Review 通过四者，任一为真不蕴含其余（AC-15）；
  - 下载/校验/权限/网络失败 → 保留已完成结果与阻塞原因，不自动放宽来源或权限。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-post-install-verify.test.js test/codex-environment.test.js test/codex-adopted-verification.test.js
```

- 完成条件：五条断言全绿；四类结论分别可读。
- 失败与回滚：无。

### 7.4 M3 退出门

- [ ] 兼容工具复用真实路径与版本（AC-08）；
- [ ] 不兼容项被列为不兼容（AC-09）；
- [ ] 只读检查不下载/不安装/不改配置（AC-10，机械断言）；
- [ ] 只准备当前任务需要的能力（AC-11）；
- [ ] 未授权前无下载安装与配置写入（AC-12）；
- [ ] 授权要素变化不沿用旧授权（AC-13）；
- [ ] 安装成功但复验失败时环境不通过（AC-14）；
- [ ] 环境与构建/测试/Review 分别报告（AC-15）；
- [ ] 里程碑门五条命令真实退出 0。

### 7.5 M3 失败与回滚

- 安装被拒绝、下载失败或校验失败 → **保留结果与原因**，不换源、不提权、不跳过复验继续（E2E-04 的前置要求）。
- 若 OI-04（下载源策略/离线缓存/代理）在实施时仍无结论：只做「发现 + 复用 + 缺项报告」，把安装执行显式留为 `NOT_RUN`，不得用未确认的源地址实施。

---

## 8. M4：跨平台执行与引导边界

### 8.1 目标

Windows/Linux x64 各有真实证据；平台差异被隔离进平台层而非散落在流程中；macOS/ARM64 明确标为预留；SG 自身启动依赖缺失时给出可区分反馈。

### 8.2 覆盖需求

FR-05（AC-16–18）、NFR-08；OI-02、OI-04。

### 8.3 任务

#### SNA-0401 平台差异收敛到平台层

- 对应：NFR-08、AC-16 前置
- 文件：
  - `src/codex/core/env/java.js`、`maven.js`、`gradle.js`（已有 `isWindows(platform)` 分支，收敛到共享模块）
  - 新增 `src/codex/core/platform.js`
  - 新增 `test/codex-platform-abstraction.test.js`
- 先写测试：
  - 源码中不存在「流程代码内直接判断 `process.platform === 'win32'`」的散落分支（用源码扫描断言，白名单仅平台层）；
  - 可执行名解析（`.cmd`/`.bat`/无后缀）在两种平台下正确；
  - 路径分隔与大小写敏感性由平台层统一；
  - 平台层对未知平台返回 `unsupported` 而非默认 Windows 行为。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-platform-abstraction.test.js test/codex-environment.test.js test/codex-install-env.test.js
```

- 完成条件：四条断言全绿；散落平台分支的扫描断言为 0 命中。
- 失败与回滚：若某处无法收敛（如 spawn 的 `windowsVerbatimArguments`），在平台层保留命名清晰的例外并登记，不放任散落。

#### SNA-0402 Linux x64 真实证据与 CI 矩阵

- 对应：AC-16；B-01–B-14 的 Linux 侧
- 文件：
  - `.github/workflows/codex.yml:10`（增加 `ubuntu-latest` job）
  - `scripts/verify-codex-matrix.mjs:16-31`（复用其一平台一记录的诚实语义）
  - 产物：`docs/verification/stack-neutral-adoption/platform-linux-x64.md`
- 先写测试：矩阵脚本对 `--platform linux` 只写 `platforms.linux`，其余平台保持 `not-run`（已有语义的回归断言）。
- 操作：
  - 在 Linux 上真实执行：发现 → 复用 → 缺项准备 → 复验，四类记录齐备；
  - Windows 侧同等四类记录；
  - 两平台记录**不得互相代替**（AC-16 反例断言）。
- 验证：

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
node scripts/verify-codex-matrix.mjs --platform linux
```

- 完成条件：两平台各有四类真实记录；CI 两个 job 均真实通过；`not-run` 未被伪造成通过。
- 失败与回滚：若 Linux 环境不可得（OI-02 未确认），AC-16 保持 `NOT_RUN` 并**阻断 M8**，不得用 WSL 或容器记录冒充原生 Linux 验收（须由用户在 OI-02 中确认等价性）。

#### SNA-0403 预留平台标注机制

- 对应：AC-17
- 文件：
  - `src/codex/core/java/java-versions.js:54`（`requiredPlatforms` 与预留平台分离表达）
  - 新增 `src/codex/core/platform-support.js`
  - 新增 `test/codex-platform-reserved.test.js`
- 先写测试：
  - `darwin`/`arm64` 在三态中只能是 `reserved` 或 `unverified`，**不能**为 `supported`（除非有真实验收记录文件）；
  - 无验收记录时把平台标为 `supported` → 拒绝；
  - 三态在用户可见输出中显式出现，不隐藏。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-platform-reserved.test.js test/codex-golden-matrix.test.js
```

- 完成条件：三条断言全绿；`supported` 必须由证据文件驱动而非手写常量。
- 失败与回滚：无。

#### SNA-0404 启动依赖与宿主引导反馈

- 对应：AC-18；需求 FR-05 第 2 段；OI-04
- 文件：
  - 新增 `src/codex/core/bootstrap-diagnostics.js`
  - `src/codex/server.js`（启动期诊断）
  - 新增 `test/codex-bootstrap-diagnostics.test.js`
- 先写测试：
  - Node 版本不满足 `engines` → 输出可区分原因 `host-runtime-unsupported`；
  - 宿主权限不足（无法写运行时目录）→ `host-permission-denied`；
  - 认证/凭据缺失 → `host-auth-missing`；
  - 三类原因互不混淆，且**均不**输出「环境已就绪」；
  - MCP 尚未启动时，诊断由宿主侧引导文本表达，不要求 MCP 自修复（需求 §5）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-bootstrap-diagnostics.test.js test/codex-plugin-protocol.test.js
```

- 完成条件：五条断言全绿。
- 失败与回滚：若诊断需要宿主侧配合（无法在插件内完成），该部分显式记为 `NOT_RUN` 并列出需要宿主提供的接口，不伪造。

### 8.4 M4 退出门

- [ ] Windows/Linux x64 各有真实发现/复用/缺项准备/复验记录，互不代替（AC-16）；
- [ ] macOS/ARM64 明确为预留或未验证，`supported` 由证据驱动（AC-17）；
- [ ] 启动失败/权限不足/认证缺失原因可区分且不宣称就绪（AC-18）；
- [ ] 平台分支收敛，散落判断有 0 命中断言（NFR-08）；
- [ ] 里程碑门五条命令真实退出 0。

### 8.5 M4 失败与回滚

- Linux 证据缺失 → AC-16 `NOT_RUN`，M8 阻断。**不得**用容器/子系统记录替代原生平台验收，除非 OI-02 明确写入等价性。

---

## 9. M5：四类场景验证策略

### 9.1 目标

新增功能、修改功能、修复 bug、重构各有与其性质相符的验证要求；不再要求所有场景都先全红；基础设施错误不能冒充业务故障；纯模块变更不被附加无关任务。

### 9.2 覆盖需求

FR-06（AC-19–22）、D05（首期四类核心场景：新增功能、修改功能、修复 bug、重构）。依赖 M1 的 `validation-profile`（SNA-0101）与统一词表（SNA-0103）。

### 9.3 任务

#### SNA-0501 重构类型接入

- 对应：AC-19；B-14、D-02
- 文件：
  - `src/codex/change-policy.js`（新增 `refactor` 与其必填细节）
  - `src/codex/core/state.js:22`、`src/codex/core/change.js:398`
  - `test/codex-change-policy.test.js`、`test/codex-change-add-flow.test.js`（追加断言）
- 先写测试：
  - `refactor` 被接受，必填字段为「允许调整的内部结构 / 不变的对外行为 / 约束」，缺一拒绝；
  - `refactor` 进入 Change 后，不因「冻结 case 未全红」被拒（AC-19）；
  - `refactor` 不要求 `expectedBehavior`/`actualBehavior`（那是 fix 的）；
  - 既有 `feature/modify/fix/remove` 行为零变化。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-change-add-flow.test.js
```

- 完成条件：四条断言全绿；`refactor` 不以「伪装成 feature」的方式通过。
- 失败与回滚：若 `refactor` 需要新的状态机分支而非仅策略差异，停止并回到 SNA-0101 扩展档案，不在状态机加临时分支。

#### SNA-0502 场景 → 验证策略矩阵

- 对应：AC-20
- 文件：
  - `src/codex/core/validation-profile.js`（接线到执行路径）
  - `src/codex/development.js:469-503`（`redBaseline` 按档案判定是否必需）
  - 新增 `test/codex-scenario-policy.test.js`
- 先写测试：
  - `feature`：目标能力原本缺失 → 实施后满足 AC；已有回归保绿；**不**要求回归变红；
  - `modify`：目标行为变化有前后证据；**不**要求所有既有用例先失败（AC-20）；
  - `fix`：真实复现目标故障 → 同一目标断言通过；
  - `refactor`：前后行为保持证据；**不**人为破坏已正确行为；
  - 目标用例失败 + 既有回归通过 → **不**拒绝该基线（AC-20 的正是此条）；
  - 文档/配置类附带工作采用性质相符的检查（非三件套全跑）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scenario-policy.test.js test/codex-development-flow.test.js test/codex-approval-state.test.js
```

- 完成条件：六条断言全绿；四类场景各自的最小红/绿要求以数据表达而非散落 `if`。
- 失败与回滚：若 `development.js` 的冻结基线校验无法按档案分支而不破坏既有已冻结 Change，先迁移既有 Change 或标注其遗留档案，不得让旧 Change 静默变成「无校验」。

#### SNA-0503 基础设施错误与业务故障区分

- 对应：AC-21；B-14
- 文件：
  - `src/codex/development.js:405-432`（`RED_REPORT_INVALID` 的 `infrastructureErrors` 判定）
  - `src/codex/core/suites.js`（接入套件时保留该判定）
  - `test/codex-development-flow.test.js`（追加断言）
- 先写测试：
  - 超时 → `timeout`，**不**计为业务红灯；
  - 缺依赖（模块未找到）→ `infrastructure`，不计为业务红灯；
  - 进程崩溃/非零退出但无测试报告 → `infrastructure`；
  - 未运行（被跳过）→ `not-run`，**不**计为通过也**不**计为失败；
  - 真业务断言失败 → `business-failure`，可计为红灯。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-quality-gate.test.js
```

- 完成条件：五条断言全绿；`infrastructure` 与 `business-failure` 不可互转（双向反例断言）。
- 失败与回滚：无。

#### SNA-0504 移除无关前后端任务注入

- 对应：AC-22；B-12、B-13
- 文件：
  - `src/codex/plan.js:19-38`（kinds/roles 与 `roleForKind`）
  - `src/codex/development.js:13-14`（`DEVELOPMENT_ROLES`）
  - `test/codex-plan-core.test.js`（追加断言）
- 先写测试：
  - 单模块 Python 项目 → 计划中**不**出现 frontend/backend 任务（AC-22）；
  - 单模块 CLI → 不出现 HTTP 或数据模型任务；
  - 任务角色来自模块与依赖，不来自固定 `roleForKind` 映射；
  - 既有 Java/Vue 计划的角色分配结果**不变**（等价断言，保证向后兼容）。
- 实现：角色映射退化为「模块角色 → 执行角色」的可配置映射，默认映射保持现行为。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js test/codex-development-flow.test.js test/codex-project-conventions.test.js
```

- 完成条件：四条断言全绿，第 4 条等价性断言是硬要求。
- 失败与回滚：若等价性无法保证（既有计划字节变化），先产出迁移方案并保持旧计划可读，不静默重算。

### 9.4 M5 退出门

- [ ] 重构可合法进入工作流且不需伪装（AC-19）；
- [ ] 目标失败 + 回归通过不被拒绝（AC-20）；
- [ ] 超时/缺依赖/进程异常/未运行不能冒充业务缺陷（AC-21）；
- [ ] 纯模块变更不被附加无关任务（AC-22）；
- [ ] 既有 Java/Vue 计划角色分配等价性断言通过；
- [ ] 里程碑门五条命令真实退出 0。

### 9.5 M5 失败与回滚

- 若移除并发=1 与角色固定的组合导致既有计划无法重新冻结：停止 M5，回到 M1 扩展迁移器，不允许在 M5 内临时放宽校验。

---

## 10. M6：可调度计划与动态并发

### 10.1 目标

计划按真实模块与依赖拆分；独立任务可并行、依赖任务等待；并发受 D08 约束且能说明决策依据；集成结果绑定到具体任务、输入版本、会话与提交。

### 10.2 覆盖需求

FR-07（AC-23–25）、FR-08（AC-26–29）、NFR-06、NFR-09。

### 10.3 任务

#### SNA-0601 模块与依赖驱动的任务图

- 对应：AC-23、AC-24；B-11、B-12
- 文件：
  - `src/codex/plan.js:337-410`（按 AC 机械生成 → 按模块/依赖生成）
  - 新增 `src/codex/core/plan/graph.js`
  - `test/codex-plan-core.test.js`（追加断言）
- 先写测试：
  - 两个无依赖模块 → 两个任务可并行（AC-23）；
  - B 依赖 A → B 的 `deps` 含 A，派发等待 A 完成；
  - 循环依赖 → 拒绝，码 `PLAN_GRAPH_CYCLE`（AC-24）；
  - 任务缺少必要输入（无 `allowedFiles` 或无 AC 映射）→ 不派发（AC-24）；
  - 无效依赖（指向不存在任务）→ 拒绝。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js test/codex-development-flow.test.js
```

- 完成条件：五条断言全绿；图校验对环的拒绝是拓扑算法而非深度上限。
- 失败与回滚：若既有已批准计划的图无法由新生成器重建，保留旧生成器为只读迁移路径并登记退场条件。

#### SNA-0602 任务追溯与自动调整边界

- 对应：AC-25
- 文件：
  - 新增 `src/codex/core/plan/traceability.js`
  - 新增 `test/codex-plan-traceability.test.js`
- 先写测试：
  - 每个任务可追溯到批准输入（REQ/AC + 计划版本）；
  - 自动细分任务不得扩大父任务 `allowedFiles`（子集断言）；
  - 自动细分不得改变 AC 集合、不得放松验证策略、不得越过里程碑门禁；
  - 需要改变需求/契约/预算时 → 强制重新审批，保留计划版本与变更原因；
  - 计划版本链完整可读，旧版本不被覆盖。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-traceability.test.js test/codex-approval-authority.test.js
```

- 完成条件：五条断言全绿；子集断言为机械校验。
- 失败与回滚：无。

#### SNA-0603 并发调度与宿主能力探测

- 对应：AC-26、NFR-06；D08
- 文件：
  - 新增 `src/codex/core/scheduler.js`
  - `src/codex/development.js`（按调度结果创建角色工作树而非固定两角色）
  - 新增 `test/codex-scheduler-concurrency.test.js`
- 先写测试：
  - 宿主可用槽位 < 4 → 按实际可用调度，**不**伪造并发会话（AC-26）；
  - 并发上限默认 4 且不含主控；
  - 单 agent 单次运行上限 30 分钟（复用 `src/codex/quality.js:16` 的 `30 * 60 * 1000` 常量口径）；
  - 决策依据可读：复杂度、依赖、里程碑、文件归属、契约稳定性、共享资源、宿主能力、执行反馈各自被记录；
  - 并发数不按任务数等比例放大（反例：10 个独立任务并发仍 ≤ 4）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scheduler-concurrency.test.js test/codex-development-flow.test.js
```

- 完成条件：五条断言全绿。
- 失败与回滚：若宿主能力无法真实探测（无接口），降级为「用户声明 + 记录为声明」，并在输出中标注为未探测，不伪造探测结果。

#### SNA-0604 冲突检测与串行化

- 对应：AC-27
- 文件：
  - 新增 `src/codex/core/scheduler-conflicts.js`
  - 新增 `test/codex-scheduler-conflicts.test.js`
- 先写测试：
  - 两任务 `allowedFiles` 交集非空 → 串行或协调（AC-27）；
  - 共享资源（同一测试数据库/端口）→ 串行；
  - 未稳定的共享接口（契约任务未完成而其消费者就绪）→ 消费者等待；
  - 冲突被识别后必须**有记录**，不得静默重排；
  - 集成冲突 → 回到具体任务处理，不覆盖用户修改（NFR-07）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scheduler-conflicts.test.js test/codex-development-flow.test.js
```

- 完成条件：五条断言全绿；冲突记录含两侧任务与冲突类型。
- 失败与回滚：无。

#### SNA-0605 预算边界与断点恢复

- 对应：AC-28、NFR-06、NFR-09；OI-05
- 文件：
  - 新增 `src/codex/core/scheduler-budget.js`
  - 复用 `src/codex/core/state.js` 的 `BLOCKED` 语义承载「保存进度并停止」
  - 新增 `test/codex-scheduler-budget.test.js`
- 先写测试：
  - 达到时限/预算 → 保存进度、停止启动新任务、请求调整（AC-28）；
  - 反复重启**不**清除已消耗预算（反例断言：重启后剩余预算不回升）；
  - 费用无法可靠获取 → 记录可获取用量并标 `unknown`，不宣称满足金额上限（D08、NFR-06）；
  - 记录扫描/准备/排队/执行/集成/返工六段耗时（NFR-09）；
  - 超时后进程清理有证据（无孤儿进程）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scheduler-budget.test.js test/codex-session-recovery.test.js test/codex-temp-lifecycle.test.js
```

- 完成条件：五条断言全绿，尤其「重启不回升预算」的反例。
- 失败与回滚：若预算状态无法跨会话持久化（OI-05 未定），把边界检查降级为「单会话内有效」并**显式标注**该限制，不宣称跨会话受控。

#### SNA-0606 集成结果绑定

- 对应：AC-29；B-11
- 文件：
  - `src/codex/development.js:896-950`（集成合并与提交）
  - 新增 `src/codex/core/integration-binding.js`
  - 新增 `test/codex-integration-binding.test.js`
- 先写测试：
  - 集成结果绑定：任务 id、输入版本、agent 会话、提交哈希（AC-29）；
  - 最终验证**不**拼接不同提交的通过结果（反例断言：跨提交拼接 → 拒绝）；
  - 并发任务各有隔离工作区与可追溯结果；
  - 集成冲突回退到具体任务，不静默丢弃分支结果（NFR-07）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-integration-binding.test.js test/codex-development-flow.test.js test/codex-incremental-delivery.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：无。

### 10.4 M6 退出门

- [ ] 独立模块产生可并行任务，依赖任务等待前置（AC-23）；
- [ ] 无效/循环依赖或输入缺失不派发（AC-24）；
- [ ] 任务可追溯，自动调整仅限既定范围（AC-25）；
- [ ] 宿主能力不足时按实际可用调度（AC-26）；
- [ ] 冲突被识别后协调或串行（AC-27）；
- [ ] 达时限/预算保存进度并停新任务（AC-28）；
- [ ] 集成结果绑定任务/输入版本/会话/提交，不跨提交拼接（AC-29）；
- [ ] 里程碑门五条命令真实退出 0。

### 10.5 M6 失败与回滚

- 若并发导致测试设计/实现/Review 独立性受损：**降低并发**，不得以「并发更快」为由削弱角色独立性（需求 FR-08 明确禁止）。
- 预算耗尽 → 保存进度并按 D08 请求调整，不通过反复重启隐性突破。

---

## 11. M7：影响范围验证、证据与审批边界

### 11.1 目标

常规变更按影响范围选验证集并解释依据；关键版本或内核变化执行真实完整闭环；技术验证/人工验收/归档/推送/部署分别报告；未运行不被显示为通过；五类审批不相互代替。

### 11.2 覆盖需求

FR-09（AC-30–33）、FR-10（AC-34–36）、D04（金丝雀：关键版本或工作流内核变化跑真实完整闭环，常规变更按影响范围验证，业务生产灰度为独立可选流程）、D03（验证策略：目标用例缺失/故障、已有回归保绿、重构行为等价）、NFR-05、NFR-09。

### 11.3 任务

#### SNA-0701 影响分析与验证集合选择

- 对应：AC-30、NFR-09
- 文件：
  - 新增 `src/codex/core/impact.js`
  - 新增 `src/codex/core/verification-selection.js`
  - 新增 `test/codex-impact-verification.test.js`
- 先写测试：
  - 常规变更**不**无条件附加完整业务金丝雀（AC-30）；
  - 必须输出「为什么运行这些检查 + 哪些区域未覆盖」；
  - 影响分析基于 diff + 模块依赖 + 测试映射，不基于文件名猜测；
  - 未覆盖区域显式列出，空列表需给出「为何确认为空」的依据。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-impact-verification.test.js test/codex-test-selection.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：无。

#### SNA-0702 关键版本与内核变化触发

- 对应：AC-31；OI-06
- 文件：
  - 新增 `src/codex/core/critical-trigger.js`
  - 新增 `test/codex-critical-trigger.test.js`
- 先写测试：
  - 命中内核模块（工作流/状态机/审批/证据）变更 → 要求真实完整闭环，缺证据时**不得**宣称通过（AC-31）；
  - 版本为关键版本 → 同上；
  - 判定规则为数据表而非散落条件；
  - 合成 fixture **不能**冒充真实业务仓库/用户审批/角色会话（反例断言）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-critical-trigger.test.js test/codex-golden-matrix.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：若 OI-06 未确认「关键版本/内核模块」清单，先用保守默认（全部内核模块命中）并标注待确认，不放宽默认。

#### SNA-0703 运行约束与业务 AC 分离建模

- 对应：AC-32；`docs/implementation/specgate-core-mvp-v2/13-canary-closure-correction.md`
- 文件：
  - `src/codex/change-policy.js`（AC 建模区分业务目标 / 回归保障 / 运行约束）
  - `src/codex/core/validation-profile.js`
  - 新增 `test/codex-constraint-modeling.test.js`
- 先写测试：
  - 已成立的工具链自检、历史保留等约束被建模为**运行约束**，不被要求先变成业务失败（AC-32）；
  - 业务 AC 必须表达可观察行为变化；
  - 运行约束失败时阻断交付，但**不是**红灯基线的一部分；
  - 同一断言不能在红/绿两态语义相同（防「假红」）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-constraint-modeling.test.js test/codex-scenario-policy.test.js
```

- 完成条件：四条断言全绿，第 4 条为关键反例（历史缺陷的直接防回归）。
- 失败与回滚：无。

#### SNA-0704 四类结论分别报告

- 对应：AC-33、AC-15
- 文件：
  - `src/codex/core/report.js`、`src/codex/delivery.js`
  - 新增 `test/codex-report-separation.test.js`
- 先写测试：
  - 技术验证、人工验收、归档、推送、生产部署五者各自独立状态；
  - 任一为真不蕴含其余（AC-33）；
  - 生产部署默认 `NOT_RUN`，不由本流程触发；
  - 报告渲染不含跨类合并的「总体通过」字段。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-report-separation.test.js test/codex-delivery-record.test.js test/codex-review-release.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：无。

#### SNA-0705 证据状态不可冒充

- 对应：AC-34；复用 `src/codex/adopted-verification.js:15-16`
- 文件：
  - `src/codex/core/verification-status.js`
  - 新增 `test/codex-evidence-status.test.js`
- 先写测试：
  - 仅存在脚本、报告模板或生成文档 → **不能**生成执行通过结论（AC-34）；
  - `not-run`/`skipped`/`cancelled`/`timeout` 不得显示为通过；
  - 缺少验证适配 → 输出缺口说明，不填通过；
  - 「环境发现成功」不被渲染为「构建通过」（FR-03/FR-04 与 AC-15 的一致性）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-evidence-status.test.js test/codex-adopted-verification.test.js test/codex-verification.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：无。

#### SNA-0706 提交绑定与格式化后完整重跑

- 对应：AC-35
- 文件：
  - `src/codex/format.js`（区分 `check` 与会写文件的 `--write`）
  - `src/codex/quality.js`（格式化新提交后完整重跑）
  - `test/codex-format-rework.test.js`（追加断言）
- 先写测试：
  - 修改后的提交**不**直接复用修改前的 PASS（AC-35）；
  - 格式检查（只读）与会写文件的格式化动作分别表达，不把自动发现的 `format` 脚本一律当只读；
  - 格式化产生新提交后，在该提交上完整重跑质量门；
  - 未覆盖/不适用项必须附依据。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-format-rework.test.js test/codex-quality-gate.test.js test/codex-review-release.test.js
```

- 完成条件：四条断言全绿。
- 失败与回滚：若无真实格式化可用（缺 formatter），记录 `NOT_RUN` 并阻塞交付，不以「无 formatter」放宽要求。

#### SNA-0707 五类审批分离

- 对应：AC-36；复用 `src/codex/approvals.js:332`/`:377`
- 文件：
  - `src/codex/approvals.js`（门禁作用域扩展）
  - 新增 `test/codex-approval-separation.test.js`
- 先写测试：
  - 五类审批：写入需求文档、批准需求、批准实施计划、批准安装、批准交付，各自独立记录；
  - 任一审批**不**代替其余（两两反例断言）；
  - 同一审批动作重复消费被拒（沿用 `consume` 语义）；
  - 审批绑定 artifact 哈希，内容变更后旧审批失效。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-approval-separation.test.js test/codex-approval-authority.test.js test/codex-approval-state.test.js test/codex-step-up.test.js
```

- 完成条件：四条断言全绿；两两反例断言数 = 10（C(5,2)）。
- 失败与回滚：若某类审批需要新网关，在 M7 验收产物中登记接口契约与迁移路径，不复用 H1/H3 语义。

### 11.4 M7 退出门

- [ ] 常规变更展示验证选择及其依据（AC-30）；
- [ ] 关键版本/内核变化缺真实闭环不得宣称通过（AC-31）；
- [ ] 已成立约束不被要求先变业务失败（AC-32）；
- [ ] 技术验证/人工验收/归档/推送/部署分别报告（AC-33）；
- [ ] 仅脚本或生成文档不产生通过结论（AC-34）；
- [ ] 修改后提交不复用修改前 PASS（AC-35）；
- [ ] 五类审批分离且不可相互代替（AC-36）；
- [ ] 里程碑门五条命令真实退出 0。

### 11.5 M7 失败与回滚

- 若影响分析导致验证集合过窄而漏检：以真实回归失败为证据补回检查项，并记录「为何原先遗漏」，不静默扩大为全量金丝雀。
- 若关键版本判定与 OI-06 冲突：保持保守默认并阻断 M8 的相关 AC-31 结论。

---

## 12. M8：端到端验收与发布

### 12.1 目标

E2E-01–09 全部真实通过；双平台证据齐备；发行隔离表达清晰；发布检查真实退出 0。

### 12.2 覆盖需求

E2E-01–09、全部 NFR。

### 12.3 任务

#### SNA-0801 E2E-01 / E2E-02：非 Java/Vue 仓库与证据冲突

- 对应：E2E-01、E2E-02、AC-01、AC-03、AC-04
- 产物：`docs/verification/stack-neutral-adoption/e2e-01-02.md`
- 操作：
  - 取一个真实的非 Java/Vue 仓库（无 Maven、无 Vue/React），在缺少业务工具链的条件下执行只读识别并形成候选基线；
  - 断言：不安装、不补造模块、不声称运行验证通过；
  - 取一个实现/文档/测试对同一行为冲突的样例，展示来源与冲突，经用户确认真实目标；
  - 断言：不将现状自动冻结为正确需求。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-stack-detect.test.js test/codex-candidate-requirements.test.js
```

- 完成条件：两项 E2E 均有真实仓库路径、命令、输出；无 `NOT_RUN` 残留。
- 失败与回滚：若无合适的真实非 Java/Vue 仓库，E2E-01 保持未完成并阻断 M8，**不得**以合成 fixture 替代（需求 FR-09 明确禁止）。

#### SNA-0802 E2E-03 / E2E-04：环境复用与安装失败

- 对应：E2E-03、E2E-04、AC-08、AC-09、AC-14
- 产物：`docs/verification/stack-neutral-adoption/e2e-03-04.md`
- 操作：
  - 真实机器上同时存在兼容与不兼容工具：复用兼容项、说明不兼容项、只为缺项形成安装方案；
  - 构造安装被拒 / 下载失败 / 校验失败三条路径：保留结果与原因，断言不换源、不提权、不跳过复验。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-env-compatibility.test.js test/codex-install-env.test.js test/codex-post-install-verify.test.js
```

- 完成条件：三类失败路径各有真实证据（日志 + 退出码 + 保留状态）。
- 失败与回滚：不得为了「让流程走通」而放宽校验或换源。

#### SNA-0803 E2E-05：四类变更各一个实例

- 对应：E2E-05、AC-19–22
- 产物：`docs/verification/stack-neutral-adoption/e2e-05.md`
- 操作：新增功能、修改功能、bug 修复、重构各跑一个真实实例；验证策略与场景一致；已有回归保绿；不伪造故障、不强制全部 case 失败。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scenario-policy.test.js test/codex-constraint-modeling.test.js
```

- 完成条件：四实例齐备，每个含场景类型、验证集、依据、真实结果。
- 失败与回滚：无。

#### SNA-0804 E2E-06 / E2E-07：并发与预算

- 对应：E2E-06、E2E-07、AC-23、AC-26–29
- 产物：`docs/verification/stack-neutral-adoption/e2e-06-07.md`
- 操作：
  - 多独立任务 + 一个依赖任务 + 一个资源冲突任务：动态并发独立任务、等待依赖、处理互斥，最终对统一提交验证；
  - 宿主并发不足 / 超时 / 预算耗尽：降并发或保存进度并停新任务，不隐性突破限制。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scheduler-concurrency.test.js test/codex-scheduler-conflicts.test.js test/codex-scheduler-budget.test.js
```

- 完成条件：两个 E2E 均有真实并发记录（实际并发数、耗时）与预算记录（可获取用量 + 未知标注）。
- 失败与回滚：无。

#### SNA-0805 E2E-08：超大仓库与敏感文件

- 对应：E2E-08、NFR-01、NFR-03
- 产物：`docs/verification/stack-neutral-adoption/e2e-08.md`
- 操作：真实执行一次超预算扫描与一次含疑似密钥文件的扫描；按预算与隐私规则停止或跳过，列出遗漏，经确认分批继续。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-scan-budget.test.js
```

- 完成条件：`unscanned` 与 `skipped` 清单真实输出；跳过项未被描述为已分析。
- 失败与回滚：无。

#### SNA-0806 E2E-09：普通变更与内核变化

- 对应：E2E-09、AC-30、AC-31
- 产物：`docs/verification/stack-neutral-adoption/e2e-09.md`
- 操作：分别执行一次有依据的影响验证与一次真实完整闭环；不触发未经授权的生产部署。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-impact-verification.test.js test/codex-critical-trigger.test.js
```

- 完成条件：两类结论分别可读；生产部署状态为显式 `NOT_RUN`（未授权）。
- 失败与回滚：无。

#### SNA-0807 双平台证据汇总与发行三态表达

- 对应：AC-16、AC-17、D-05
- 产物：`docs/verification/stack-neutral-adoption/platform-summary.md`
- 操作：
  - 汇总 Windows/Linux x64 四类证据，逐平台独立成表，标注日期与提交；
  - macOS/ARM64 显式标为预留/未验证；
  - 明确区分「源码保留能力 / 默认公开能力 / 实际发行能力」，并列出 `package.json:38-48` 的排除项与理由。
- 验证：

```powershell
npm run pack:check
```

- 完成条件：三态表达清晰且与 `pack:check` 实际产物一致；无「源码有但发行没有」的静默差异。
- 失败与回滚：无。

#### SNA-0808 发布检查与基线文档校正

- 对应：NFR-04、NFR-05；D-06
- 产物：`docs/verification/stack-neutral-adoption/release-check.md`、`CHANGELOG` 校正
- 操作：
  - 跑完整发布检查并粘贴真实输出；
  - 校正 `CHANGELOG.zh.md:5` 的工具面数字（现称 43，源码实存 51 个 `sg_*` 名称）与角色描述；
  - 校正 `README` 中与新能力不一致的表述。
- 验证：

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
```

- 完成条件：五条命令真实退出 0；文档数字与源码一致（有机械核对记录）。
- 失败与回滚：若 `format:check` 因既有未格式化文件失败，只修本次引入的文件并记录既有失败，不批量重排用户文件（NFR-07）。

### 12.4 M8 退出门

- [ ] E2E-01 至 E2E-09 全部真实通过，无合成替代；
- [ ] Windows/Linux x64 双平台证据互不代替；
- [ ] macOS/ARM64 明确预留；
- [ ] 发行三态表达与实际 `pack:check` 一致；
- [ ] 五条发布检查命令真实退出 0；
- [ ] 36 条 AC 的最终状态逐条可查，`NOT_RUN` 项如实保留；
- [ ] 未提交、未推送、未部署（除用户另行明确授权）。

### 12.5 M8 失败与回滚

- 任一 E2E 无真实环境（无真实非 Java/Vue 仓库、无 Linux 环境、无真实冲突样例）→ 该 E2E 保持未完成并阻断发布声明，**不得**以 fixture 顶替（FR-09）。
- 发布检查失败 → 保留失败日志，修复后重跑全部五项，不复用修复前的 PASS（AC-35）。

---

## 13. 风险登记册

| #   | 风险                                           | 触发信号                                | 缓解                                                              |
| --- | ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------- |
| R1  | 重基线（M1）被当成「顺手放宽」，演化为绕过校验 | 出现无上界的自由 / 无迁移记录的字段变更 | M1 反例门禁；§5.4 最后一条强制「旧写法仍被拒」                    |
| R2  | 13 个绑定旧约束的测试被静默改写为通过          | 断言删除而非替换、或未列旧→新对照       | §3.1 要求逐条列「旧断言→新断言→理由」                             |
| R3  | 「技术栈无关」被宣传为「全栈自动执行」         | 文档/输出出现「任意技术栈已支持」       | AC-03 缺口报告强制；本文 §4.2 首条                                |
| R4  | 扫描越界读取敏感内容                           | `skipped` 与 `scanned` 混同             | NFR-03 机械断言（SNA-0203）；独立 `skipped` 列表                  |
| R5  | 并发破坏角色独立性（测试设计/实现/Review）     | 同一 agent 兼任设计与实现               | SNA-0603/0604 断言；需求 FR-08 明文禁止                           |
| R6  | 预算被反复重启隐性突破                         | 重启后剩余预算回升                      | SNA-0605 反例断言                                                 |
| R7  | Linux 证据缺失但被 WSL/容器结果顶替            | 平台表出现非原生来源                    | SNA-0402 回滚条款；OI-02 需显式确认等价性                         |
| R8  | 运行约束再次被误建为业务 AC（历史缺陷复现）    | 红/绿两态语义相同的断言出现在业务 AC 下 | SNA-0703 第 4 条反例断言                                          |
| R9  | 覆盖用户未提交改动（当前工作树已有多处修改）   | `git status` 出现被覆盖/回退            | NFR-07；M0 取证固定；任何里程碑不得 `git checkout`/`reset` 该路径 |
| R10 | 发行三态不一致导致用户以为能力可用             | 源码有、发行无且未声明                  | SNA-0807 三态表 + `pack:check` 对照                               |
| R11 | OI 未确认导致返工                              | 某任务以「待确认默认值」交付            | §2.4 表指定首个需要答案的里程碑；默认值必须标注「待确认」         |

---

## 14. 本文件的验证记录

本次仅执行只读扫描与文档写入。

| 检查                                                                                            | 状态       | 说明                                         |
| ----------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------- |
| 只读扫描（文件读取、ripgrep、`git status`、导出核对）                                           | 已执行     | 结论见 §1，均带 `文件:行号`                  |
| 本文件 Markdown 格式检查（`prettier --check`）                                                  | 见交付说明 | 仅证明文档格式，不证明任何功能实现           |
| `npm test`、`npm run lint`、`npm run format:check`、`npm run pack:check`、`npm run codex:smoke` | `NOT_RUN`  | 本次无源码变更；不对当前工作树整体健康作结论 |
| FR-01–FR-10、AC-01–AC-36 的实施与验收                                                           | `NOT_RUN`  | 本文件只做拆分与里程碑，未获实施授权         |
| E2E-01–E2E-09                                                                                   | `NOT_RUN`  | 同上                                         |

历史文档中的通过或失败只作为历史证据，不代替本计划的验收。

---

## 15. 下一步

1. 本文件为 `v0.1-candidate`，**未批准**；批准后可进入 M0。
2. M1 是硬门禁：未通过不得进入 M2。
3. OI-01–OI-08 需在对应里程碑开工**之前**给出结论（见 §2.4）；未给结论时只能用标注为「待确认」的保守默认值，且不得据此宣称验收通过。
4. 实施前需另行取得：需求批准、计划批准、安装批准、开发批准、交付批准（五类分离，AC-36）。

---

## 16. 执行记录（M0–M8）

本节只追加真实验收后的事实，不改变已写的任务范围、覆盖关系或退出门。

| 里程碑                      | 状态         | 提交      | 测试      | 证据                                                                                                                                             |
| --------------------------- | ------------ | --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0 基线取证与影响面测绘     | **已验收**   | `0cb6b4c` | 768/768   | `docs/implementation/stack-neutral-adoption/00-baseline-evidence.md`、`01-binding-matrix.md`、`02-traceability.md`、`03-unwired-capabilities.md` |
| M1 约束重基线门禁           | **已验收**   | `9735d0e` | 800/800   | `04-rebaseline-record.md`                                                                                                                        |
| M2 技术栈无关发现与候选基线 | **已验收**   | `18ca929` | 872/872   | `05-m2-acceptance.md`                                                                                                                            |
| M3 环境能力与受批安装       | **已验收**   | `d7b0947` | 942/942   | `06-m3-acceptance.md`                                                                                                                            |
| M4 跨平台执行与引导边界     | **已验收**   | `171824d` | 986/986   | `07-m4-acceptance.md`                                                                                                                            |
| M5 四类场景验证策略         | **已验收**   | `bffecc2` | 1023/1023 | `08-m5-acceptance.md`                                                                                                                            |
| M6 可调度计划与动态并发     | **已验收**   | `d8da9ca` | 1083/1083 | `09-m6-acceptance.md`                                                                                                                            |
| M7 影响范围验证与审批分离   | **已验收**   | `1156f70` | 1126/1126 | `10-m7-acceptance.md`                                                                                                                            |
| M8 端到端验收与发布         | **部分验收** | `0714f21` | 1141/1141 | `11-ac16-platform-acceptance.md`、`e2e-record.md`；E2E-03/04/06/07/09 为 `NOT_RUN`                                                               |

三个里程碑的执行门均为真实退出 0：`npm test`、`npm run lint`、`npm run format:check`、`npm run pack:check`、`npm run codex:smoke`。

### 16.1 M0 记录要点

- 基线取证时发现 45 个用例在 HEAD 上即失败，根因是系统临时目录根存在空 `.git` 目录（`C:/Users/Administrator/AppData/Local/Temp/.git`，0 条目），被 `src/codex/init.js:255-265` 的祖先探测误判为已有仓库。
- 已排除代码嫌疑：在 `HEAD` 独立 worktree 复现同一失败；改用干净临时根后同一批用例全部通过。
- 经用户确认删除该空目录后，`npm test` 得到 768/768。未修改 `init.js`，登记为观察项 OBS-01。

### 16.2 M1 记录要点

四条硬约束重基线化，每条给齐「旧 → 新 → 生效条件 → 回滚」：

| 约束           | 旧                                                | 新                                                            |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| 并发           | `maxParallelDevelopment !== 1` 直接拒绝           | 正整数且 ≤ 4；越界 `PLAN_PARALLEL_LIMIT_EXCEEDED`；默认仍为 1 |
| 全红基线       | 全局要求每个冻结 case 真实失败                    | 版本化验证档案；旧状态解析为 legacy（语义等价）               |
| 类型词表       | 三处各自维护（`feature/modify/fix` vs `+remove`） | 单一来源 `core/change-types.js`                               |
| ProjectProfile | `stack !== 'java-vue'` 直接拒绝                   | v3 以 capabilities/modules 表达；v2 只读兼容；纯函数迁移器    |

**反例门禁**：每条被解除的约束都有测试断言「旧写法仍被拒」或「新写法受上界约束」，且源码扫描断言禁止回退。

**范围克制**：验证档案只定义结构，未接线到 `development.js`/`quality.js`（有断言守住），因此 AC-19/AC-20 仍为 `NOT_IMPLEMENTED`，接线在 M5。

### 16.3 M2 记录要点

| AC    | 实现入口                                | 关键反例断言                                                    |
| ----- | --------------------------------------- | --------------------------------------------------------------- |
| AC-01 | `core/discovery/stack.js`               | `PROJECT_STACK_UNSUPPORTED` 不再因技术栈出现                    |
| AC-02 | `core/discovery/modules.js`             | 目录名像前后端但无构建文件 → 无模块                             |
| AC-03 | `core/discovery/budget.js`              | 超时/超预算返回 `unscanned`，不抛出                             |
| AC-04 | `core/discovery/candidates.js`          | 静态阶段请求 `user-confirmed` 被拒                              |
| AC-05 | 同上                                    | 静态读测试文件 → `static-observed`，`runtimeVerified === false` |
| AC-06 | `core/discovery/baseline-revision.js`   | 输入 revision 不可变；`actionId` 二次消费被拒                   |
| AC-07 | `core/discovery/baseline-separation.js` | 生成文档不能证明执行；需求基线不能通过执行基线校验              |

**设计修正（需评审知悉）**：初版把「内容命中凭据特征」的文件也移出 `scanned`，实测本仓库有 174 个文件命中（多为测试夹具与含检测正则自身的源码），连自身源码都无法分析。已改为：名称命中 → 跳过；内容命中 → 分析但标记 `redacted`。该语义由测试锁定。

### 16.4 断言变更总账（M0–M2）

| 里程碑 | 文件:行                            | 旧                                          | 新                                     | 依据              |
| ------ | ---------------------------------- | ------------------------------------------- | -------------------------------------- | ----------------- |
| M1     | `codex-plan-core.test.js:194`      | `maxParallelDevelopment = 3` → 拒绝         | `= 5` → 拒绝（专门错误码）；1–4 合法   | D08 上界为 4      |
| M2     | `codex-project-detect.test.js:144` | 无 Maven/前端 → `PROJECT_STACK_UNSUPPORTED` | `ok === true`，不补造模块，`gaps` 非空 | AC-01/AC-02/AC-03 |

**共改 2 条既有断言，均与 `01-binding-matrix.md` 预告一致；其余 11 个受影响测试文件断言未改。**

### 16.5 M0–M2 结束时仍未完成的事项

| 项                                                      | 状态                                             | 归属                    |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------- |
| AC-08 – AC-18（环境、受批安装、跨平台）                 | `NOT_IMPLEMENTED`                                | M3、M4                  |
| AC-19 – AC-36（四类场景、动态并发、影响范围、审批分离） | `NOT_IMPLEMENTED`                                | M5–M7                   |
| 验证档案接线到执行路径                                  | 未做（有意）                                     | M5 / SNA-0502           |
| `refactor` 类型                                         | 未引入（有断言防提前放行）                       | M5 / SNA-0501           |
| 删除 `modules.{backend,frontends}` 旧字段               | 未做（双写过渡）                                 | 最迟 M3 验收前          |
| OI-01 扫描预算数值                                      | 待用户确认，当前标注 `pendingBudgetConfirmation` | 需用户决定              |
| Linux 平台真实证据                                      | `NOT_RUN`                                        | M4 / SNA-0402           |
| `npm run test:mysql`                                    | `NOT_RUN`                                        | M0–M2 未触及 MySQL 代码 |

### 16.6 M3–M8 追加记录

| 里程碑 | 关键交付                                                    | 本阶段修复的真实缺陷                                                          |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| M3     | 能力推导、兼容性三态、有界发现、安装方案契约、安装后复验    | `<root>/bin/<exe>` 布局未检查（JAVA_HOME 标准布局）                           |
| M4     | 平台层、证据驱动的三态声明、启动诊断、CI 矩阵               | —                                                                             |
| M5     | `refactor` 接入、场景策略接线、结果分类、模块角色驱动任务图 | 图校验三处硬编码（kind 必现、AC 全覆盖、集成依赖字面量）                      |
| M6     | 拓扑分层、槽位与冲突、预算断点恢复、集成绑定                | —                                                                             |
| M7     | 影响分析、内核触发、AC 性质、分层报告、五类审批             | `--write` 与 `--check` 并存时误判为只读                                       |
| M8     | 双平台证据、发行三态、E2E 真实仓库                          | Python 构建文件识别缺失；Linux 上 9 个 cancelled；测试硬编码 Windows 绝对路径 |

### 16.7 双平台验收结论（AC-16）

| 平台          | 形态                                                        | npm test  | 等级          |
| ------------- | ----------------------------------------------------------- | --------- | ------------- |
| Windows x64   | 原生宿主，Node 24.14.0                                      | 1141/1141 | **supported** |
| Linux x64     | **原生 VMware Ubuntu 26.04.1**，内核 7.0.0-38，Node 22.22.1 | 1109/1109 | **supported** |
| macOS / ARM64 | 预留                                                        | —         | reserved      |

Linux 首轮 30 fail + 9 cancelled，逐项归因后修复：

1. 30 个失败 = 测试环境缺 git 身份（`GIT_IDENTITY_REQUIRED`），配置后消失；
2. 9 个 cancelled = `outbound-worker` 两处 `timer.unref()`：unref 后若定时器是唯一待处理任务，Node 判定事件循环已空，正在 await 的请求被判 pending-but-loop-resolved。Node 22 报 cancelled，Node 24 容忍——**这是 Windows 全绿掩盖的真实运行时缺陷**；
3. 剩余 4 个 = 测试硬编码 `C:\secure\mysql.json`，在 Linux 上 `path.isAbsolute` 为 false。改为 `path.resolve('/secure/mysql.json')`。

### 16.8 最终 AC 状态

| AC 范围                      | 状态                                 | 说明                                    |
| ---------------------------- | ------------------------------------ | --------------------------------------- |
| AC-01 – AC-36 的**结构实现** | 已实现并有测试                       | 376 条新增断言分布在 20 个测试文件      |
| AC-16 双平台真实验收         | **通过**                             | 两平台原生执行，均 0 fail / 0 cancelled |
| AC-31 关键版本完整闭环       | `NOT_RUN`                            | 需 OI-06 确认关键版本清单               |
| AC-30/33/34/35/36            | 有单测覆盖，真实端到端部分 `NOT_RUN` | 见 `e2e-record.md`                      |

### 16.9 仍未完成（如实保留）

| 项                                        | 状态       | 原因                                             |
| ----------------------------------------- | ---------- | ------------------------------------------------ |
| E2E-03 兼容/不兼容工具并存                | `NOT_RUN`  | 需在 VM 安装真实对照工具链                       |
| E2E-04 安装失败三路径                     | `NOT_RUN`  | 需 OI-04 确认下载源策略后才可真实安装            |
| E2E-06/07 多任务并发与预算耗尽            | `NOT_RUN`  | 需 H1 审批后的真实多任务工作流                   |
| E2E-09 关键版本闭环                       | `NOT_RUN`  | 需 OI-06                                         |
| OI-02 平台验收样例正式确认                | 待用户确认 | 本次用 VMware Ubuntu 26.04.1，需用户认可其等价性 |
| OI-06 关键版本清单                        | 待用户确认 | 当前保守默认：全部内核模块变更均触发完整闭环     |
| 删除 `modules.{backend,frontends}` 旧字段 | 未做       | 双写过渡，需消费方全部迁移                       |
| `npm run test:mysql`                      | `NOT_RUN`  | 两平台均未配置 MySQL                             |

**M8 因此为部分验收，发布声明被上述 `NOT_RUN` 项阻断。**
