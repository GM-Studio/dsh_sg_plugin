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

## 2026-10-26 后续接续与真实缺陷修正

上文是早期执行快照。接续时读取权威状态发现项目实际已经推进至 `skillhub-canary-v1-8`、v289，已有真实 H1 和测试提交 `9dda824`，不能根据旧文档重建初版需求。独立审计确认：v1.6 的技术绿灯因 Review 发现无效红基线而未交付；v1.7 缺少精确依赖批准；v1.8 又把已满足的工具自检和历史保留建为业务 AC，无法诚实满足每个冻结 case 全红，且运行器曾存在硬编码红灯。上述历史均保留，不计作交付。

本轮实际修复：

1. `development.js` 恢复每个冻结 case 必须真实失败的门禁，删除由 `verification/errors` 元数据或 baseline 文本触发的“至少一个失败”捷径，并拒绝 `infrastructureErrors`；聚焦 14/14。真实 Test Designer 修复无业务失败也可返回红灯的运行器分支，13 项辅助自检通过；测试修正仅在业务仓库提交 `24d9865`。
2. 全量回归实际命中 Fetch 的禁止端口，重现 `control-daemon` 的 `bad port`。自动端口有界重分配、显式禁用端口拒绝；四文件聚焦 44/44，保留修复前失败日志。
3. ESLint 排除本地 `.task-evidence/` 与 `.npm-cache/`，避免扫描测试清理中的临时目录；生产源码仍完整检查。

本轮 Core 最终全量为 **754/754、0 fail/skip/cancel**，lint、format check、pack check 和 MCP smoke 已真实退出 0。证据：`m6-closure-full-final.txt`、`m6-closure-lint-final.txt`、`m6-closure-format.txt`、`m6-closure-pack.txt`、`m6-closure-smoke.txt`。最初把临时业务 fixture 放到插件源码内导致目录门禁阻断的失败、以及修复前 750/751 的端口失败均保留，没有覆盖或伪称通过；最终使用仓库此前的独立短临时目录 `C:/sg-core-test-temp`。

v1.8 已通过正式 `sg_cancel` 取消并保留。用户经真实宿主澄清确认[修正候选](13-canary-closure-correction.md)，随后批准 v1.9 H1，文档 SHA-256 为 `87e9e6a1ef275c6d618de5d62d9706501f691594fb6acf9977898a1c7313c988`。状态机消费后 v304；计划与契约冻结后 v308；获批需求和计划在独立业务仓库提交 `64c26ce`，工作树干净后准备独立测试设计，状态 v309。

新会话“独立复核 M6 最终验收证据”（`01a176f0-433d-7dd3-9c7d-82c9a1ca8623`）只读复核；真实独立 Test Designer 由宿主子 agent 执行，服务端保留任务全文、assignment hash 和真实 host agent 引用。早期 CLI 角色连接失败保留为失败，不冒充完成。实际宿主回执、角色和工具结果位于 `execution-20261026/closure-session/`。

截至本段记录，v1.9 测试设计正在运行，正式测试冻结、当前提交红基线、实现集成、质量门、格式化后全量、固定提交 Review、H3 与 DeliveryRecord 尚未完成，均不记 PASS。SpecGate 源码没有提交或推送；独立业务本地提交沿用上一会话真实授权。

### v1.9 测试冻结与执行路径取证

独立 Test Designer 已提交 `3a7f804b1a16ac928546ae19a81bc02db185689f`，29 份测试资产，工作树干净。诊断红基线实际运行后端 127 项（126 pass、1 个原 OAuth 业务失败、0 skip）与前端 69/69；原前端生产 build 实际出现 TS2339/TS2769。三个业务 case 均 fail，基础设施错误为 0；辅助自检 13/13。该诊断不代替正式红基线。

`sg_test_design_freeze` 正式冻结测试，状态 v311，tests hash 为 `sha256:1175ddefde61d073f0f0c6633044909919df6ce853190c61c87ce4cb81b2f95a`。随后从规范冻结快照的正式运行暴露 Windows JVM 无法加载长路径 JaCoCo JAR，实际后端测试为 0；门禁返回 `RED_REPORT_INVALID`，状态未进入实现。失败见 `closure-session/red-rejected-long-jvm-path.json`。

短执行副本的尝试随后遇到 E 盘空间耗尽，仍按基础设施失败拒绝，未计为红灯，见 `red-rejected-full-disk.json`。用户真实确认本轮三份可再生 Maven 缓存清理后，删除命令仍被策略拒绝，改用保留数据的跨盘迁移：缓存保存在 `C:/sg-core-test-temp/specgate-retained-cache-01a176af/{designer-m2,frozen-m2,partial-m2}`，源码、冻结测试、审批和全部报告未删除。E 盘恢复约 1.24 GiB 可用空间。

当前正在把“逐文件验哈希、原字节短路径执行、按项目与冻结 hash 复用”的环境修复落实到 Core，完成后仍须从规范快照重新执行正式红基线，不以临时 driver 的运行冒充默认产品路径通过。M6 保持进行中。
