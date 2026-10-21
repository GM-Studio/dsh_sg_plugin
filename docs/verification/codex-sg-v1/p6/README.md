# Codex SG P6 验证记录

日期：2026-10-21（Asia/Shanghai）。范围：P5 冻结链收口和 P6 固定 worktree/parallel development 核心。没有提交、推送或发布插件仓库。

## 结果

| 检查 | 实际结果 | 证据类型 |
|---|---|---|
| P5/P6/P6 工具聚焦回归 | 17 通过，0 失败，0 跳过 | `test/codex-plan-core.test.js`、`test/codex-development-flow.test.js`、`test/codex-tools-workflow.test.js` |
| `npm test` | 538 总计；537 通过，0 失败，1 跳过 | 本机既有 Python 3.12 环境缺失导致 1 个 skip |
| `npm run lint` | exit 0 | ESLint 全仓库 |
| `npm run format:check` | exit 0 | Prettier 全仓库 |
| `npm pack --dry-run` | exit 0，1160 files，package 2.1 MB | 临时可写 npm cache |

默认 npm cache 的一次 `npm pack --dry-run` 因 `C:\Users\Administrator\AppData\Local\npm-cache` 返回 `EPERM` 失败。使用随机临时 cache 重跑通过；没有修改用户 cache 权限。

## 实际覆盖

- 真实失败基线：子进程非零退出、日志、JSON 用例报告和所有冻结用例失败映射；
- 失败基线为 exit 0 时零 worktree、零状态推进；
- frontend/backend 确实通过并发 Promise 同时运行，最大并发 2；
- 五个 worktree 与五个分支均从同一 freeze commit 创建；
- 前端跨改后端文件连续失败 3 次后进入 `BLOCKED`，越界 commit 与 worktree 保留；
- test/review worktree 在开发/集成后仍停留在 freeze commit；
- integration 只接受已验证 exact commit，并经 `--no-ff` 合并；
- 冲突路径返回 owning role，解决后重新验证并继续合并；
- 契约、模型和测试 hash 在开发前后复核；
- MCP schema 不接受 role、command、provider、commit 或 approval 参数。

## 原生 Agent 后续验收

[P6→P7 原生 Agent 验收](../p6-p7-native-agent-e2e/README.md) 已使用真实 Codex 原生 Frontend 与 Backend subagent 在固定 worktree 独立提交，并由 P6 服务重新验证 commit、路径和 freeze 关系后合入 integration。

仍未完成的是产品 MCP 自动拉取宿主 subagent 的服务器侧桥；本次由验收编排调用原生 Agent，再通过服务器注入的 precompleted role provider 接收结果。P8 Review/H3 与 P9 归档/push 仍未验证。
