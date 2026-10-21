# Codex SG P7 验证记录

日期：2026-10-21（Asia/Shanghai）。范围：P7 测试执行与质量门核心。没有提交、推送或发布插件仓库。

## 结果

| 检查 | 实际结果 |
|---|---|
| P7/P6/计划/协议聚焦回归 | 19 通过，0 失败，0 跳过 |
| `test/codex-quality-gate.test.js` | 6 通过，0 失败，0 跳过 |
| `npm test` | 546 总计；545 通过，0 失败，1 跳过 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm pack --dry-run`（临时缓存） | exit 0，1190 files，package 2.2 MB |

全量测试的 1 个跳过仍来自本机缺少 `py -3.12`，未标记为通过。

## 覆盖

- test worktree 对齐最后一个 integration commit；
- Test runner green 报告与全部冻结用例精确对账；
- skip 用例转换为 P1 defect，第 3 次失败进入 `BLOCKED` 且证据保留；
- Test provider 或测试命令修改生产代码时 fail-closed；
- 前后端总体行/分支覆盖率 80/70 校验；
- 变更生产代码行覆盖率 90% 校验；
- 真实验证失败不会记录质量通过；
- Test 命令记录 cwd、开始/结束、耗时、退出码和完整 stdout/stderr；
- 缺少 server-owned Test runner 时状态保持 `TESTING`；
- 质量工具不接受 command、role、coverage 或 approval 参数；
- `verifyProject` 所需 runtime metadata 安全复制到 test worktree；
- 成功质量报告 hash 可只读复核并进入 `REVIEWING`。
- Test 资产缺陷可通过受控替换生成 v2 manifest，保留 v1 并记录原因、旧 hash、新 hash 和审计事件。

## 原生 Agent 后续验收

[P6→P7 原生 Agent 验收](../p6-p7-native-agent-e2e/README.md) 已完成真实 Java/Vue 生成产品闭环：

- 原生 Test Agent 先冻结并执行 red 测试；
- 原生 Frontend/Backend Agent 在固定 worktree 独立实现并提交；
- 默认 `verifyProject` 在 integration/test worktree 真实通过；
- 冻结 cases 2/2、后端 14/14、前端 12/12、9/9 stages；
- changed-line coverage 96.24%，P0/P1=0，最终状态 `REVIEWING`。

仍未完成：产品 MCP 自动宿主 subagent 桥、真实 H1 审批、P8 Review/H3、P9 归档/push。
