# M2 需求、计划与测试前移验收

- 日期：2026-10-25；依据 CORE2-0201…0204；结果：通过。

任务图包含受校验的 REQ/AC、dependencies、verification、allowedFiles、forbiddenFiles。默认 Java/Vue 目录策略明确写入新计划；调用方可提供冻结的 filePolicies，越界与 forbidden 命中由真实 Git diff 拒绝。旧计划缺字段时明确拒绝，不能静默升级为批准计划。

依赖变更声明进入 H1 需求正文并绑定相对文件、内容 SHA-256 和 AC；生产提交改变依赖清单时必须逐项匹配。未批准的 lockfile 单独改动也阻断。

冻结测试不接受直接替换或调用方注入 assets。受控入口使用 H1 批准“重开”，保留旧 hash、理由、批准来源、旧开发证据，回到 TEST_DESIGN；重新冻结记录新 hash，回到 TEST_CASES_FROZEN；实际重跑红色基线后才创建新的版本工作树并进入实现。没有增加第三类人工门。旧分支和测试不删除。

- [聚焦测试](../../verification/specgate-core-mvp/execution-20261025/m2-green-focused.txt)：75/75，0 fail/skip/cancel；另有 [MCP 契约回归](../../verification/specgate-core-mvp/execution-20261025/m2-tools.txt)。
- [完整回归](../../verification/specgate-core-mvp/execution-20261025/m2-green-full-final.txt)：708/708，0 fail/skip/cancel。
- [lint](../../verification/specgate-core-mvp/execution-20261025/m2-green-lint.txt)、[format](../../verification/specgate-core-mvp/execution-20261025/m2-green-format.txt)、[pack](../../verification/specgate-core-mvp/execution-20261025/m2-green-pack.txt)、[smoke](../../verification/specgate-core-mvp/execution-20261025/m2-green-smoke.txt)：通过。

补充断言涵盖重复 REQ/AC、完整分类下缺失反向复述、未映射依赖拒绝，以及依赖审批内容在需求文档可见。全量验证使用既定独立短 TEMP。测试中的 H1 用户、角色及项目均为明确标识的合成 fixture，不是实际人工审批或业务金丝雀证据。M3–M6 尚未验收。
