# M0 阶段验收报告

- 里程碑：**M0 基线取证与需求基线**
- 计划版本：`v2.0-approved`
- 验收时间：2026-10-25
- 验收方式：**真实命令执行 + 交付物逐项核对**，不采信自述

---

## 1. 交付物清单

| 任务       | 交付物                       | 行数 | 状态                     |
| ---------- | ---------------------------- | ---- | ------------------------ |
| CORE2-0001 | `00-baseline-evidence.md`    | 327  | 完成                     |
| CORE2-0002 | `01-requirements-mapping.md` | 157  | 完成                     |
| CORE2-0003 | `02-canary-entry.md`         | 170  | 完成（结论：M6 BLOCKED） |
| CORE2-0004 | `03-superseded-plan.md`      | 131  | 完成                     |

目录：`docs/implementation/specgate-core-mvp-v2/`，合计 785 行。

四份产物均通过 `npx prettier --check`（exit 0）。

---

## 2. M0 退出门逐条核对（计划 §4.5）

| #   | 退出门条件                                   | 结果     | 证据                                                     |
| --- | -------------------------------------------- | -------- | -------------------------------------------------------- |
| 1   | NR-01 至 NR-06 全部有真实证据，无一 NOT_RUN  | **通过** | 6/6 已回填，见 `00-baseline-evidence.md` §3              |
| 2   | 30 条 RQ 映射完整，无遗漏                    | **通过** | `01-requirements-mapping.md` §2–§5，RQ-001…RQ-030 全覆盖 |
| 3   | 用户未跟踪文件已登记且未被修改               | **通过** | 9 项登记（U1–U9），`git status` 确认零改动               |
| 4   | 金丝雀入口条件已明确，或明确标记 M6 将被阻断 | **通过** | 无合格项目，`02-canary-entry.md` 判定 **M6 BLOCKED**     |
| 5   | 旧计划失效声明已落盘                         | **通过** | `03-superseded-plan.md`                                  |

**M0 退出门 5/5 通过。**

---

## 3. M0 验收命令结果

### 3.1 npm run lint

```text
$ npm run lint
> eslint .
退出码：0        ← 通过
```

### 3.2 npm run format:check

```text
$ npm run format:check
Checking formatting...
[warn] docs/plans/2026-10-25-...-plan-v2.zh.md          ← 已批准文档
[warn] docs/requirements/2026-10-25-...delta-v1.1.zh.md ← 已冻结文档
[warn] test/codex-control-auth-mysql.test.js            ← 预先存在
[warn] test/codex-control-worker-mysql.test.js          ← 预先存在
```

**M0 未使该状态恶化**：4 个文件中 2 个是本次工作前就存在的基线缺陷，2 个是已冻结/已批准文档（改动会使锚点哈希失效）。**M0 新建的 4 份产物已全部格式化通过，未新增任何格式债。**

### 3.3 npm test（M0 验收轮）

```text
$ npm test
ℹ tests 710
ℹ pass 705
ℹ fail 5
ℹ skipped 0
```

**本轮 5 个失败全部为 MySQL 外部依赖**，无非 MySQL 失败。

### 3.4 三轮 npm test 对照（flake 判定证据）

| 轮次                       | tests | pass    | fail  | MySQL 失败 | 非 MySQL 失败                  |
| -------------------------- | ----- | ------- | ----- | ---------- | ------------------------------ |
| 第 1 轮（CORE2-0001 取证） | 710   | 704     | 6     | 5          | 1（`codex-management-auth`）   |
| 第 2 轮（复现确认）        | 710   | 704     | 6     | 5          | 1（`codex-management-worker`） |
| 第 3 轮（M0 验收）         | 710   | **705** | **5** | 5          | **0**                          |

**结论**：MySQL 的 5 项失败**稳定复现**（真实环境缺失）；第 6 项每次不同且本轮消失，**确认是并发端口 flake**，已定位根因（`server.js` 随机端口撞 undici 保留端口，采样命中率 0.4%）。

---

## 4. AC-MVP 系列当前状态

