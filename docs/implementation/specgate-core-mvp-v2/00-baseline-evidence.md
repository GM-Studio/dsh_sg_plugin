# SpecGate Core MVP v2 · M0 基线证据报告

- 对应任务：**CORE2-0001 回填 NOT_RUN 命令证据**
- 对应需求：Delta v1.1 §7.2 NR-01…NR-06；v1.0 RQ-024 / AC-MVP-10
- 采集时间：2026-10-25（Asia/Shanghai）
- 采集方式：**真实命令执行**，非静态推断
- 环境：Windows / Node v24.14.0 / npm 11.9.0 / git 2.56.0.windows.2
- 仓库：`E:\ai_workflow\specgate`，分支 `sg-codex`

> 本报告只记录实际观察到的事实。未执行的检查一律标 `NOT_RUN`，失败项一律标为失败，不描述为通过。

---

## 1. 仓库状态（NR-06）

### 1.1 命令与输出

```text
$ git branch --show-current
sg-codex

$ git rev-parse HEAD
2df0832134e570eda4908929dc7c646fed784d53
```

```text
$ git status --porcelain
?? .codex-read-change-add.txt
?? .npm-cache/
?? docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md
?? docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan.zh.md
?? docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.delta-v1.1.zh.md
?? docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md
?? node-out.txt
?? patch-probe.txt
?? patch-probe2.txt
```

**退出码：0。未跟踪条目：9。**

### 1.2 判定：工作区**不干净**

按 v1.0 RQ-001 / AC-001-03，创建 Change 前要求工作区干净。当前状态**不满足**该前提，因此**不能在本仓库上直接跑金丝雀交付**（这也与 CORE2-0003 的要求一致：金丝雀必须是独立的真实业务项目）。

### 1.3 未跟踪文件分类登记

本次实施**不得**清理、提交或修改以下任何一项。

| #   | 条目                         | 分类                         | 归属     | 说明                                     |
| --- | ---------------------------- | ---------------------------- | -------- | ---------------------------------------- |
| U1  | `.codex-read-change-add.txt` | 空文件（0 字节，2026-10-23） | 用户遗留 | 非本计划产物                             |
| U2  | `node-out.txt`               | 空文件（0 字节，2026-10-23） | 用户遗留 | 非本计划产物                             |
| U3  | `patch-probe.txt`            | 277 字节（2026-10-23）       | 用户遗留 | 非本计划产物                             |
| U4  | `patch-probe2.txt`           | 276 字节（2026-10-23）       | 用户遗留 | 非本计划产物                             |
| U5  | `.npm-cache/`                | 33 MB 目录                   | 构建缓存 | 不参与发行、不提交                       |
| U6  | 需求 v1.0 `.zh.md`           | 需求正文                     | 冻结产物 | `1.0-frozen`，不得修改                   |
| U7  | 需求 delta-v1.1 `.zh.md`     | 需求正文                     | 冻结产物 | `v1.1-delta-frozen`，不得修改            |
| U8  | 旧计划 `...-plan.zh.md`      | 旧计划                       | 历史记录 | `v1.0-candidate`，已被取代，不执行不删除 |
| U9  | 新计划 `...-plan-v2.zh.md`   | 新计划                       | 已批准   | `v2.0-approved`                          |

另有 `.runtime/` 既有验收产物目录（已跟踪/被忽略，非本次产生）。

---

## 2. 质量命令（NR-01…NR-05）

| 编号  | 命令                   | 退出码 | 结果                                                    |
| ----- | ---------------------- | ------ | ------------------------------------------------------- |
| NR-02 | `npm run lint`         | **0**  | 通过，无告警                                            |
| NR-03 | `npm run format:check` | **1**  | **失败**，4 个文件（§2.2）                              |
| NR-04 | `npm run pack:check`   | **0**  | 通过，569 文件 / 1.3 MB                                 |
| NR-05 | `npm run codex:smoke`  | **0**  | 通过，MCP handshake 成功                                |
| NR-01 | `npm test`             | **1**  | **失败**：710 tests / 704 pass / **6 fail** / 0 skipped |

### 2.1 lint（NR-02）—— 通过

```text
$ npm run lint
> specgate-codex@0.3.4 lint
> eslint .

退出码：0
```

### 2.2 format:check（NR-03）—— 失败

