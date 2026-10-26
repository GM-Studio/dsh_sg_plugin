# M3 验收记录：环境能力发现与受批安装

日期：2026-10-26
里程碑：M3（覆盖 FR-03、FR-04；D07）
状态：**已通过**

## 1. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| `npm test`             | 0      | tests 942 / pass 942 / fail 0 / cancelled 0 / skipped 0 |
| `npm run lint`         | 0      | 通过                                                    |
| `npm run format:check` | 0      | 通过                                                    |
| `npm run pack:check`   | 0      | 通过                                                    |
| `npm run codex:smoke`  | 0      | 通过                                                    |

测试数由 M2 的 872 增至 942（+70 条）。

## 2. AC 逐条验收

### AC-08 兼容工具已存在时复用真实路径与版本，不重复下载安装

- 实现：`src/codex/core/env/capability.js`（`resolveTools`）。
- 断言：只有同时具备真实 `path` 与 `version`（或 `major`）才算复用；`{ exists: true }` 不算。
- 断言：`node` 任务只推导 `node`；`maven` 任务推导 `jdk`+`maven` 而**不含** `node`。

### AC-09 工具存在但不兼容时列为不兼容

- 实现：`src/codex/core/env/compatibility.js`（`assessTool`、`assessEnvironment`）。
- 三态：`compatible` / `incompatible` / `unknown`；**`unknown` 不计入可用**。
- 断言：版本不符 → `version-mismatch`；低于最低版本 → `version-below-minimum`；架构不符 → `arch-mismatch`；探测非零退出保留 stderr → `probe-failed`；无真实路径 → `no-executable-path`。
- 断言：探测超时与版本不可读均为 `unknown`，不是通过。
- 断言：空探测集返回 `environmentReady: false`（没有探测就没有通过）。

### AC-10 只读检查不下载、不安装、不修改系统或项目环境配置

- 实现：`src/codex/core/env/discovery-bounds.js`（`discoverExecutable`）。
- 断言：发现前后文件树逐字节一致。
- 断言：结果自报 `readOnly: true`、`performedWrites: false`、`performedNetwork: false`。

### AC-11 只准备当前任务需要的能力

- 断言：文档类任务（无构建系统）→ `requiredTools` 为空，且登记 `no-build-system` 缺口。
- 断言：同一工具多次请求只记一次，但保留全部请求方。
- 断言：任务未涉及的技术栈工具（node/python/rust/dotnet）一律不出现。

### AC-12 未取得对应方案授权前不发生下载安装或环境配置写入

- 实现：`src/codex/core/env/install-plan.js`（`validateInstallPlan`、`authorizeExecution`）。
- 断言：方案必须声明 9 个字段（purpose/component/version/source/verification/location/locationScope/configChanges/privilege），缺任一即 `missing`。
- 断言：无批准时 `authorizeExecution` 返回 `INSTALL_NOT_APPROVED`。

### AC-13 执行与批准的版本、来源、位置或权限不一致时，不沿用旧授权

- 批准绑定方案指纹（component/version/source/location/locationScope/privilege）。
- 断言：六种要素变更（版本/来源/位置/作用域/权限/组件）逐一导致 `INSTALL_APPROVAL_STALE`。
- 断言：`purpose` 变化**不**使批准失效（说明文字不影响技术要素）——这是有意区分，避免无关改动引发重新审批。
- 断言：已消费批准不可复用（`INSTALL_APPROVAL_CONSUMED`）。
- 断言：批量批准中任一项不合法 → 整批 `INSTALL_BATCH_REJECTED`，不给「部分批准」的模糊状态。
- 断言：系统级或提权方案 → `INSTALL_FRESH_APPROVAL_REQUIRED`。

### AC-14 安装命令成功但复验失败时，环境状态仍不能通过

- 实现：`src/codex/core/env/post-install-verify.js`（`verifyAfterInstall`、`summarizeInstallAttempt`）。
- 断言：`install.exitCode === 0` 且复验失败 → `installSucceeded: true` 但 `environmentReady: false`，`blockedReason: verification-failed`。
- 断言：安装成功但没有复验证据 → `verification-missing`，环境不通过。
- 断言：复验逐能力判定，一项通过不标记全部通过。
- 断言：安装失败保留 `completed` 已完成部分，不重置为「什么都没发生」。

