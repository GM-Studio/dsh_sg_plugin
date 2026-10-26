# M2 验收记录：技术栈无关发现与候选需求基线

日期：2026-10-26
里程碑：M2（覆盖 FR-01、FR-02；NFR-01、NFR-02、NFR-03、NFR-04）
状态：**已通过**（全部退出门有真实执行证据）

## 1. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                             |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `npm test`             | 0      | tests 872 / pass 872 / fail 0 / cancelled 0 / skipped 0 / todo 0 |
| `npm run lint`         | 0      | 通过                                                             |
| `npm run format:check` | 0      | 通过                                                             |
| `npm run pack:check`   | 0      | 通过                                                             |
| `npm run codex:smoke`  | 0      | 通过                                                             |

测试数从 M1 的 800 增至 872（+72 条，全部为 M2 新增断言）。

## 2. AC 逐条验收

### AC-01 没有 Maven、Vue 或 React 的仓库可获得扫描结果

- 实现：`src/codex/core/discovery/stack.js`（`detectStack`）；`project-detect.js` 移除 Maven+前端二元拒绝。
- 证据：`test/codex-stack-detect.test.js` —— 纯 Maven、纯前端、纯 Python、空目录四种仓库均返回 `ok: true`。
- 证据：`test/codex-project-detect.test.js` —— 只有 `index.js` 的仓库返回 `ok: true` 且 `code === undefined`。
- 反例：`PROJECT_STACK_UNSUPPORTED` 不再因技术栈出现（有断言）。

### AC-02 纯后端、纯前端、CLI、库及多模块样例能表达实际结构，不补造模块

- 实现：`src/codex/core/discovery/modules.js`（`discoverModules`、`inferModuleRole`）。
- 证据：`test/codex-module-discovery.test.js` —— Maven 多模块报 3 个模块（packaging=pom → other，spring-boot → service，jar → library）；npm workspaces 逐个上报；CLI 判为 `cli`。
- 反例：目录名像 `backend`/`frontend` 但无构建文件 → 模块列表为空（两条独立断言）。
- 反例：`inferModuleRole` 对 6 种构建系统均不返回 `backend`/`frontend`。

### AC-03 缺少业务工具链时仍能完成只读分析，并明确列出缺口

- 实现：`src/codex/core/discovery/budget.js`（`scanRepository`）与两处 `gaps` 汇总。
- 证据：`test/codex-scan-budget.test.js` —— 超文件预算报 `unscanned`；超深度报 `unscanned`；超时返回部分结果不抛出。
- 证据：空目录的 `gaps` 同时含「未发现任何已知构建文件」与「未识别到任何模块」。

### AC-04 候选需求能查看来源及证据类别，模型推断不显示为用户确认

- 实现：`src/codex/core/discovery/candidates.js`（`candidateRequirement`、`renderCandidate`）。
- 证据：`test/codex-candidate-requirements.test.js` —— `inferred-intent` 渲染为「模型推断（未经用户确认）」，且不匹配「用户已确认」。
- 反例：静态阶段请求 `user-confirmed` 或 `runtime-verified` → `CANDIDATE_EVIDENCE_ESCALATION`。

### AC-05 仅静态读取测试时，该行为不被标为运行验证通过

- 证据：`test/codex-candidate-requirements.test.js` —— 「reading a test file statically never becomes runtime-verified」断言 `evidenceClass === 'static-observed'` 且 `runtimeVerified === false`。
- 证据：`evidenceGaps` 把「能力已声明但未执行」显式列为缺口，不当作通过。

### AC-06 用户可确认、纠正或拒绝推断；基线修订保留历史，不覆盖原始证据

- 实现：`src/codex/core/discovery/baseline-revision.js`。
- 证据：`test/codex-baseline-revision.test.js` —— 确认后类别升级但 `history[0].original.evidenceClass` 仍为原值；纠正产生 revision N+1 且旧陈述可读；拒绝只标记不删除。
- 反例：输入 revision 不被就地修改（JSON 快照比对）；同一 `actionId` 二次消费被拒。

### AC-07 需求基线与构建/测试执行基线分别表达

- 实现：`src/codex/core/discovery/baseline-separation.js`。
- 证据：`test/codex-baseline-separation.test.js` —— 缺执行基线时 `executionStatus === 'execution-baseline-not-established'`；两类基线 `id`/`createdAt` 独立。
- 反例：需求基线不能通过 `validateProjectBaseline`（`BASELINE_INVALID`）。
- 反例：生成文档不得证明执行（`DOCUMENT_CANNOT_PROVE_EXECUTION`）；`not-run` 不等于通过。

## 3. NFR 逐条验收

| NFR    | 要求           | 证据                                                                                       | 状态 |
| ------ | -------------- | ------------------------------------------------------------------------------------------ | ---- |
| NFR-01 | 扫描有界       | 文件数/单文件/总字节/时间/深度五项预算，超限报 `unscanned`；顶层目录数与单目录条目数有上限 | 通过 |
| NFR-02 | 数据边界       | 全程本地只读，无网络调用                                                                   | 通过 |
| NFR-03 | 敏感内容保护   | 名称命中 → 跳过且不入 `scanned`（6 类文件名断言）；内容命中 → 分析但标 `redacted`          | 通过 |
| NFR-04 | 可复现与可追溯 | `snapshotId` 内容哈希，与顺序无关、无 Git 也可用                                           | 通过 |

