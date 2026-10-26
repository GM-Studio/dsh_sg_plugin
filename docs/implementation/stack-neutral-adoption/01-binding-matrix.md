# SNA-0002 技术栈绑定影响面矩阵（M0）

日期：2026-10-26
本文件逐条展开计划 §1.1（B-01–B-14）与 §1.3（D-01–D-06），并列出 13 个受影响测试文件里被钉住的具体断言。

## 1. 绑定点（B-01–B-14）

| #    | 文件:行                                                                  | 当前行为                                                                                                             | 目标行为                                  | 受影响测试                                             |
| ---- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| B-01 | `src/codex/project-detect.js:235-241`                                    | 无 Maven 根或无前端 package 根 → `PROJECT_STACK_UNSUPPORTED` 整体拒绝                                                | 返回 `ok: true` + 观察 + 能力清单 + 缺口  | `codex-project-detect`                                 |
| B-02 | `src/codex/project-model.js:128`                                         | `value.stack !== 'java-vue'` → `PROJECT_PROFILE_INVALID`                                                             | v3 由 `capabilities` 校验，`stack` 仅描述 | `codex-project-model`                                  |
| B-03 | `src/codex/project-model.js:101-121`                                     | `backendPackage`/`frontendDefaultLocale`/`frontendLocales`/`frontendFramework`/`javaPreset` 为 Java/Vue 专属顶层字段 | 迁入通用约定/能力描述                     | `codex-project-model`、`codex-project-conventions`     |
| B-04 | `src/codex/project-adopt.js:91`、`:116`                                  | 写死 `stack: 'java-vue'`                                                                                             | 由检测结果决定                            | `codex-project-adopt`（经 `codex-project-model` 覆盖） |
| B-05 | `src/codex/project-new.js:117`                                           | 写死 `stack: 'java-vue'`                                                                                             | 同上                                      | `codex-project-new`                                    |
| B-06 | `src/codex/init.js:754`、`src/codex/core/java/java-init.js:243-247`      | 模板固定 `codex-java-vue-template`；非 `java-vue` 预设直接拒绝                                                       | M0–M2 不改（新建模板属 FR-01 后续范围）   | `codex-init-adapter`、`codex-project-conventions`      |
| B-07 | `src/codex/core/environment.js:38`、`:54`                                | 从 `backend/pom.xml` + `frontend/package.json` 推断预设                                                              | 由能力推导决定（M3）                      | `codex-environment`                                    |
| B-08 | `src/codex/environment-tools.js:2-4`                                     | 预设枚举固定 3 组 JDK/Boot + `vue`/`react`                                                                           | 能力推导为权威，预设降为快捷方式（M3）    | `codex-environment`                                    |
| B-09 | `src/codex/core/java/verify-evidence.js:7-17`、`src/codex/quality.js:14` | 固定 8 段 Java/Vue 验证阶段 + `frontend-runtime`                                                                     | 按能力选择阶段（M5/M7）                   | `codex-quality-gate`                                   |
| B-10 | `src/codex/verify.js:166`、`src/codex/core/java/java-verify.js:348`      | `metadata.stack !== 'java-vue'` 直接拒绝                                                                             | 不再以 stack 字符串作准入门禁             | `codex-verify-adapter`                                 |
| B-11 | `src/codex/plan.js:162`、`:403`                                          | `maxParallelDevelopment !== 1` → `PLAN_GRAPH_INVALID`；生成写死 1                                                    | 上界校验（≤4，D08），默认仍 1             | `codex-plan-core`                                      |
| B-12 | `src/codex/plan.js:19-38`                                                | 8 种 kind / 6 种 role，`contract`/`model` → backend                                                                  | 映射可配置，默认不变                      | `codex-plan-core`                                      |
| B-13 | `src/codex/development.js:13-14`                                         | `DEVELOPMENT_ROLES = ['frontend','backend']`                                                                         | 由计划角色驱动（M5/M6）                   | `codex-development-flow`                               |
| B-14 | `src/codex/development.js:469-503`                                       | 每个冻结 case 必须真实失败，否则 `RED_REPORT_INVALID`                                                                | 按验证档案差异化（M5）                    | `codex-development-flow`、`codex-quality-gate`         |

## 2. 语义漂移（D-01–D-06）

| #    | 问题                              | 文件:行                                                                                                                                             | 目标                             | 归属里程碑                    |
| ---- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| D-01 | 变更类型词表三处不一致            | `src/codex/change-policy.js:3`（`feature/modify/fix`）vs `src/codex/core/state.js:22`（加 `remove`）、`src/codex/core/change.js:398`（加 `remove`） | 单一常量来源，集合相等由测试断言 | M1 / SNA-0103                 |
| D-02 | `refactor` 既不在词表也无验证策略 | `src/codex/change-policy.js:57-72` 仅对 fix/modify 设必填                                                                                           | 引入 `refactor` 与其必填字段     | M5 / SNA-0501                 |
| D-03 | 并发必须为 1，是校验层拒绝        | `src/codex/plan.js:162`                                                                                                                             | 上界校验 + 专门错误码            | M1 / SNA-0102                 |
| D-04 | 全红基线为全局约束                | `src/codex/development.js:469-503`                                                                                                                  | 版本化验证档案                   | M1 / SNA-0101 → M5 / SNA-0502 |
| D-05 | 发行三态未显式建模                | `package.json:38-48`                                                                                                                                | 三态显式表达                     | M8 / SNA-0807                 |
| D-06 | 工具面数字漂移（43 vs 51）        | `CHANGELOG.zh.md:5`                                                                                                                                 | 校正文档                         | M8 / SNA-0808                 |

## 3. 13 个受影响测试文件的具体钉住断言

