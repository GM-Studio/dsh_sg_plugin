# SNA-0001 基线证据（SpecGate 技术栈无关接入 · M0）

日期：2026-10-26（Asia/Shanghai）
取证方式：只读命令 + 真实执行；未修改源码、未安装依赖、未创建工作树、未提交。

## 1. 仓库与工作树

| 项       | 值                                                      |
| -------- | ------------------------------------------------------- |
| 分支     | `sg-codex`                                              |
| HEAD     | `702012adc4f960d093c43b708474ea598056a703`              |
| 提交说明 | `feat(core): complete reliable delivery MVP automation` |
| 插件版本 | `0.3.4`                                                 |

## 2. 工具链

| 工具     | 版本                   |
| -------- | ---------------------- |
| Node.js  | `v24.14.0`             |
| npm      | `11.9.0`               |
| git      | `2.56.0.windows.2`     |
| prettier | `3.9.10`               |
| 平台     | Windows x64（`win32`） |

## 3. 测试规模

- `test/*.test.js` 文件数：**102**
- Core 全量用例数（真实执行）：**768**

## 4. 既有未提交改动（NFR-07 必须保留，不得覆盖或回退）

本次取证时 `git status --porcelain` 的已跟踪修改：

| 文件                                                                      | 归属                         |
| ------------------------------------------------------------------------- | ---------------------------- |
| `src/codex/development.js`                                                | 本会话之前存在               |
| `src/codex/management/server.js`                                          | 本会话之前存在               |
| `src/codex/workflow-tools.js`                                             | 另一会话（2026-10-26 15:17） |
| `test/codex-development-flow.test.js`                                     | 本会话之前存在               |
| `test/codex-management-api.test.js`                                       | 本会话之前存在               |
| `eslint.config.js`                                                        | 本会话之前存在               |
| `docs/implementation/specgate-core-mvp-v2/10-m6-verification.md`          | 本会话之前存在               |
| `docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md` | 本会话之前存在               |
| `docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan.zh.md`    | 本会话之前存在               |

未跟踪但需保留的产物：`src/codex/core/frozen-execution.js`、`test/codex-frozen-execution.test.js`、`docs/verification/specgate-core-mvp/execution-20261026/**`、`.task-evidence/`、`.npm-cache/`、`jacoco.exec` 等。

**约束**：M0–M2 的任何提交只纳入本阶段相关文件（显式 pathspec），上述改动一律保留在工作树中。

## 5. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                             |
| ---------------------- | ------ | ---------------------------------------------------------------- |
| `npm test`             | 0      | tests 768 / pass 768 / fail 0 / cancelled 0 / skipped 0 / todo 0 |
| `npm run lint`         | 0      | 通过                                                             |
| `npm run format:check` | 0      | 通过                                                             |
| `npm run pack:check`   | 0      | 通过                                                             |
| `npm run codex:smoke`  | 0      | 通过（`trustedApproval`、`subagents` 如实为 `not-run`）          |

## 6. 取证期间修复的环境阻塞项（非代码缺陷）

**现象**：首次执行 `npm test` 时 **45 个用例失败**，其中 `test/codex-environment.test.js` 报 `INIT_EXISTING_GIT_UNSUPPORTED`（期望 `ENV_NOT_READY`）。

**根因**：系统临时目录根 `C:/Users/Administrator/AppData/Local/Temp/.git` 存在一个**空目录**（0 条目，`git rev-parse` 自身返回 128 不认它，mtime 2026-10-25 19:37，属历史测试残留）。`src/codex/init.js:255-265` 的 `inspectGit` 祖先探测按 `.git` **目录存在性**判定，于是把临时目录下新建的项目全部判为「位于已有 Git 仓库内」，`init.js:583` 因 `preview.git.enclosing` 为真返回 `INIT_EXISTING_GIT_UNSUPPORTED`。

**排除代码嫌疑的证据**：

1. 在 `HEAD` 的独立 worktree（`/tmp/sna-head-base`，detached `702012a`）中复现同一失败，证明与当前工作树的未提交改动无关；
2. 把 `TEMP`/`TMP` 指向干净目录 `E:\sna-test-temp` 后，同一用例 **15/15 全部通过**。

**处置**：经用户确认后删除该空 `.git` 目录（`rmdir`，仅对空目录成功，未删除任何文件）。删除后重跑 `npm test` 得到 **768/768 全绿**。

**未做**：未修改 `init.js` 的祖先探测逻辑。该探测在此场景下确实偏严（空 `.git` 目录不应构成本仓库），但属既有行为、超出 M0–M2 范围，登记为观察项 OBS-01 供后续评估。

| 编号   | 观察                                             | 证据                                | 处置                                                                |
| ------ | ------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------- |
| OBS-01 | 祖先探测按 `.git` 目录存在性判定，空目录也会命中 | `src/codex/init.js:255-265`、`:583` | 本次不改代码；环境已清理；建议后续里程碑评估改为校验 Git 仓库有效性 |

## 7. 本文件不声称的事项

- 不代表 FR-01–FR-10 或任何 AC 已实现；
- 不代表当前工作树整体健康（既有未提交改动未经本次评审）；
- 未执行 MySQL 用例（`npm run test:mysql`），未执行双平台验收。