```text
$ npm run format:check
> prettier --check .

Checking formatting...
[warn] docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md
[warn] docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.delta-v1.1.zh.md
[warn] test/codex-control-auth-mysql.test.js
[warn] test/codex-control-worker-mysql.test.js
[warn] Code style issues found in 4 files. Run Prettier with --write to fix.

退出码：1
```

**4 个文件的来源已逐个查明：**

| 文件                                      | 归属         | 性质                | 处置                         |
| ----------------------------------------- | ------------ | ------------------- | ---------------------------- |
| `test/codex-control-auth-mysql.test.js`   | **预先存在** | 已跟踪、git 未修改  | 既有基线缺陷，非本计划引入   |
| `test/codex-control-worker-mysql.test.js` | **预先存在** | 已跟踪、git 未修改  | 同上                         |
| `docs/requirements/...delta-v1.1.zh.md`   | 本计划引入   | Markdown 表格列对齐 | **已冻结，不得修改**（§2.3） |
| `docs/plans/...plan-v2.zh.md`             | 本计划引入   | Markdown 表格列对齐 | **已批准，修正须走 §17.3**   |

**验证依据**：`git status --porcelain` 对两个 test 文件无输出，且 `git ls-files` 确认其已跟踪 → 格式问题在本次工作前即存在。两份既有 Markdown（v1.0 需求、旧计划）经 `npx prettier --check` 验证均为 **通过**，说明 `docs/**/*.md` 本应满足格式要求。

### 2.3 format:check 与冻结/批准的冲突（需决策）

两份新文档的 prettier 差异**仅为 Markdown 表格的列宽对齐**（纯空白字符），零语义变化。但：

- Delta v1.1 已冻结，其**冻结锚定 SHA-256** 为 `9F88C906D238522B1C05B144E1C0F2E59A54B2324E4BC49890484E600227CE9B`，复核方式明确为「移除冻结记录节后重算」；
- 计划 v2.0 已批准，其**批准锚定 SHA-256** 为 `428F96052A06C9F940CF1E022B4267E0E3C347F11A33C2ECD40F2B46CB84640D`，复核方式相同。

**若为通过 format:check 而重排表格，将使上述两个已记录的锚点哈希失效**，等同于篡改已批准/已冻结文档的字节内容，违反两份文档各自的变更规则。

**因此本报告不自行修改这两份文档**，将冲突如实登记，交由用户在 M0 退门时裁决（§6 D-01）。

### 2.4 pack:check（NR-04）—— 通过

```text
$ npm_config_cache=/tmp/specgate-npm-cache npm run pack:check

Tarball Details
name: specgate-codex
version: 0.3.4
package size: 1.3 MB
unpacked size: 5.0 MB
total files: 569
bundled deps: 10

Bundled Dependencies
is-property, aws-ssl-profiles, generate-function, iconv-lite, long,
lru.min, mysql2, named-placeholders, safer-buffer, sql-escaper

退出码：0
```

**GAP-15 获得命令级确认**：发行包 `Bundled Dependencies` 明确包含 `mysql2`，与 Delta v1.1 §2 GAP-15、AC-021-06 一致。该条为 M5 / CORE2-0503 的处置对象。

### 2.5 codex:smoke（NR-05）—— 通过

```text
$ npm run codex:smoke

退出码：0
projectStatus.ok = true
projectStatus.code = PROJECT_NOT_BOUND
projectStatus.nextTool = sg_project_bind
workflow.ok = true
transport = stdio
```

**GAP-14 获得命令级确认**。smoke 输出的默认工具清单中实际含有：

```text
"sg_work_item_create",
"sg_work_item_status",
"sg_work_item_wait"
```

与 Delta v1.1 §2 GAP-14（`CONTROL_TOOLS` 无条件并入默认 definitions）完全一致。该条为 M5 / CORE2-0501 的处置对象。

### 2.6 npm test（NR-01）—— 失败，6 项

```text
$ npm test

ℹ tests 710
ℹ suites 0
ℹ pass 704
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

退出码：1
```

**0 skipped** 这一点很重要：它满足 v1.0 AC-024-01 对「不得用环境缺失作为核心测试跳过理由」的要求 —— 本仓库没有用 skip 掩盖失败，而是让失败直接暴露。

#### 6 项失败逐条归因

