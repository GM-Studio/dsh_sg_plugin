# M2 需求、计划与测试前移验收

- 依据：v1.0 冻结需求与原计划 §6；不执行 v2.0 / Delta。
- 验收时间：2026-10-25T08:06:51.889Z（UTC；Asia/Shanghai 为 UTC+8）。
- 状态：M2 已通过；M3 尚未开始；本阶段改动尚未提交。
- 本轮开始前，M0/M1 已由用户授权提交到本地：`bfeaeab`，未推送。

## 任务验收

| 任务           | 实现和验证                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORE-0201      | 拒绝重复 REQ/AC、空 AC 和无验证方式的常见空泛 AC；明确验证方式在提案和用户文档中保留；新增失败测试先复现。                                                                                                            |
| CORE-0202      | 回归三轮五问、可信原生输入、全 REQ 反述、阻塞批判拒绝 H1、制品变更后旧审批失效；新增依赖清单在 H1 全文中可见并绑定冻结快照。                                                                                          |
| CORE-0203/0204 | 新计划 schemaVersion=2；每任务包含 requirementIds/acIds/allowedFiles/forbiddenFiles/dependencies/verification；Git diff 机械校验，包含角色目录内更窄白名单；路径逃逸、重复规则、悬空依赖和未知任务拒绝。              |
| CORE-0205      | H1 前提出 dependencyChanges（具体文件、目标 Git blob SHA-256、AC、原因）；冻结计划只能继承已消费 H1 的同一清单；实现与 Review 均拒绝无批准或哈希不一致的依赖变更；真实 Git 提交的批准/未批准/错误哈希三种情况有断言。 |
| CORE-0206      | native Test Designer 的隔离 worktree、真实 commit、只提交测试/fixture/runner、AC 覆盖和冻结 hash 回归通过；实现阶段测试不能直接替换，旧 manifest 和状态保持不变。                                                     |
| CORE-0207      | 实现前每 case 必须真实 fail；旧红色报告在受控临时输出位置移除，不能充当新观察；红色命令结束后重新核验冻结资产，篡改会在创建实现 worktree 前阻断。                                                                     |
| CORE-0208      | 回归未绑定/脏目录/缺基线阻断、argv 命令和真实失败保留；已有项目基线与项目工具测试通过。                                                                                                                               |

## 兼容与边界

- 旧 schemaVersion=1 计划只读可见，不重写、不静默升级，也不能用于冻结下游资产、实现或 Review；须从新批准的 Change 建立新计划。
- `dependencies` 是新契约字段；原 `deps` 暂保留为兼容字段，验证要求两者严格一致，不能各自形成不同任务依赖。
- `verification=['frozen-tests']` 引用内核受控测试执行入口；build/test/lint/format/runtime 的真实执行门在 M3 验证，不允许工具传任意 shell。
- 默认实现范围沿用前后端目录；可通过 taskPolicies 进一步收窄或显式配置其它相对路径，禁止路径逃逸，冻结测试的系统禁止规则不能移除。
- 依赖目标哈希按固定提交中的 Git blob 字节核对。依赖文件删除当前直接阻断，不会把删除当作已批准的空内容。
- 测试替换旧入口保留为显式拒绝，不能凭一段 reason 覆盖冻结测试。
- AC 的语义可观察性不能仅靠正则证明；代码对已知空泛表述要求明确 verification，其余仍须经完整批判、测试设计与可信 H1。
- 既有单元 fixture 补齐 AC 关联和 schemaVersion=2 输入；没有放宽断言。旧“允许在 TESTING 替换测试”的断言改为更严格的拒绝和原始证据保留断言。
- 合并冲突 fixture 对 shared/config.json 增加显式冻结白名单，不允许仅靠构造器注入的 rolePolicy 绕过计划。

## 实际验证

| 命令                                                                                                                                                                                                                                                                                                                                                                                                                  | 退出码 | 开始                              | 结束                              | 日志                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------- | --------------------------------- | ------------------------------------------- |
| `node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-change-add-flow.test.js test/codex-host-input.test.js test/codex-plan-core.test.js test/codex-project-model.test.js test/codex-development-flow.test.js test/codex-review-release.test.js test/codex-native-role-agent.test.js test/codex-native-runner.test.js test/codex-project-tools.test.js test/codex-baseline.test.js` | 0      | 2026-10-25T15:58:36.0054219+08:00 | 2026-10-25T15:59:01.1280184+08:00 | `.runtime/core-mvp-v1-m2/focused-final.log` |
| `npm test`                                                                                                                                                                                                                                                                                                                                                                                                            | 0      | 2026-10-25T16:02:58.7597270+08:00 | 2026-10-25T16:05:08.6809842+08:00 | `.runtime/core-mvp-v1-m2/test-final.log`    |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                                                                        | 0      | 2026-10-25T16:02:59.0576634+08:00 | 2026-10-25T16:03:01.8089470+08:00 | `.runtime/core-mvp-v1-m2/lint-final.log`    |
| `npm run format:check`                                                                                                                                                                                                                                                                                                                                                                                                | 0      | 2026-10-25T16:02:59.3414001+08:00 | 2026-10-25T16:03:03.8495717+08:00 | `.runtime/core-mvp-v1-m2/format-final.log`  |
| `npm run pack:check`                                                                                                                                                                                                                                                                                                                                                                                                  | 0      | 2026-10-25T16:02:59.6474570+08:00 | 2026-10-25T16:03:01.3170064+08:00 | `.runtime/core-mvp-v1-m2/pack-final.log`    |
| `npm run codex:smoke`                                                                                                                                                                                                                                                                                                                                                                                                 | 0      | 2026-10-25T16:03:00.0118401+08:00 | 2026-10-25T16:03:00.5897897+08:00 | `.runtime/core-mvp-v1-m2/smoke-final.log`   |

- 聚焦：111 tests / 111 pass / 0 fail / 0 skipped。
- 全量：758 tests / 758 pass / 0 fail / 0 skipped / 0 cancelled。
- lint、format、pack、smoke 全部退出码 0，git diff --check 通过。
- 初次全量的两个失败来自旧格式化/修复 fixture 缺少新计划版本；补齐真实新契约输入后重跑全量通过。初次 lint 的正则写法问题已修正，未删除失败日志。
- 机器证据和本阶段源码 SHA-256：`.runtime/core-mvp-v1-m2/acceptance.json`。

## 未执行与后续

- 真正宿主里的可信审批、Test Designer 和完整真实业务交付仍 NOT_RUN；隔离 Git fixture 与注入式服务测试不作为真实环境证明。
- 原指定金丝雀的栈不匹配仍阻断 M6。
- MySQL/控制面等可选功能尚未在 M5 隔离；本轮全量临时复用既有测试 MySQL 实例。
- M3 将继续补齐 findings 输入、单写入者与修复上限；M4 的格式化后回归、最终 Review/交付证据绑定仍未交付。