## 4. 关键设计决定（需评审确认）

### 4.1 内容级密钥检测不排除文件，只标记脱敏

初版实现把「内容匹配凭据特征」的文件也移出 `scanned`。实测本仓库有 **174 个文件** 命中该特征（多为测试夹具与含检测正则自身的源码），导致连自己的源码都无法被分析。

修正后的语义（已由测试锁定）：

| 情形                                         | 处理                                              | 理由                                                       |
| -------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| 文件名疑似密钥（`.env`、`*.pem`、`id_rsa`…） | **跳过**，不入 `scanned`                          | 这类文件本身即凭据载体，不读取内容                         |
| 文件内容命中凭据特征                         | **分析**，标记 `redacted: true`，列入 `sensitive` | 保护凭据不等于让代码不可分析；后续证据不得引用检出的字面量 |

这满足 NFR-03「跳过项不能被描述为已分析」，同时避免「含检测正则的源码无法被分析」。

### 4.2 `modules.{backend,frontends}` 与 `moduleList` 双写

为兼容既有消费方，`detectProject` 同时返回：

- `modules: { backend, frontends }` —— 既有形状，保留；
- `moduleList` / `moduleRoles` / `moduleObservations` —— 通用模块列表。

**退场条件**：待所有消费方（`project-adopt`、`baseline`、`adopted-verification`）改用 `moduleList` 后删除旧字段，最迟在 M3 验收前完成并记录。

### 4.3 预算默认值标注为待确认

OI-01 尚未给出数值，因此 `scanRepository` 返回 `pendingBudgetConfirmation: true`，避免保守默认值被误当作已批准预算。

## 5. 断言变更记录

按 `01-binding-matrix.md` 预告，M2 只改 1 条既有断言：

| 文件:行                            | 旧断言                                      | 新断言                                                                           | 理由                       |
| ---------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| `codex-project-detect.test.js:144` | 无 Maven/前端 → `PROJECT_STACK_UNSUPPORTED` | `ok === true`、`modules` 不补造、`stack === null`、`gaps` 含两条缺口、目录无写入 | AC-01/AC-02/AC-03 直接要求 |

另在 `codex-project-detect.test.js` 与 `codex-plan-core.test.js` 中按需补充断言，均未删除既有断言。

**其余 11 个受影响测试文件的断言一条未改。**

## 6. 新增文件

| 文件                                              | 用途                         |
| ------------------------------------------------- | ---------------------------- |
| `src/codex/core/discovery/stack.js`               | 技术栈/构建系统/包管理器探测 |
| `src/codex/core/discovery/modules.js`             | 模块边界与角色识别           |
| `src/codex/core/discovery/budget.js`              | 有界扫描、跳过规则、缺口报告 |
| `src/codex/core/discovery/candidates.js`          | 候选需求与证据类别           |
| `src/codex/core/discovery/baseline-revision.js`   | 确认/纠正/拒绝与历史保留     |
| `src/codex/core/discovery/baseline-separation.js` | 需求基线与执行基线分离       |
| `test/codex-stack-detect.test.js`                 | 12 条                        |
| `test/codex-module-discovery.test.js`             | 10 条                        |
| `test/codex-scan-budget.test.js`                  | 15 条                        |
| `test/codex-candidate-requirements.test.js`       | 13 条                        |
| `test/codex-baseline-revision.test.js`            | 12 条                        |
| `test/codex-baseline-separation.test.js`          | 10 条                        |

## 7. 修改文件

| 文件                          | 改动                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/codex/project-detect.js` | 引入 `detectStack`/`discoverModules`；移除 Maven+前端二元拒绝；`conventions` 仅为真实存在的前端表达；新增观察/能力/模块字段 |

## 8. 未做的事

| 项                                 | 归属                             |
| ---------------------------------- | -------------------------------- |
| 能力推导与工具链兼容判定（FR-03）  | M3 / SNA-0301..0303              |
| 安装方案与受批安装（FR-04）        | M3 / SNA-0304..0305              |
| Linux 平台证据与 CI 矩阵（FR-05）  | M4 / SNA-0402                    |
| 候选基线接入真实 H1 冻结流程       | 需审批，本里程碑只提供结构与测试 |
| 删除 `modules.{backend,frontends}` | 待退场条件满足（见 §4.2）        |

## 9. 未执行项（如实记录）

| 检查                       | 状态       | 说明                                               |
| -------------------------- | ---------- | -------------------------------------------------- |
| `npm run test:mysql`       | `NOT_RUN`  | M2 未触及 MySQL 相关代码；Core 门禁不含 MySQL 用例 |
| Linux 平台真实执行         | `NOT_RUN`  | 属 M4 范围                                         |
| 真实非 Java/Vue 仓库端到端 | `NOT_RUN`  | 属 M8 / E2E-01                                     |
| OI-01 预算数值确认         | 待用户确认 | 当前为标注待确认的保守默认值                       |