| #   | 失败测试                                                           | 文件                                               | 原因                                 | 分类               |
| --- | ------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------ | ------------------ |
| F1  | real MySQL M2 auth hardening and concurrency                       | `test/codex-control-auth-mysql.test.js:100`        | `ECONNREFUSED 127.0.0.1:34367`       | 外部依赖缺失       |
| F2  | configured MySQL auth runtime migrates, provisions and logs in     | `test/codex-control-auth-runtime.test.js:20`       | `ECONNREFUSED 127.0.0.1:34367`       | 外部依赖缺失       |
| F3  | real MySQL M1 migration, concurrency, audit, retention and restore | `test/codex-control-persistence-mysql.test.js:109` | `ECONNREFUSED 127.0.0.1:34367`       | 外部依赖缺失       |
| F4  | real MySQL M3 worker identity, outbox, replay and audit            | `test/codex-control-worker-mysql.test.js:114`      | `ECONNREFUSED 127.0.0.1:34367`       | 外部依赖缺失       |
| F5  | configured Worker runtime persists registry and rotation in MySQL  | `test/codex-control-worker-runtime.test.js:39`     | `ECONNREFUSED 127.0.0.1:34367`       | 外部依赖缺失       |
| F6  | 见 §2.6.2                                                          | 随机（两次不同）                                   | `TypeError: fetch failed — bad port` | **并发端口 flake** |

#### 2.6.1 F1–F5：MySQL 外部依赖缺失（NR-08 已随之取证）

5 项全部指向同一根因：本机 `127.0.0.1:34367` 无 MySQL 实例监听。这 5 个测试文件 import `test/mysql-test-config.mjs`，缺配置时应抛 `MYSQL_TEST_CONFIG_REQUIRED`；当前是连接被拒，说明配置存在但实例未启动。

**这正是 v1.0 AC-023-03 / AC-024-01 与 Delta AC-021-06 要解决的问题**：核心测试不应依赖外部 MySQL。当前 `npm test` 单命令混跑核心与可选测试，导致核心测试无法独立全绿。该条为 M5 / CORE2-0504 的处置对象。

#### 2.6.2 F6：并发端口 flake（**新发现的真实缺陷**）

两次连续全量运行的失败集合**不同**：

| 运行    | 第 6 项失败测试                                                            | 文件                                       |
| ------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| 第 1 次 | device listing and revocation use an authenticated session and bound proof | `test/codex-management-auth.test.js:246`   |
| 第 2 次 | worker API uses independent bearer auth without cookies or CSRF            | `test/codex-management-worker.test.js:237` |

**两者单独运行均通过**：

```text
$ node --import ./test/setup-temp.mjs --test test/codex-management-auth.test.js
ℹ tests 4  ℹ pass 4  ℹ fail 0   退出码：0

$ node --import ./test/setup-temp.mjs --test test/codex-management-worker.test.js
ℹ tests 5  ℹ pass 5  ℹ fail 0   退出码：0
```

**根因已定位并实证：**

1. `createManagementServer` 默认 `port = 0`（`src/codex/management/server.js:335`），由操作系统随机分配端口；
2. `start()` 用 `http://<address>:<port>` 构造 baseUrl（`server.js:1441`）；
3. Node 内置 `fetch`（undici）**拒绝一批 bad port**，实测确认：

```text
6000  -> fetch THREW: bad port
6665  -> fetch THREW: bad port
10080 -> fetch THREW: bad port
```

4. 本机 Windows 动态端口范围：

```text
$ netsh int ipv4 show dynamicport tcp
起始端口: 1024
端口数:   13977      → 范围 1024–15000
```

5. 该范围内含 undici 黑名单端口（6000、6566、6665–6669、6697 等）。实测采样：

```text
$ node port-sample.mjs      # 2000 次 listen(0) 采样
sampled=2000 badHits=8 examples=6000,6566,6665,6666,6667,6668,6669,6697
```

即**约 0.4% 的随机分配会落入黑名单**。单次全量运行启动约 30–40 个管理服务实例，命中概率约 10–20%，与「两次运行各挂 1 项、且每次不同」的观察完全吻合。

**影响判定**：

- 这不是测试写错，而是 **`server.js` 的端口分配与 URL 构造缺少对保留端口的规避**；
- 它直接影响 v1.0 **RQ-024 AC-024-01「0 failed」** 与 **AC-MVP-10**，使核心测试无法稳定全绿；
- 它**未被** v1.0 或 Delta v1.1 任何条款覆盖 —— 属本次基线取证新发现。

**处置建议**：新增验收条款（建议编号 AC-024-05），要求「服务端分配随机端口后必须校验该端口可被标准 HTTP 客户端使用，不可用时重新分配」。此项需用户裁决后纳入，**本报告不擅自修改已冻结需求**（§6 D-02）。

---

