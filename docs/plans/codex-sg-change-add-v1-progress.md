# Codex 原生 SG 工作流 v1 实施记录

日期：2026-10-21（Asia/Shanghai）。

需求基线：[v1.0](../requirements/codex-sg-change-add-v1.md)。实施基线：[v0.1 计划](codex-sg-change-add-v1.md)。用户在对话中要求开始实施，并指定创建 `sg-codex` 分支；已从 `sg-java` 创建并切换。原有两份未跟踪文档保持原内容，其“未开始”文字保留为制订时的历史状态；执行进度以本记录及证据为准。

## 阶段状态

| 阶段 | 当前状态 | 结果/依赖 |
|---|---|---|
| P0 插件骨架与兼容基线 | 已实施并通过测试客户端验收 | manifest、stdio MCP、Skills 职责骨架、health/version/status、离线打包安装、DSH 兼容回归 |
| P1 状态/事件/审批/恢复 | 核心已实施，测试通过；真实宿主审批仍为 `not-run` | CAS、哈希链事件、审批单次消费、暂停/恢复/取消和统一重试均有回归；没有可信用户来源时继续 fail-closed |
| P2 初始化 | 已实施，生成测试通过 | 四档 Java/Vue、非空预览、覆盖审批、Git baseline 与 `GENERATED_ONLY` 已接入；模板 hash 未手改 |
| P3 真实验证 | 已实施，Windows 四档证据通过；Linux `not-run` | [Windows run-3](../verification/codex-sg-v1/p3/windows-run-3/matrix.json) 四档均为 `passed`，构建、测试、lint、格式、覆盖率和运行时证据已保存 |
| P4 需求闭环 | 核心已实施，模拟可信审批测试通过；真实宿主 H1 `not-run` | 3×5 澄清、批判、H1 绑定快照、单 active change、CAS 与审计链已覆盖；默认宿主审批仍不可伪造 |
| P5 计划/契约/测试冻结 | 核心已实施，回归通过 | 动态 AC 任务图、契约/模型/测试 hash、Test 角色注入和只读复核已覆盖；布尔红标志不能推进 |
| P6 并行开发/worktree | 已通过原生 Frontend/Backend Agent 生成产品 E2E | 原生 subagent 在固定 role worktree 独立提交，P6 服务复核 freeze 后代、角色边界并以 exact commit 合入 integration；五个 worktree 与 red baseline 均有证据 |
| P7 测试质量门 | 已通过原生 Test Agent 与真实生成产品 E2E | 冻结 cases 2/2、后端 14/14、前端 12/12、9/9 验证阶段、changed-line 96.24%、P0/P1=0，最终进入 `REVIEWING` |
| P8 三档 Review/H3 | 核心已实施，自动回归通过；真实 Review/H3 `not-run` | 风险选档、只读 Review、P0–P3 门、findings 证据、H3 复合 hash 与审批后 CAS 已覆盖；原生 Review 线程未执行 challenge |
| P9 归档/push/E2E | 核心已实施，真实 Git 回归通过；真实 H3-gated E2E `not-run` | H3 前拒绝归档、H3 后 merge、无 remote、push 失败、成功本地 bare remote、无 force 与证据保留已覆盖 |

## P0 检查点

- [设计与扫描结论](../design/codex-plugin-p0.zh.md)
- [验证索引](../verification/codex-sg-v1/README.md)
- [源文件清单与 hash](../verification/codex-sg-v1/p0/repository-scan.json)
- [stdio 请求/响应、命令与退出码](../verification/codex-sg-v1/p0/stdio-smoke.json)

没有提交、推送或发布本插件仓库，没有运行用户项目的初始化或迁移。隔离测试夹具执行了自己的打包、安装和 Git 基线，这是仓库规则允许的验收用途。

## P6 检查点

- [P5/P6 设计与安全边界](../design/codex-p5-p6-development.zh.md)
- [P6 验证汇总](../verification/codex-sg-v1/p6/README.md)
- 开发服务：`src/codex/development.js`
- 工具契约：`src/codex/plan-tools.js`
- 回归：`test/codex-development-flow.test.js`、`test/codex-plan-core.test.js`、`test/codex-tools-workflow.test.js`

P6 使用实际临时 Git 仓库和子进程验证失败基线、五个 worktree、并行、合并及冲突，但前端/后端角色回调仍由测试注入，尚未证明 Codex Desktop 的原生 subagent 生命周期与汇报通道。公共 MCP 工具不接受角色、命令、提交号或 provider；默认宿主未提供服务器角色桥时返回不可用，不降级为模型自报完成。

## P7 检查点

- [P7 设计与安全边界](../design/codex-p7-quality.zh.md)
- [P7 验证汇总](../verification/codex-sg-v1/p7/README.md)
- 质量服务：`src/codex/quality.js`
- 工具契约：`src/codex/quality-tools.js`
- 回归：`test/codex-quality-gate.test.js`
- [原生 Agent P6→P7 E2E 验收](../verification/codex-sg-v1/p6-p7-native-agent-e2e/README.md)

质量服务只接受 `expectedVersion`，Test runner 由服务器注入，客户端不能传命令、角色、报告或覆盖率。test worktree 固定对齐最后一次 integration commit；执行前后均拒绝生产代码变化。green 报告必须覆盖全部冻结用例且无 skip。默认真实验证器复用 P3 的 `verifyProject`。

## P8/P9 检查点

- [P8/P9 设计与安全边界](../design/codex-p8-p9-review-release.zh.md)
- [P8/P9 验证汇总](../verification/codex-sg-v1/p8-p9/README.md)
- Review 服务：`src/codex/review.js`
- Release 服务：`src/codex/release.js`
- 工具契约：`src/codex/review-tools.js`、`src/codex/release-tools.js`
- 回归：`test/codex-review-release.test.js`

P8/P9 的 Review、H3、归档与 push 编排已经实现并通过隔离回归。自动化 H3 使用合成审批，只为验证审批安全边界；真实 Codex Desktop Review Agent 在本轮未消费 challenge，真实 H3 可信用户审批也未在宿主中完成，因此两者保持 `not-run`，不能写成完整 v1 已交付。

## 下一步暂停点

P0–P9 核心实现与本地自动验收已完成。剩余阻塞是宿主可信链路：真实 Review Agent 执行、可信 H3 审批、以及对真实 remote 执行 H3 后归档/push。只要这些环节可用，即可按现有工具直接执行，不需要重写状态机或释放逻辑。