| 测试文件                             | 钉住的断言（行号）                                                                | 本计划的处置                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `codex-adopted-verification.test.js` | `:23` fixture `stack: 'java-vue'`                                                 | v2 只读兼容，**不改**                                                                                      |
| `codex-change-add-flow.test.js`      | `:166` fixture `stack: 'java-vue'`                                                | 同上                                                                                                       |
| `codex-dev-launcher.test.js`         | `:16` 读 `assets/java-vue/template/scripts/*.mjs.tpl`                             | 与本计划无关（模板资产），**不改**                                                                         |
| `codex-development-flow.test.js`     | `:382` fixture `stack: 'java-vue'`                                                | v2 只读兼容                                                                                                |
| `codex-plan-core.test.js`            | `:168` `assert.equal(large.graph.maxParallelDevelopment, 1)`                      | **必须保留**：默认仍为 1                                                                                   |
|                                      | `:194` `graph.maxParallelDevelopment = 3` → `validateTaskGraph(...).ok === false` | **M1 需改**：3 应改为合法（≤4）。改为 5 越界，并新增 1..4 合法断言                                         |
|                                      | `:204` `{acs:[null],tasks:[],maxParallelDevelopment:2}` → `ok === false`          | **保持不变**：该断言失败原因是空 tasks，与并发无关                                                         |
| `codex-plugin-package.test.js`       | `:169`、`:192` 断言发行包不含 `assets/java-vue/`                                  | 与本计划无关（发行隔离），**不改**                                                                         |
| `codex-project-conventions.test.js`  | `:25`、`:29` 读 `assets/java-vue/template*`                                       | 与本计划无关，**不改**                                                                                     |
|                                      | `:103` 写 `{stack:'java-vue',preset:'jdk21-boot3.5',frontendFramework:'react'}`   | v2 兼容                                                                                                    |
| `codex-project-detect.test.js`       | `:90` `assert.equal(result.stack, 'java-vue')`                                    | **保留**：Java/Vue 仓库的 `stack` 仍为该值                                                                 |
|                                      | `:144` `assert.equal(result.code, 'PROJECT_STACK_UNSUPPORTED')`                   | **M2 需改**：`AC-01` 要求该场景返回 `ok: true`。改为断言 `ok === true` 且 `capabilities` 为空、`gaps` 非空 |
| `codex-project-model.test.js`        | `:23` fixture `stack: 'java-vue'`                                                 | v2 只读兼容                                                                                                |
| `codex-project-new.test.js`          | `:59`、`:109` `stack: 'java-vue'`                                                 | v2 兼容（新建路径 M2 不改）                                                                                |
| `codex-quality-gate.test.js`         | `:228`、`:745` fixture `stack: 'java-vue'`                                        | v2 兼容                                                                                                    |
| `codex-review-release.test.js`       | `:51` fixture `stack: 'java-vue'`                                                 | v2 兼容                                                                                                    |
| `codex-verify-adapter.test.js`       | `:72` `.specgate/monorepo.json` 写 `stack: 'java-vue'`                            | **不改**：该路径是初始化项目的 monorepo 元数据，非 ProjectProfile                                          |

### 断言变更汇总（旧 → 新 → 理由）

| 文件:行                            | 旧断言                                            | 新断言                                                                                      | 理由                                                   | 里程碑   |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------- |
| `codex-plan-core.test.js:194`      | `maxParallelDevelopment = 3` → `ok === false`     | `= 5` → `ok === false`（码 `PLAN_PARALLEL_LIMIT_EXCEEDED`）；新增 `1/2/3/4` → `ok === true` | D08 上界为 4，3 合法；原断言把「只允许 1」固化进了测试 | SNA-0102 |
| `codex-project-detect.test.js:144` | 无 Maven/前端的仓库 → `PROJECT_STACK_UNSUPPORTED` | `ok === true`，`capabilities` 为空、`gaps` 非空、`modules` 不虚构前后端                     | AC-01/AC-02/AC-03 直接要求                             | SNA-0201 |

**其余 11 个测试文件的断言一条不改。**

## 4. 与 AGENTS.md 规则的交叉核对

| 规则                                                                        | 本计划是否触及 | 说明                                                                                                       |
| --------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| 生成 HTTP API：查询 GET、变更 POST；`/update`、`/delete` 的 id 在 JSON body | 否             | M0–M2 不改 HTTP 层                                                                                         |
| 不引入版本命名的兼容目录或导入                                              | 是（须遵守）   | 实施产物目录为 `docs/implementation/stack-neutral-adoption/`，不带版本号；不做 `v2/`、`codex-v1/` 之类目录 |
| 保留用户工作树改动；非经明确请求不提交不推送                                | 是（须遵守）   | 本次已获「每阶段验收后本地提交」授权；提交仅含本阶段文件                                                   |
| 初始化生成不等于验证；未执行检查必须显式记录                                | 是（须遵守）   | 全部验收产物区分 `NOT_RUN` 与真实退出码                                                                    |
| 工具链发现必须有界、跨平台、复用既有安装                                    | 是（须遵守）   | 支撑 NFR-01 与 FR-03                                                                                       |
| 聚焦回归 → `npm test` → lint → format:check → pack:check                    | 是（须遵守）   | 每个里程碑退出门按此顺序                                                                                   |

## 5. 结论

- 本计划在 M0–M2 期间**只改 2 条既有断言**，且都有 AC 直接背书；
- 其余绑定点通过「新增字段 / 新增模块 / 上界放宽 / v2 只读兼容」实现，不删除既有语义；
- `maxParallelDevelopment` 默认值仍为 1，因此 `codex-plan-core.test.js:168` 无需改动。