## 3. 与 Delta v1.1 §7.2 NOT_RUN 清单的对照

| 编号  | 检查项                 | 原状态  | 本次结果                                   |
| ----- | ---------------------- | ------- | ------------------------------------------ |
| NR-01 | `npm test`             | NOT_RUN | **已执行 → 失败**（710/704/6）             |
| NR-02 | `npm run lint`         | NOT_RUN | **已执行 → 通过**（exit 0）                |
| NR-03 | `npm run format:check` | NOT_RUN | **已执行 → 失败**（4 文件）                |
| NR-04 | `npm run pack:check`   | NOT_RUN | **已执行 → 通过**（569 文件）              |
| NR-05 | `npm run codex:smoke`  | NOT_RUN | **已执行 → 通过**                          |
| NR-06 | git 状态 / 分支 / HEAD | NOT_RUN | **已执行 → 工作区不干净（9 项）**          |
| NR-07 | 真实金丝雀完整闭环     | NOT_RUN | **仍 NOT_RUN**（见 CORE2-0003）            |
| NR-08 | MySQL 测试组可运行性   | NOT_RUN | **已执行 → 确认不可用**（5× ECONNREFUSED） |

**回填完成度：6 / 8 已取得真实证据；NR-07 依赖金丝雀项目，NR-08 已确认不可用。**

---

## 4. 命令级确认的差距（补给 Delta v1.1 §2）

以下 GAP 此前仅有静态代码证据，现获得真实命令输出作为第二证据源：

| GAP                                  | 静态证据                | 本次命令证据                                               |
| ------------------------------------ | ----------------------- | ---------------------------------------------------------- |
| GAP-14 默认工具面含 `sg_work_item_*` | `workflow-tools.js:608` | `npm run codex:smoke` 输出实际列出 3 个 `sg_work_item_*`   |
| GAP-15 发行包强制带 `mysql2`         | `package.json:81-86`    | `npm run pack:check` 的 Bundled Dependencies 列出 `mysql2` |
| RQ-024 核心发行质量                  | 无                      | `npm test` fail=6 → **AC-024-01 当前不成立**               |

---

## 5. CORE2-0001 完成条件自检

| 完成条件                                    | 状态                                  |
| ------------------------------------------- | ------------------------------------- |
| NR-01 至 NR-06 每条都有真实退出码，无一留空 | ✅ 6/6                                |
| 失败项如实记录为失败，未描述为通过          | ✅ format:check 与 npm test 均标失败  |
| 未修改或提交任何用户文件                    | ✅ 仅新增本报告；9 项未跟踪文件零改动 |

---

## 6. 待用户决策项

### D-01：format:check 与已冻结/已批准文档的冲突

- **A（推荐）**：保持文档字节不变，记录该冲突；M5 / CORE2-0504 拆分流水线时，把 `docs/**/*.md` 格式检查与冻结文档白名单一并处理。
- **B**：对两份文档执行 `prettier --write`（纯空白变更），同时重算并更新各自锚点哈希，并在文内注明「格式重排，语义无变化」。
- **C**：把 `docs/**/*.md` 移出 prettier 检查范围（修改 `.prettierignore`）。

### D-02：并发端口 flake 是否纳入需求

- **A（推荐）**：新增 AC-024-05「随机端口分配须规避标准 HTTP 客户端的保留端口」，归入 M5（CORE2-0504）。
- **B**：登记为已知缺陷，不纳入本版需求，测试侧加规避。
- **C**：不处理，M6 验收时以重跑方式容忍。

### D-03：两个预先存在的 test 文件格式失败

- **A（推荐）**：随 M5 / CORE2-0504 的测试分流一并修正（属可选测试组）。
- **B**：立即修正（纯格式，风险低，但会新增两个已跟踪文件改动）。

---

## 7. 结论

1. **CORE2-0001 的三条完成条件全部达成**，NR-01…NR-06 已取得真实命令证据，无一伪造、无一留空。
2. 基线现状：**lint / pack / smoke 通过；format:check 与 npm test 失败**。
3. 失败已逐条归因：5 项为 MySQL 外部依赖缺失（对应 Delta AC-021-06 / AC-023-03 的整改目标），1 项为**新发现的真实端口 flake**。
4. **v1.0 AC-024-01 与 AC-MVP-10 当前不成立**，本报告如实记录，不据此宣称任何 MVP 验证通过。
5. 有 3 项决策需用户裁决（D-01/02/03），其中 **D-02 涉及是否扩充冻结需求**。
