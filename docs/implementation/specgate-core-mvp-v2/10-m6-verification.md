# M6 验证记录（进行中，尚未验收交付）

- 日期：2026-10-26；依据 CORE2-0601…0605。
- Core 技术回归当前通过；真实金丝雀仍在执行，M6 尚未通过退出门。
- 本轮开始时 SpecGate 源码为未提交工作树；本文与复验证据随后随独立提交保存。金丝雀本地提交已获用户单独授权。

## 当前真实命令

| 检查                                         | 当前结果                                                  | 证据（execution-20261026）                                           |
| -------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| Core 全量回归                                | 744/744，0 fail/skip/cancel                               | final-full.txt + final-revalidation-20261026.txt                     |
| M6 交付/质量/离线包聚焦                      | 44/44，0 fail/skip/cancel                                 | m6-focused.txt                                                       |
| Windows 命令、声明式格式化、角色路径         | 19/19，0 fail/skip/cancel                                 | m6-command-role-focused.txt                                          |
| 冻结运行器证据、变更行覆盖率与工作流         | 31/31，0 fail/skip/cancel                                 | m6-native-verification-focused.txt                                   |
| lint / format check / pack check / MCP smoke | 全部退出0                                                 | final-lint.txt / final-format.txt / final-pack.txt / final-smoke.txt |
| 可选 MySQL                                   | 未被 Core 验收；显式命令退出1，MYSQL_DRIVER_NOT_INSTALLED | optional-mysql-not-accepted.txt                                      |

完整测试真实执行离线 npm pack/install，从非插件目录加载安装包，并在包内运行完整合成生命周期和质量套件；其审批、角色和覆盖率 provider 明确是 fixture，不计作业务金丝雀或真人回执。

## 本轮实际发现并回归的缺陷

1. 归档新建 merge commit，使最终交付提交与质量/Review 提交不同：改为只快进到受验 commit，分叉阻断；负向分叉用例保留目标分支和文件。
2. 客户摘要遗漏 ProjectBaseline.unverifiedAreas：将原始说明和风险逐项纳入不可变 knownIssues，并验证客户摘要包含这些内容。
3. Windows 基线的 bare npm 和 Formatter 的 bare npm.cmd 无法正确执行：共用有界 PATH 解析与严格参数引用，真实子进程验证版本和格式命令，拒绝 shell 注入。
4. 项目命令起止时间未完整透传：基线及其持久化摘要、后续验证均记录真实时间；旧证据无时间仍保持 null，不能补造。
5. 现有项目没有 Maven wrapper 时遗漏已声明 Spotless：仅在 POM 明确声明时调用已安装 Maven，保留无配置时的阻断。
6. 原生角色可显式复用已安装的桌面 Codex 路径，避开 PATH 上旧 CLI；真实只读 CLI 探测有机器事件，但不能代替真实角色完成记录。
7. 原生冻结测试新增验证命令时，原 ProjectProfile 只包含接入时的命令，重复运行可能遗漏新检查或覆盖覆盖率产物：原生模式可接收实际冻结运行器的完整报告，要求九阶段、同一提交、运行期间时间戳、真实日志和运行进程终止证据；日志另存并记录哈希。过期提交、缺日志和过期时间均拒绝。公开工具不接收报告或该开关。
8. 前端变更行覆盖率错误统计变更文件内全部语句，并重复计数同一行：按 Git 实际新增行过滤、聚合同一行的真实命中数。两条回归分别验证变更行已覆盖与未覆盖，原有行不能影响结论。原生 Test Designer 的执行协议同时明确 JSON 用例状态和变更构建配置的覆盖要求，避免模糊约定。

对应红色证据：m6-delivery-smoke-red.txt、m6-red-unverified-summary.txt、m6-red-baseline.txt、m6-red-formatter-command.txt、m6-red-maven-formatter.txt。修复后执行了聚焦和完整回归，未降低已有断言或核心覆盖率阈值。

提交前复验又补上两项缺口：Review 报告现在必须在执行、状态读取与 H3 三条路径上同时证明服务端 provider 身份和非空 assignment hash，缺少任一项返回 `REVIEW_IDENTITY_REQUIRED`；Review 夹具补齐红色基线证据，避免测试成功路径依赖不完整状态。另修复 `development.js` 中会被 lint 发现、但被兼容性 fallback 吞掉的未定义文本检查函数。复验结果：聚焦 130/130，全量 744/744，0 fail/skip/cancel；lint、format check、pack check 与 MCP smoke 均退出 0。

## AC-MVP-11…16 的受测场景

| AC  | 测试文件与可定位测试名                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| 11  | codex-quality-gate：formatter reruns the server quality gate against the formatted integration commit；失败后 Review 关闭用例     |
| 12  | codex-state-kernel：project facts share the authoritative WAL；legacy state edits after the first authoritative write fail closed |
| 13  | codex-approval-state：pending authorization releases the writer lock and expires without a residual reservation                   |
| 14  | codex-core-anchor：external anchor detects simultaneous snapshot and event rollback and missing anchor                            |
| 15  | codex-plan-core：frozen test replacement requires H1 reopening, refreeze and a new real red baseline                              |
| 16  | codex-plugin-protocol 的完整工具清单；codex-plugin-package 的静态图、依赖、离线包启动与项目状态断言                               |

## 阻断场景与负向回归

| 场景                   | 实际测试来源                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 脏工作区               | codex-change-add-flow：generated-only initialization, dirty tracked files, and untracked files refuse intake without state writes |
| 无 AC / 重复 ID        | codex-change-add-flow 的结构校验与 duplicate IDs 用例；codex-change-tools 的 nested schema 拒绝                                   |
| 红色基线一开始为绿     | codex-development-flow：red baseline requires a real failing command mapped to every frozen case before worktrees                 |
| 修改冻结测试           | codex-development-flow：cross-role or test-file changes fail closed…                                                              |
| 白名单越界             | codex-development-flow：same-role changes outside task allowlists and inside forbiddenFiles are blocked                           |
| 未批准依赖             | codex-development-flow：dependency manifests require the exact H1-approved content hash and AC                                    |
| 质量失败 / 跳过 / 超时 | codex-quality-gate 的 frozen case、timeout、coverage 阻断与有界修复用例                                                           |
| 格式化后失败           | codex-quality-gate：a failed post-format quality run keeps Review closed and records repair evidence                              |
| Review blocker / 写入  | codex-review-release：strict mode blocks P3 findings；Review Agent writes are rejected                                            |
| 证据跨提交             | codex-review-release：Review and H3 reject quality evidence from another integration commit                                       |
| 两轮修复后仍失败       | codex-state-kernel 的共享失败预算与跨任务预算用例；codex-quality-gate 的 WORKFLOW_BLOCKED 用例                                    |
| 无 H3 归档             | codex-review-release 的 H3 cannot be bypassed；完整合成生命周期再次检查 H3_REQUIRED                                               |

## 真实金丝雀边界

真实项目来自 GitHub；先前所有失败日志保留。H1 已通过当前源码的审批权威正式消费，真实用户问答与原生输入转接记录保存在 canary-session；没有通过工具参数代填澄清或批准。

当前仍在真实 Test Designer 阶段。CORE2-0603、AC-MVP-01、AC-022-02、真实 Reviewer 和 H3 未完成，不记 PASS。Core 用例成功不代替这些事实。最终只有全部退出门实际通过后才更新本记录与计划的 M6 状态。
