# Codex P5/P6：计划冻结、失败基线与并行开发

对应需求：[Codex SG v1 v1.0](../requirements/codex-sg-change-add-v1.md)；实施基线：[v0.1 计划](../plans/codex-sg-change-add-v1.md)。本文记录 P5 收口和 P6 核心实现，不表示 P7–P9 已完成。

## 1. P5 冻结链

P5 从已消费的 H1 审批和不可变需求快照生成动态任务图。每个 AC 对应测试任务、后端任务和前端任务；接口契约与数据模型任务先于所有开发任务。Plan、契约、模型、测试清单、可执行测试和夹具都绑定 SHA-256 hash，读取时重新计算。

Test 资产只能由服务器注入的 Test 角色提供器生成。公共工具不能传入 `role: test`、布尔红标志、测试结论或任意测试代码。测试资产冻结后进入 `TEST_CASES_FROZEN`。

## 2. 真实失败基线

`sg_development_prepare` 只接受非负 `expectedVersion`。服务器内部向 Test 提供器请求一条运行命令，然后自行启动子进程并捕获：

- 可执行文件、参数、cwd、开始和结束、退出码；
- stdout、stderr，按大小上限截断并脱敏常见凭据字段；
- JSON 用例报告；
- 每个冻结用例的 `pass` / `fail` / `skip` 状态；
- 证据路径和内容 hash。

推进条件为：进程非零退出、报告可解析、冻结用例无遗漏/重复/未知 id，且每个用例都实际观察到失败。进程成功、报告缺失、部分跳过、只有布尔失败标志或模型自报失败均被拒绝。失败不会创建 worktree，也不会推进状态。

## 3. 五个固定 worktree

失败证据通过后，服务创建一次不改变主工作树和 index 的 freeze commit，树与当前 `HEAD` 相同，父提交为当前 `HEAD`，commit message 绑定需求、契约、模型、测试和失败证据 hash。随后从同一 commit 创建：

| 角色 | 路径 | 分支 |
|---|---|---|
| frontend | `.specgate/codex/worktrees/<change>/frontend` | `sg/codex/<change>/frontend` |
| backend | `.specgate/codex/worktrees/<change>/backend` | `sg/codex/<change>/backend` |
| integration | `.specgate/codex/worktrees/<change>/integration` | `sg/codex/<change>/integration` |
| test | `.specgate/codex/worktrees/<change>/test` | `sg/codex/<change>/test` |
| review | `.specgate/codex/worktrees/<change>/review` | `sg/codex/<change>/review` |

路径、分支、freeze commit、角色提交、轮次、合并和冲突记录写入权威状态上下文。任何取消都不删除 worktree、分支、日志或证据。

## 4. 并行与边界

前端和后端使用 `Promise.all` 并发执行，最大并发数为 2。角色提供器是服务器注入的内部能力，公共工具参数不包含角色身份、命令、commit、测试结论或 approval。

角色完成后，服务不信任返回值中的 commit：

1. 重新读取角色 worktree 的 branch 和 `HEAD`；
2. 要求工作树无未提交或未跟踪变化；
3. 要求相对 freeze commit 至少有一个提交后的变化；
4. 默认要求前端只改 `frontend/`，后端只改 `backend/`；
5. 禁止测试目录、测试文件、`.specgate/` 以及冻结资产变化；
6. 重新验证契约、模型、测试和夹具 hash。

失败、越界或无提交均计入统一的重试上限，总共最多 3 次尝试；超过后进入 `BLOCKED`，分支与现场保留。

## 5. integration

两个角色都完成后，状态进入 `INTEGRATING`。主服务按固定顺序读取已验证的精确 commit，逐个执行 `merge --no-ff`。开发角色不直接修改 integration。

冲突时主服务收集冲突路径、写独立证据并 abort 当前合并，再由 owning role 在其 worktree 中合并 integration 并提交解决结果。之后重新验证提交和路径边界，再重试合并。冲突和解决失败共享 2 次自动重试上限，超限进入 `BLOCKED`，不自动强推、重置或删除现场。

两个角色合入后进入 `TESTING`。该状态只表示测试阶段已开始，不表示测试通过。

## 6. 当前边界

`createDevelopmentService` 接受 `redRunner`、`roleProvider` 和内部 `rolePolicy` 注入。测试使用真实临时 Git 仓库、真实子进程及脚本化角色提供器，验证 worktree、并行、边界、合并和冲突。

Codex Desktop 的原生 subagent 启动、生命周期、状态回报和 MCP 服务器侧桥尚未完成。默认 `createToolRegistry` 没有这些提供器时，相关工具 fail-closed，不会把普通文本或客户端参数当成角色执行或用户确认。该缺口是 P7 开始前的宿主接入阻塞点。