### AC-15 环境通过与项目构建、测试、Review 通过分别报告

- 上述所有结果对象都显式携带 `projectBuildPassed: false`、`projectTestsPassed: false`、`reviewPassed: false`、`workflowVerification: 'not-run'`。
- 断言：环境就绪时三者仍为 false（`capability`、`compatibility`、`post-install-verify` 三处各有独立断言）。

## 3. D07 安装授权约束

| 约束                     | 实现                    | 断言                                                      |
| ------------------------ | ----------------------- | --------------------------------------------------------- |
| 按任务批量批准具体方案   | `approveBatch`          | 空批次拒绝；含非法项整批拒绝                              |
| 优先用户目录/项目隔离    | `chooseInstallLocation` | `project` 需项目根；`user` 无需提权                       |
| 系统级安装、提权另行批准 | `requiresFreshApproval` | `system` / `elevated` → `INSTALL_FRESH_APPROVAL_REQUIRED` |
| 换源必须重新申请         | 指纹含 `source`         | 来源变更 → `INSTALL_APPROVAL_STALE`                       |

## 4. 关键设计决定

### 4.1 `unknown` 永不等于 `compatible`

探测超时、版本不可读、无探测结果三种情况一律 `unknown`，且 `environmentReady` 仅在全部 `compatible` 时为真。这直接落实 NFR-05「已发现命令通过不自动代表所有验证类别都被覆盖」。

### 4.2 批准指纹的字段选择

指纹覆盖 component/version/source/location/locationScope/privilege 六个技术要素，**不含** purpose（用途说明）。理由：用途文字变化不应迫使重新审批，否则会把审批变成负担并诱发绕过。此决定有正反两条断言锁定。

### 4.3 失败策略一律收紧

七类失败原因（install-failed / timeout / verification-failed / verification-missing / checksum-failed / permission-denied / network-failed）以及未知原因，全部返回 `retryWithDifferentSource: false`、`retryWithElevation: false`、`skipVerification: false`、`requiresNewApproval: true`。

### 4.4 顺带修复的真实缺口

写 `discovery-bounds` 测试时发现 `<root>/bin/<exe>` 布局未被检查——而这正是 `JAVA_HOME`、`MAVEN_HOME`、`GRADLE_HOME` 的标准布局。已补上并验证（`java` 通过 `JAVA_HOME/bin` 可被发现）。

## 5. 新增文件

| 文件                                        | 用途                   | 断言数 |
| ------------------------------------------- | ---------------------- | ------ |
| `src/codex/core/env/capability.js`          | 能力推导与复用优先     | 11     |
| `src/codex/core/env/compatibility.js`       | 兼容性三态判定         | 15     |
| `src/codex/core/env/discovery-bounds.js`    | 有界只读发现           | 12     |
| `src/codex/core/env/install-plan.js`        | 安装方案契约与批量批准 | 16     |
| `src/codex/core/env/post-install-verify.js` | 隔离位置与安装后复验   | 13     |

## 6. 未做的事

| 项                                                    | 归属                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| 实际下载与安装执行                                    | 需 OI-04（下载源策略/离线缓存/代理）确认；本里程碑只交付契约与判定 |
| 把能力推导接入 `sg_env_check`/`sg_env_prepare` 工具面 | 需保持既有契约，留待评审决定（当前既有预设入口仍可用）             |
| Linux 平台真实发现证据                                | M4 / SNA-0402                                                      |
| 真实仓库安装端到端                                    | M8 / E2E-03、E2E-04                                                |

## 7. 未执行项（如实记录）

| 检查                 | 状态      | 说明                                                   |
| -------------------- | --------- | ------------------------------------------------------ |
| 真实下载安装         | `NOT_RUN` | OI-04 未确认；按计划 M3 回滚条款只做发现+复用+缺项报告 |
| `npm run test:mysql` | `NOT_RUN` | M3 未触及 MySQL 代码                                   |
| Linux 平台           | `NOT_RUN` | M4 范围                                                |