| 验收项                       | 状态        | 依据                                   |
| ---------------------------- | ----------- | -------------------------------------- |
| AC-MVP-01 完整成功链路       | **BLOCKED** | 无合格金丝雀项目                       |
| AC-MVP-02…09                 | 待 M1–M6    | 可在本仓库验证，不依赖金丝雀           |
| AC-MVP-10 当前提交自身可发布 | **不成立**  | `npm test` fail=5；`format:check` 失败 |
| AC-MVP-11…16                 | 待 M1–M6    | 不依赖金丝雀                           |

---

## 5. M0 期间发现、需用户裁决的 4 项

### D-01 format:check 与已冻结/已批准文档冲突

两份文档 prettier 不通过，但修改会使已记录的锚点哈希失效。

- **A（推荐）**：保持字节不变，交由 M5 / CORE2-0504 在拆分流水线时统一处理（含冻结文档白名单）。
- **B**：`prettier --write`（纯空白），同时重算并更新锚点哈希，文内注明「格式重排，语义无变化」。
- **C**：把 `docs/**/*.md` 移出 prettier 检查范围（改 `.prettierignore`）。

### D-02 并发端口 flake 是否纳入需求

**新发现的真实缺陷**，未被任何现有条款覆盖，但直接使 AC-024-01 无法稳定成立。

- **A（推荐）**：新增 AC-024-05「随机端口分配须规避标准 HTTP 客户端保留端口」，归入 M5。
- **B**：登记为已知缺陷，不纳入本版需求，测试侧加规避。
- **C**：不处理，M6 以重跑容忍。

### D-03 两个预先存在的 test 文件格式失败

`test/codex-control-auth-mysql.test.js`、`test/codex-control-worker-mysql.test.js` 已跟踪未修改但 prettier 不通过。

- **A（推荐）**：随 M5 / CORE2-0504 测试分流一并修正。
- **B**：立即修正（纯格式）。

### D-04 金丝雀技术栈不匹配（阻塞 M6）

**最接近的候选** `E:\ai_workflow\pilot-java-api`：Git 仓库、工作区干净（0 脏文件）、独立目录 —— 但技术栈为 **JDK 8 + Spring Boot 2.7.18 且无前端**，不满足 AC-022-02（JDK 17 + Boot 3.5 + Vue 3）。

全机扫描无任何项目满足该栈（详见 `02-canary-entry.md` §2）。

- **A（推荐）**：用户提供一个满足 AC-022-02 的真实项目，M6 才解锁。
- **B**：用户批准把 `pilot-java-api` 作为金丝雀，**须修改已冻结的 AC-022-02 并重新审批**。
- **C**：接受 M6 长期 BLOCKED，MVP 以「M1–M5 已验证 + 未验证金丝雀」交付。

---

## 6. 工作区状态（M0 结束后）

```text
$ git status --porcelain
?? .codex-read-change-add.txt        ← 用户遗留，未动
?? .npm-cache/                       ← 缓存，未动
?? docs/implementation/specgate-core-mvp-v2/   ← M0 产出（新增）
?? docs/plans/...-plan-v2.zh.md        ← 已批准计划
?? docs/plans/...-plan.zh.md           ← 旧计划，未动
?? docs/requirements/...delta-v1.1.zh.md  ← 冻结，未动
?? docs/requirements/...mvp.zh.md         ← 冻结，未动
?? node-out.txt                      ← 用户遗留，未动
?? patch-probe.txt                   ← 用户遗留，未动
?? patch-probe2.txt                  ← 用户遗留，未动
```

**未对任何已跟踪文件做改动**（`git status` 无 `M` 条目）。未执行任何 commit / push。

---

## 7. M0 结论

1. **M0 退出门 5/5 通过**，四个任务全部完成，四份产物落盘并格式化通过。
2. **NR-01…NR-06 已全部回填真实命令证据**，NR-07 因无金丝雀仍 NOT_RUN，NR-08 已确认为外部依赖缺失。
3. **30 条 RQ 映射完整**，13 条追加 AC + 18 条新 AC 全部给出验证方式。
4. **M6 已判定 BLOCKED**（无合格金丝雀），但**不阻断 M1–M5**。
5. 基线真实状态：`lint` 通过、`pack` 通过、`smoke` 通过、`npm test` fail=5（全 MySQL）、`format:check` 失败（4 文件，均有归属）。
6. **未宣称任何 MVP 验证通过**；AC-MVP-10 明确记录为不成立。

**下一步**：等待用户对 D-01…D-04 裁决后，进入 **M1 状态内核收敛**。
