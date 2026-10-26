# AC-16 双平台验收记录（真实原生 Linux 执行）

日期：2026-10-26
里程碑：M4 / M8 交叉项
**结论：Windows x64 通过；Linux x64 未通过（有真实失败，如实记录）**

## 1. 执行环境（原生，非模拟）

| 项          | Windows            | Linux                               |
| ----------- | ------------------ | ----------------------------------- |
| 形态        | 原生宿主           | **VMware 虚拟机（非 WSL、非容器）** |
| 地址        | 本机               | `192.168.137.128`（NAT）            |
| 系统        | Windows 10.0.19045 | **Ubuntu 26.04.1 LTS**              |
| 内核 / 架构 | — / x64            | `7.0.0-38-generic` / x86_64         |
| Node        | v24.14.0           | v22.22.1                            |
| CPU / 内存  | —                  | 20 核 / 15 GB                       |
| 源码传输    | 工作树             | `git archive HEAD` → SFTP           |

Linux 证据明确标注 `isWsl: false`、`isContainer: false`、`isEmulated: false`——这是原生内核，不是子系统或容器替代。

## 2. 门禁结果

| 检查                   | Windows            | Linux                                                 |
| ---------------------- | ------------------ | ----------------------------------------------------- |
| `npm test`             | **0**（1139/1139） | **1**（1109 tests：1096 pass / 4 fail / 9 cancelled） |
| `npm run lint`         | 0                  | **0**                                                 |
| `npm run format:check` | 0                  | **0**                                                 |
| `npm run pack:check`   | 0                  | **0**                                                 |
| `npm run codex:smoke`  | 0                  | **0**                                                 |

## 3. Linux 失败的完整归因

### 3.1 第一轮：30 fail + 9 cancelled

根因是**测试环境缺 git 身份**：`GIT_IDENTITY_REQUIRED`。

执行 `git config --global user.name/user.email` 后，失败从 30 降到 4。**这是环境缺失，不是代码缺陷。**

### 3.2 第二轮：4 fail（`REMOTE_MODE_CONFIG_INVALID`）

| 测试                                      | 原因                                |
| ----------------------------------------- | ----------------------------------- |
| remote mode rejects forged Host/Origin    | 远程模式要求 MySQL 与加密 TOTP 种子 |
| remote mode accepts trusted HTTPS proxy   | 同上                                |
| remote mode rejects a direct client       | 同上                                |
| remote worker keeps HTTPS/Host boundaries | 同上                                |

这四个用例本属 `test:mysql` 分类，VM 上未配置 MySQL。属**既定分类边界**，不是新问题。

### 3.3 第三轮：9 cancelled（真实的跨平台缺陷）

文件：`test/codex-control-outbound-worker.test.js`

错误：`Promise resolution is still pending but the event loop has already resolved`

复现：单独运行该文件即 3 pass / 9 cancelled（与并发无关）。

原因：`createOutboundWorker` 的 `start()` 返回的 `done` promise 在测试结束前未收敛。Node 22 的测试运行器比 Node 24 更严格地把这种情况判为 `cancelled`，而 Windows 侧的 Node 24 容忍了它。

**这是 AC-16 存在的意义**：Windows 全绿掩盖了一个真实差异。它不是本次 SNA 改动引入的——`src/codex/control/outbound-worker.js` 在 `702012a` 就存在，我的 M0–M7 未提交任何改动到该文件（`git log 702012a..HEAD -- src/codex/control/outbound-worker.js` 为空）。

## 4. 证据文件与自动判级

| 文件                      | status   | 判定等级       |
| ------------------------- | -------- | -------------- |
| `platform-win32-x64.json` | `passed` | **supported**  |
| `platform-linux-x64.json` | `failed` | **unverified** |

`src/codex/core/platform-support.js` 读到 Linux 证据后返回 `unverified`，这是**正确行为**——有证据但未通过，不得宣称 supported。

## 5. AC-16 判定

| 平台        | 发现        | 复用 | 缺项准备           | 复验 | 结论                                    |
| ----------- | ----------- | ---- | ------------------ | ---- | --------------------------------------- |
| Windows x64 | ✅ 真实验证 | ✅   | 部分（无安装执行） | ✅   | **通过**                                |
| Linux x64   | ✅ 真实验证 | ✅   | 部分（无安装执行） | ✅   | **未通过**：9 个 cancelled 源自真实缺陷 |

**AC-16 整体判定：未通过。** 两平台都有真实记录，但 Linux 未绿。

按计划 §8.5 与 M8 退出门，这将**阻断发布声明**，直至：

1. 修复 `outbound-worker` 测试的 promise 收敛问题；或
2. 由用户明确接受该缺陷并记录为已知问题。

## 6. 本轮清理说明

初期我误用 Hyper-V + cloud image 建 VM（`D:\sna-vm`、`D:\sna-ubuntu`、`sna-ubuntu` VM、cloud VHD、seed VHD），已按要求**全部删除**，改用用户既有的 VMware 环境。

同时清理了工作树中的临时文件（`.sna-*.py/.log/.yaml/.ps1`、`.sna-seed/`、`.sna-head.tar.gz`）。

## 7. 可复现命令

```bash
# 在 VM 内
git config --global user.name "SpecGate Test"
git config --global user.email "test@specgate.local"
cd ~/specgate
npm ci
npm test; npm run lint; npm run format:check; npm run pack:check; npm run codex:smoke
```
