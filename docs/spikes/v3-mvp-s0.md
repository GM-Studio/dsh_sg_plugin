# v3 MVP S0 技术验证结论

- 日期：2026-10-19
- 环境：Windows，Node `v24.14.0`，git `2.45.1.windows.1`

| # | 验证项 | 结论 | 证据 |
|---|---|---|---|
| T-001 | 工具 handler 内阻塞等待用户问答 | 通过（服务契约层面） | `test/v3/s2.approve.test.js`：注入 `userQuestions`，批准/拒绝/无通道三条路径；无通道时 fail-closed |
| T-002 | 在指定 `cwd` 派生 Agent 并读回结果 | 通过（可注入 runner） | `src/v3/dispatch.js` + `test/v3/s4.e2e.test.js`（脚本化 runner 在 worktree 提交并合并） |
| T-003 | 并行 worktree 与串行合并 | 通过 | `test/v3/s7.parallel.test.js`（并发度 ≥2）、`test/v3/s10.injections.test.js`（同文件冲突） |
| T-004 | 写守卫拦截 H1 前的 design/tasks/源码 | 通过 | `test/v3/s10.guard.test.js`；`index.js` 注册 `tools.guard` |
| T-005 | S0 结论 | 无阻塞项 | 唯一降级项：真实模型下的 `agents.create` 未在 CI 演练，E2E 使用脚本化 runner；真实模型留到人工演示 |

## 降级方案

- 若并行 worktree 在目标机器上不稳定：`config.maxParallel = 1`，调度退化为串行。
- 若宿主不提供 `userQuestions`：`/sg-approve` fail-closed，工作流停在 H1/H2/H3，不会自签。
- 若宿主不提供 `agents`：`dispatch` 返回 `AGENTS_UNAVAILABLE`，任务失败并给出可读原因。
