# Codex P8/P9：Review、H3 与归档发布

对应需求：[Codex SG v1 v1.0](../requirements/codex-sg-change-add-v1.md) AC 17–18、22–29。本文记录 P8/P9 核心实现；真实宿主 Review 与可信 H3 仍为 `not-run`。

## 1. Review 风险选档

Review 从 freeze commit 到 integration commit 的 Git diff、质量和路径计算结构化信号：

- 认证/授权、删除/迁移、外部网络、上传、敏感数据、公共契约、低变更覆盖：高风险；
- 新依赖、跨前后端模块、超过 50 行变更：标准风险；
- 无显著信号：宽松。

任一高风险触发 strict；标准信号触发 standard；否则 lenient。用户可通过 `sg_review_run.mode` 显式覆盖。风险和推荐档位写入 Review 报告。

## 2. 只读 Review Agent

固定 review worktree 对齐精确 integration commit。服务器把 mode、risks、diff、quality、plan、contract/model 和 AC 映射交给服务器注入的 Review Agent。

Agent 前后必须满足：

- review worktree HEAD 不变、status 不变；
- main worktree status 不变；
- integration commit 不变；
- Agent 只返回结构化对象，不提交、不修改源码。

findings 每项必须有唯一 id、P0–P3、diff 文件、变更 hunk 内行号、AC 映射、可在 diff/quality 中匹配的证据和修复建议。

## 3. 三档门

| 档位 | 阻断等级 |
|---|---|
| lenient | P0/P1 |
| standard | P0/P1/P2 |
| strict | P0/P1/P2/P3 |

`verdict=pass` 不允许存在当前档位的阻断 finding；`verdict=fail` 必须至少存在一条阻断 finding。失败报告不可变保存，使用 review 分类最多重试三次，超限进入 `BLOCKED`。

## 4. H3

通过 Review 后状态进入 `H3_PENDING`。H3 artifact 是：

```text
sha256(reviewHash + archivePreviewHash)
```

归档预览包含目标分支、remote、integration commit、文件统计、测试/质量、Review、pending commits、未跟踪文件和 clean 状态。H3 原生审批签发后，服务重新读取当前 version，并复核 phase 与复合 hash，再消费审批并进入 `ARCHIVING`。Review 或 preview 变化都会令旧 H3 失效。

## 5. 归档与 push

`sg_release_archive` 只接受 `ARCHIVING`，并验证 append-only 事件链中存在已消费的 H3。运行时重新计算 preview，hash 与 H3 时不一致则拒绝。

动作顺序：

1. 检查 main/master 目标分支和 clean 状态；
2. 将精确 integration branch 以 `--no-ff` 合并；
3. 将 `.specgate/codex/changes/<change>` 复制到 `.specgate/codex/archive/<change>`，保留原审计路径；
4. 无 remote：进入 `ARCHIVED_NOT_PUSHED` 并明确“未推送”；
5. push 失败：进入 `PUSH_FAILED`，不自动重试、不回滚、不继续；
6. push 成功：进入 `ARCHIVED`。

push 命令固定为 `git push --porcelain <remote> HEAD:<target>`，代码不生成 `--force`。merge 冲突会 abort 并保留 `ARCHIVING` 现场，不自动解决。

## 6. 当前验收边界

`test/codex-review-release.test.js` 使用真实 Git worktree、本地 bare remote 和合成审批覆盖三档门、只读违规、H3 hash 失效、H3 前拒绝归档、无 remote、push failure 与成功 push。

真实 Codex Desktop Review Agent 本轮未消费 challenge；真实可信 H3 审批不可用。H1/H3 均不得用普通文本或模型参数代替。
