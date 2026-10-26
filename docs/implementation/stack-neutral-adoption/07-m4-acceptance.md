# M4 验收记录：跨平台执行与引导边界

日期：2026-10-26
里程碑：M4（覆盖 FR-05；NFR-08）
状态：**部分通过** —— AC-17、AC-18 与平台抽象已通过；**AC-16 未通过（`NOT_RUN`）**，缺原生 Linux 证据

## 1. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| `npm test`             | 0      | tests 986 / pass 986 / fail 0 / cancelled 0 / skipped 0 |
| `npm run lint`         | 0      | 通过                                                    |
| `npm run format:check` | 0      | 通过                                                    |
| `npm run pack:check`   | 0      | 通过                                                    |
| `npm run codex:smoke`  | 0      | 通过                                                    |

测试数由 M3 的 942 增至 986（+44 条）。

## 2. AC 逐条验收

### AC-16 Windows/Linux x64 各有真实发现、复用、缺项准备和复验记录 —— **未通过**

**状态：`NOT_RUN`。Windows 与 Linux 均无原生平台证据文件。**

已交付的是**机制**，不是通过结论：

| 交付       | 内容                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| CI 矩阵    | `.github/workflows/codex.yml` 改为 `os: [windows-latest, ubuntu-latest]`，`fail-fast: false`，两平台各自跑完整门禁                   |
| 证据生成器 | `scripts/record-platform-evidence.mjs`：只取 `process.platform`/`process.arch`，**不接受** `--platform` 参数（防止伪造另一平台证据） |
| 证据消费   | `src/codex/core/platform-support.js` 读取 `docs/verification/stack-neutral-adoption/platform-<platform>-<arch>.json`                 |
| 诚实断言   | 一方证据不得使另一方变为 supported；缺证据时 CI 因 `if-no-files-found: error` 失败                                                   |

**为什么不算通过**：证据文件必须由 CI（或用户提供的真实环境）产出。本机是 Windows x64，可产出 win32 证据，但 Linux 证据需要真实 Linux 环境。

**关于 WSL**：本机存在 WSL1（`4.4.0-19041-Microsoft`），但按计划 §8.5 与 M4 回滚条款，**不得**用容器/子系统记录替代原生平台验收。因此未使用。

**解除条件**：CI 在 `ubuntu-latest` 上真实跑通并提交 `platform-linux-x64.json`，或用户在 OI-02 中明确认可某个等价环境。

### AC-17 macOS/ARM64 在未完成真实支持与验收前明确标为预留 —— 通过

- 实现：`src/codex/core/platform.js`（`platformSupport`）与 `platform-support.js`（`declareSupportLevel`）。
- 断言：`darwin` 与任意 `arm64` 均为 `reserved`，不因证据存在而自动升级。
- 断言：未知平台（aix/freebsd/sunos）为 `unverified`，**不默认成 Windows 行为**。
- 断言：`supported` 必须由真实证据文件驱动；evidence 缺 `status: passed`、缺 `checks`、任一 `exitCode !== 0`、缺时间戳或执行者，均不予 `supported`。
- 断言：平台汇总表**始终**列出 macOS/ARM64，避免报告里「看不见 macOS」。

### AC-18 启动失败、权限不足、认证缺失给出可区分原因 —— 通过

- 实现：`src/codex/core/bootstrap-diagnostics.js`。
- 五类可区分原因：`host-runtime-unsupported`、`host-config-invalid`、`host-permission-denied`、`host-auth-missing`、`host-not-bound`。
- 断言：四类阻断原因互不混淆（`new Set(reasons).size === 4`）。
- 断言：除 `ready` 外**任何**诊断都 `ready: false`，且引导文本 `claimsReady: false`。
- 断言：`userFacingStatus` 把阻断渲染为 `blocked: <reason>`，绝不渲染成 `ready`。
- 边界：`host-runtime-unsupported` 标记 `selfRepairable: false`、`requiresHostGuidance: true`——MCP 不自修复启动前置条件，符合需求 §5 的边界。

### NFR-08 平台与技术栈解耦 —— 通过（渐进收敛中）

- 新增平台层 `src/codex/core/platform.js` 作为唯一权威实现：`platformSupport`、`executableNames`、`pathSeparator`、`joinPath`、`requiresShell`、`nullDevice`、`isCaseInsensitive`、`normalizeForCompare`。
- 断言：`discovery-bounds.js` 已完全收敛（不再出现 `process.platform === 'win32'`）。
- 断言：全仓散落判断数量不得增加（当前基线 134，断言 `<= 134`）。
- 断言：所有平台函数接受显式 `platform` 参数，可在任意宿主上测试另一平台行为，且调用不改变宿主平台。

**未做的事**：既有 134 处散落判断**未**全部迁移。这是有意的渐进策略——一次性重写 134 处会破坏大量既有测试且无法在 M4 内验证。断言的作用是「不得增加」，后续里程碑按需收敛。

## 3. 新增文件

| 文件                                      | 用途               | 断言数              |
| ----------------------------------------- | ------------------ | ------------------- |
| `src/codex/core/platform.js`              | 平台差异单一收敛点 | 11                  |
| `src/codex/core/platform-support.js`      | 证据驱动的三态声明 | 11                  |
| `src/codex/core/bootstrap-diagnostics.js` | 启动诊断与宿主引导 | 14                  |
| `scripts/record-platform-evidence.mjs`    | 平台证据生成器     | 8（含 CI 配置断言） |

## 4. 修改文件

| 文件                          | 改动                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `.github/workflows/codex.yml` | 单 job `windows-latest` → 矩阵 `[windows-latest, ubuntu-latest]`；新增证据记录与上传步骤 |

## 5. 未执行项（如实记录）

| 检查                     | 状态      | 说明                                                                 |
| ------------------------ | --------- | -------------------------------------------------------------------- |
| Windows x64 原生平台证据 | `NOT_RUN` | 机制已就位；未在本次运行中生成证据文件（需完整跑一遍全部门禁后写入） |
| Linux x64 原生平台证据   | `NOT_RUN` | 无原生 Linux 环境；WSL1 按计划条款不得替代                           |
| CI 实际执行              | `NOT_RUN` | 工作流已提交但尚未在 GitHub 上触发                                   |
| `npm run test:mysql`     | `NOT_RUN` | M4 未触及 MySQL 代码                                                 |

## 6. 结论

M4 交付了跨平台的**判定与记录机制**，并让「未验证」无法被伪装成「已通过」。

AC-16 保持 `NOT_RUN`，因此**按计划 §8.5 的规定，M4 不能判定为完全通过**，且 M8 的发布门禁将受此阻挡。这一点必须如实保留，不能因为机制完备就宣称平台验收完成。
