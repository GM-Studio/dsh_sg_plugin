# M1 可信状态与审批内核验收

- 执行依据：v1.0 冻结需求与本次重新批准的原计划。
- 验收时间：2026-10-25T07:19:09.196Z（UTC；对应本机 Asia/Shanghai +08:00）。
- 结果：M1 退出门已通过；M2–M6 未交付。
- 分支：`codex/core-reliable-delivery-mvp-v1`；源码未提交。

## 任务与实际行为

| 任务      | 本阶段实现或验证                                                                                                                 | 证据                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| CORE-0101 | 新建核心状态聚焦测试，先观察旧状态词表、缺少公开视图函数等真实失败                                                               | `.runtime/core-mvp-v1-m1/red-state.log`                           |
| CORE-0102 | 对外主状态固定为 10 个、侧状态 3 个；公开迁移表仅使用该词表；状态、checkpoint、resume 与 MCP 文本/结构化结果一致转换；未知值拒绝 | codex-core-state-machine.test.js                                  |
| CORE-0103 | 拒绝第二个活动 Change，记录不可覆盖的拒绝回执，同时不推进 state version；取消后允许新 ID；无排队和覆盖                           | 新回执测试先失败：red-refusal.log；state-kernel / change-add-flow |
| CORE-0104 | 保持服务端 opaque 审批权限、gate/scope/hash/actor/TTL/nonce、一次消费；重放/伪造/过期/变更制品仍拒绝                             | approval-authority / approval-state / change-add-flow             |
| CORE-0105 | 保持 WAL/CAS、原子快照和恢复；新增中间事件删除、记录重排拒绝测试；已有篡改/截断/快照失败和旧证据回归全绿                         | state-kernel / core-state-machine；全量 verification 回归         |
| CORE-0106 | 新增共享凭据扫描，状态参数、WAL 事件、JSON/文本证据落盘前拒绝明显凭据；脱敏占位符可保存；保留路径/链接/原生输入门禁              | red-sensitive.log；artifact-store / host-input / change-add-flow  |

## 状态兼容设计与边界

- 公开状态由唯一事件链内核投影，既有 22 个内部执行步骤保留用于现有编排与历史事件读取，不重写历史事件，也不建立第二份可写的公开状态文件。
- MCP 返回的业务状态使用 v1.0 的 10+3 词表；直接内部服务仍使用原有执行步骤进行 CAS 和门禁。该内部协议没有暴露新的任意迁移工具。
- 事件 hash 继续绑定原始 WAL；公开结果只返回事件定位信息（hash/sequence/type/timestamp/changeId），不把改过展示字段的事件正文冒充原始哈希输入。
- H3 已批准但交付尚在生成的内部 ARCHIVING，公开保留 H3_PENDING 并标记 deliveryPending=true；只有 ARCHIVED / ARCHIVED_NOT_PUSHED 才显示 DELIVERED，避免把生成开始描述为已交付。这是依据 v1.0“已生成交付记录”的语义作出的实现选择，不采用 Delta 的 ARCHIVING→DELIVERED 映射。
- 拒绝回执是不可覆盖的审计证据，位于 `.specgate/codex/refusals/`，不充当状态源，不改变已有状态版本。
- 旧可选模块与 `core/state.js` 的发行/运行边界仍归 M5；本阶段没有擅自删除它们。

## 验证结果

| 命令                                                                                                                                                                                                                                                                                                                            | 退出码 | 开始                              | 结束                              | 日志                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------- | --------------------------------- | ------------------------------------------- |
| `node --import ./test/setup-temp.mjs --test test/codex-core-state-machine.test.js test/codex-state-kernel.test.js test/codex-approval-authority.test.js test/codex-approval-state.test.js test/codex-change-add-flow.test.js test/codex-artifact-store.test.js test/codex-host-input.test.js test/codex-tools-workflow.test.js` | 0      | 2026-10-25T15:15:35.7181818+08:00 | 2026-10-25T15:15:49.1429611+08:00 | `.runtime/core-mvp-v1-m1/focused-final.log` |
| `npm test`                                                                                                                                                                                                                                                                                                                      | 0      | 2026-10-25T15:16:09.9472912+08:00 | 2026-10-25T15:18:09.7600978+08:00 | `.runtime/core-mvp-v1-m1/test-final.log`    |
| `npm run lint`                                                                                                                                                                                                                                                                                                                  | 0      | 2026-10-25T15:16:10.1455723+08:00 | 2026-10-25T15:16:13.1334373+08:00 | `.runtime/core-mvp-v1-m1/lint-final.log`    |
| `npm run format:check`                                                                                                                                                                                                                                                                                                          | 0      | 2026-10-25T15:16:10.3701507+08:00 | 2026-10-25T15:16:15.0859963+08:00 | `.runtime/core-mvp-v1-m1/format-final.log`  |
| `npm run pack:check`                                                                                                                                                                                                                                                                                                            | 0      | 2026-10-25T15:16:10.6591282+08:00 | 2026-10-25T15:16:12.5181616+08:00 | `.runtime/core-mvp-v1-m1/pack-final.log`    |
| `npm run codex:smoke`                                                                                                                                                                                                                                                                                                           | 0      | 2026-10-25T15:16:10.9143615+08:00 | 2026-10-25T15:16:11.4549670+08:00 | `.runtime/core-mvp-v1-m1/smoke-final.log`   |

- 聚焦回归：97 tests / 97 pass / 0 fail / 0 skipped。
- 最终全量：745 tests / 745 pass / 0 fail / 0 skipped / 0 cancelled。
- lint、format check、pack check、MCP smoke 全部退出码 0；git diff --check 通过。
- 全量测试前已确定性格式化全部改动源码；全量命令结束前没有再次修改源码。
- 一轮 lint 曾因本次临时 M0 脚本存在未使用 import 失败；修正后重跑，并且最终一轮全部检查通过，初始失败日志未删除。
- 原目录 868 个既有文件再次哈希验证，差异 0。
- 机器证据与源码 SHA-256：`.runtime/core-mvp-v1-m1/acceptance.json`。

## 未执行与后续门禁

- 可信宿主审批和真实子代理执行仍 NOT_RUN；单元测试中的模拟不能作为真实环境证据。
- M5 尚未完成，默认仍有可选模块与 MySQL；本次全量依赖现有测试实例，不声称“核心无需外部服务”已成立。
- M6 仍因指定项目的 Java 8 / Boot 2.7.18 / 无 Vue 而 BLOCKED。
- 格式化后全量回归、Review 当前 commit 绑定、客户已知问题摘要属于 M4，不能用本阶段通过结果替代。
- 未执行 git commit / push / publish。
