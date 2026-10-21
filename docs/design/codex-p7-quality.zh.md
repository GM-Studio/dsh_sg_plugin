# Codex P7：测试执行与质量门

对应需求：[Codex SG v1 v1.0](../requirements/codex-sg-change-add-v1.md)；阶段基线：[v0.1 计划](../plans/codex-sg-change-add-v1.md) P7。本文记录 P7 核心实现，不表示 P8/P9 或真实产品 E2E 已完成。

## 1. 输入与边界

`sg_quality_run({ expectedVersion })` 只在 `TESTING` 阶段运行。公共参数不能提供命令、角色、测试统计、覆盖率、缺陷级别或 verifier。Test runner 由 `createToolRegistry` 的服务器依赖注入；默认真实验证器为 P3 的 `verifyProject`。

服务读取 P6 已登记的 integration/test worktree：

1. 重新读取 integration HEAD，并要求与最后一次已记录 merge commit 一致；
2. 将固定 test worktree 对齐到该精确 commit；
3. 如 worktree 尚未对齐且存在改动，拒绝执行；
4. 复核冻结 requirements/plan/contract/model/tests hash；
5. 在测试完成后复核 test worktree 只包含测试或 `.specgate/` 变化。

Git baseline 不提交 `.specgate/state.json` 和 `init-report.json`，因此质量服务会在 test worktree 中从主项目安全复制这两个运行元数据，再调用真实 `verifyProject`。复制目标只允许普通文件和目录，不跟随 symlink/hardlink。

## 2. 冻结测试

Test runner 返回绝对 executable、参数、worktree 内 cwd、受限环境变量和 JSON 报告路径。报告路径必须位于 `.specgate/` 或测试目录，不能伪装成生产报告。

服务自行启动子进程并记录：

- 命令、参数、相对 cwd、开始/结束、退出码、超时/取消；
- stdout、stderr、test summary；
- 用例 id、pass/fail/skip 和文件；
- 所有证据的相对路径。

green 报告必须与冻结用例集合完全一致：无缺失、重复、未知 id、fail 或 skip。执行前后任何生产代码变化都返回 `TEST_ROLE_POLICY_VIOLATION`，不启动验证。

## 3. 真实验证

默认调用 `verifyProject({ root: testWorktree })`，要求：

- `status = verified`、`ok = true`、`v1Complete = true`；
- `backend-verify`、`frontend-install`、构建、测试、lint、格式、coverage、后端 runtime、frontend-runtime 全部各执行一次；
- 无 fixture 证据、无 not-run、无 failed；
- 前后端测试总数大于 0，且 passed = total、failed = 0、skipped = 0；
- 前端进程启动、HTTP 资源和终止证据由 `verifyProject` 继续校验。

任一阶段失败或未执行都不会记录质量通过。

## 4. 覆盖率

总体覆盖率使用 `reconcileCoverage`，前后端分别要求：

- 行覆盖率 ≥ 80%；
- 分支覆盖率 ≥ 70%；
- 报告必须由本次执行新生成，缺失或 stale 即失败。

变更代码覆盖率相对 P6 freeze commit 计算：

- Java 使用 `backend/target/site/jacoco/jacoco.xml` 中变更行对应的 `ci/mi`；
- Vue/TS 使用 `frontend/coverage/coverage-final.json` 中变更行覆盖的 statement；
- 测试文件不进入生产变更覆盖率；
- 任一变更生产文件缺少可执行覆盖证据或合计覆盖率 < 90% 都阻断。

不得用总体覆盖率替代 changed-line 覆盖率。

## 5. 缺陷、重试与状态

失败统一转换为结构化 defects；测试失败、skip、verification 或 coverage 缺口记为 P1，要求 P0/P1 = 0。每次失败写入独立质量证据，然后使用状态机 `test` 分类计数：

- 第 1、2 次失败保持 `TESTING`，返回 `retryAllowed=true`；
- 第 3 次失败进入 `BLOCKED`；
- 成功写入 hash-bound report 后进入 `REVIEWING`。

每次失败保留 test worktree、integration commit、日志和报告；不执行硬重置或删除。

## 6. 当前边界

`test/codex-quality-gate.test.js` 使用实际子进程执行冻结测试，并用注入 verifier 生成受控覆盖文件，覆盖 green/skip、生产越界、总体覆盖率、changed-line 覆盖率和重试阻塞。

P3 已有四档 Windows 真实 `verifyProject` 证据，但尚未用真实前端/后端 Agent 完成一次 P6 → P7 完整生成产品闭环。Codex Desktop 的原生 Test subagent 或等价服务器角色桥仍是真实宿主验收缺口；P8 Review/H3 与 P9 归档/push 尚未实施。
