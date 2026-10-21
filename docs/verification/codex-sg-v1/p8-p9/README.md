# Codex SG P8/P9 验证记录

日期：2026-10-21（Asia/Shanghai）。范围：Review 三档、H3 绑定、归档与 push 核心。

## 结果

| 检查 | 实际结果 |
|---|---|
| P8/P9 聚焦回归 | 7 通过，0 失败 |
| P7/P8/P9/协议组合回归 | 26 通过，0 失败 |
| `npm test` | 553 总计；552 通过，0 失败，1 跳过 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm pack --dry-run`（临时缓存） | exit 0，1196 files |

跳过项仍是本机缺少 `py -3.12`，不计为通过。

## 覆盖

- 公共契约自动触发 strict；
- lenient/standard/strict 对 P2/P3 的阻断差异；
- Review Agent 写文件、改 main/review/integration 时 fail-closed；
- findings 文件、行号、AC、证据与建议校验；
- Review 失败报告保留与 review 重试；
- H3 复合 artifact、审批审计造成的 CAS 版本推进；
- Review/preview 变化令 H3 失效；
- H3 前归档拒绝；
- 无 remote 进入 `ARCHIVED_NOT_PUSHED` 并返回“未推送”；
- push 失败进入 `PUSH_FAILED`，不自动重试或回滚；
- 配置 remote 时成功 push 到本地 bare repository；
- push 命令中不存在 `--force`；
- archive 保留原 change 审计副本。

## 未验证

- 真实 Codex Desktop Review Agent 消费 challenge 并产出报告；
- 真实可信 H3 用户审批；
- 真实远端服务上的 H3 后 push；
- 完整 `sg-init → ... → H3 → remote push` 原生 E2E。

这些项目不能由合成审批、模型文本或本地 bare remote 替代。
