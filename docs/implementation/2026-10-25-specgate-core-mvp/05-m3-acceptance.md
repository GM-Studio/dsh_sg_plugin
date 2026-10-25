# M3 隔离实现、确定性质量门与有界修复验收

- 依据：v1.0 冻结需求 RQ-011–013、原计划 §7；不执行 v2.0 / Delta。
- 状态：M3 仓库实现与自动化验收已通过。最终全量结束于 2026-10-25T17:06:59.4435023+08:00；通过后才更新本报告及计划。
- 本地恢复点：`bfeaeab`（用户授权提交的 M0/M1）；M2/M3 新改动尚未提交，未推送、未发布。
- 实施目录：`E:\ai_workflow\specgate\.runtime\core-mvp-v1-worktree`，分支 `codex/core-reliable-delivery-mvp-v1`。

## 任务与 AC 验收

| 任务           | 对应 AC                                    | 实现与验证                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORE-0301      | AC-011-01–03；承接 AC-008-03/04、AC-009-03 | 真实 Git fixture 验证主目录脏、无新提交、角色目录脏、修改测试、白名单外文件及未批准依赖均拒绝；符号链接/gitlink 和文件硬链接不能绕过实现边界。                                                                                                                                                                                                                                                |
| CORE-0302      | AC-011-04                                  | 每轮前后端逻辑任务复用一个物理 `implementation` worktree，顺序切换各自分支，均从冻结提交或固定修复基线开始；记录角色提交、文件 diff、集成提交。集成、测试、Review 和 Formatter 有各自用途的目录；历史轮次与提交保留。准备、修复准备、实现和质量门共用项目级跨进程 lease，活跃所有者不能被第二客户端抢占。                                                                                     |
| CORE-0303      | AC-012-01/02                               | `repairContext` 进入角色 challenge 和 native Agent stdin：包含 case、期望/实际、命令、退出码、日志，以及 Review finding ID、文件、行号、AC、证据和建议。冻结任务的 allowedFiles/forbiddenFiles 同时传入。上下文总量限制 64 KiB，保留来源 hash/报告引用；日志摘要有界，敏感键、Bearer 和独立凭据参数值脱敏。                                                                                   |
| CORE-0304/0305 | AC-013-01–05                               | 真实子进程验证非零退出、超时、启动失败与取消；旧报告、skip、缺运行阶段及 not-run 均不能通过。Test/验证命令修改生产文件会阻断。存量项目逐项匹配 ProjectProfile 的 build/test/lint/format/runtime 命令及参数、时间、输出和退出码；known failures、跳过及伪装 passed 的非零退出不能放行。模板验证失败也保留具体失败命令与日志。通过前再次核验冻结输入和当前集成 HEAD，历史 commit 报告拒绝复用。 |
| CORE-0306      | AC-012-03/04                               | 两轮自动修复后再次请求修复，先进入 BLOCKED，不创建第三轮目录。修复后执行全部冻结 case 和完整项目验证器，生成新的 runId 与 commit 绑定；没有只重跑失败 case。质量失败重试继续受共享两次重试上限控制。                                                                                                                                                                                          |

## 实际验证

聚焦命令包含计划 §7.5 的八个测试文件，另加格式化/修复及存量项目验证回归：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-core-development.test.js test/codex-native-role-agent.test.js test/codex-quality-gate.test.js test/codex-core-quality.test.js test/codex-verification.test.js test/codex-verify-adapter.test.js test/codex-state-kernel.test.js test/codex-format-rework.test.js test/codex-adopted-verification.test.js
```

| 检查                   | 结果                                            | 时间（Asia/Shanghai） | 原始日志                                    |
| ---------------------- | ----------------------------------------------- | --------------------- | ------------------------------------------- |
| 聚焦回归               | 79/79，退出码 0                                 | 16:58:53–16:59:41     | `.runtime/core-mvp-v1-m3/focused-final.log` |
| `npm test`             | 779/779，退出码 0，0 fail / skipped / cancelled | 17:04:13–17:06:59     | `.runtime/core-mvp-v1-m3/test-final.log`    |
| `npm run lint`         | 退出码 0                                        | 17:00:01–17:00:04     | `.runtime/core-mvp-v1-m3/lint-final.log`    |
| `npm run format:check` | 退出码 0                                        | 17:00:02–17:00:06     | `.runtime/core-mvp-v1-m3/format-final.log`  |
| `npm run pack:check`   | 退出码 0                                        | 17:00:02–17:00:04     | `.runtime/core-mvp-v1-m3/pack-final.log`    |
| `npm run codex:smoke`  | 退出码 0                                        | 17:00:02–17:00:03     | `.runtime/core-mvp-v1-m3/smoke-final.log`   |

- 每项命令的精确开始/结束、工作目录与退出码保存在同名 `.result.json`；文档更新后另执行格式检查和 `git diff --check`。
- 源码/测试阶段快照及 SHA-256：`.runtime/core-mvp-v1-m3/source-snapshot.json`；验收汇总：`acceptance.json`。M2 快照也保留，不把后来 M3 源码当作 M2 当时的源码。
- 原目录 868 个已有文件的哈希复核均未改变；报告及实施改动仅位于独立工作区。

## 失败取证与已知测试风险

- 先后通过新增失败测试复现：多个实现物理目录、存量项目 known failure 假绿、模板验证失败却传递上一条成功测试退出码。修复前日志分别保留为 `red-single-worktree.log`、`red-adopted-strict-fixed-fixture.log`、`red-template-verifier-context.log`。
- Windows 下 `taskkill` 可以启动但以非零状态退出；此前仅监听启动错误会导致超时清理悬挂。已统一进程终止逻辑，对非零退出也执行直接终止兜底。人工清理过的一轮不作为最终证据；最终超时回归在真实 Node 子进程上验证自动清理及耗时上限。
- 一轮全量为 778/779：既有可选 Worker 管理测试使用随机端口，Node fetch 在发出 HTTP 前报 `bad port`。未修改、删除或 skip 该测试；禁止端口行为独立复现，该组 5/5 后再次执行完整测试达到 779/779。失败日志、独立诊断和复现保留为 `test-bad-port.log`、`worker-port-diagnostic.log`、`worker-port-reproduction.json`。可选 Web 测试仍有随机端口风险，M5 隔离工作尚未完成。

## 验证边界与后续

- 以上通过结论对应内核、真实隔离 Git/Node 子进程、提示词序列化及服务级自动化测试；注入的业务验证报告明确属于 fixture，不冒充真实业务验证。
- 真正 Codex 宿主中的模型角色执行、可信交互审批与 Java/Vue 完整业务交付仍为 NOT_RUN。MCP smoke 也明确报告 hostInstallation/trustedApproval/subagents 为 not-run。
- 全量测试复用本机既有 MySQL 测试安装，没有新增数据库依赖；MySQL/控制面仍待 M5 从默认核心隔离。
- M4 的格式化后完整回归、独立最终 Review 与交付证据绑定尚未交付；本轮格式化/修复旧流程回归通过不等同于 M4 完成。
- 用户指定的 `E:\ai_workflow\pilot-java-api` 仍为 Java 8 / Boot 2.7.18、无 Vue，M6 保持 BLOCKED；未修改该项目，未用 fixture 替代金丝雀。
- 现有提交、历史轮次、工作区和日志均保留；未自动回滚或清理用户文件。
