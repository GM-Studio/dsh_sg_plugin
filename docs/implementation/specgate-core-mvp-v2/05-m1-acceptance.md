# M1 状态内核验收

- 日期：2026-10-25；依据：v2.0-approved，CORE2-0101…0105。
- 结果：通过。仅记录实际命令证据，不代表 M2–M6 完成。

| 任务 | 交付与负向验证                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 0101 | 22 个内部状态的唯一公开映射，13 个公开值；未知状态拒绝，MCP 响应投影公开状态。                                     |
| 0102 | core/state 只读；初始化不再生成第二份工作流状态；验证和 runtime 项目事实经同一 WAL/锁/锚点保存，旧状态改动被检出。 |
| 0103 | 异步授权在写锁外；授权预留期间可读，写入返回 APPROVAL_IN_PROGRESS；超时释放，迟到审计拒绝。                        |
| 0104 | 每次审批审计独立短事务读取最新序号；完整写入后 fsync 故障再审计不复用序号，链仍可校验。                            |
| 0105 | 用户级外部追加锚点；事件和快照同时回退被拒，锚点缺失 fail-closed，锚点写入为常数大小追加。                         |

验证使用独立短 TEMP `C:\Users\Administrator\AppData\Local\SpecGateTestTemp`。测试 bootstrap 将锚点隔离到测试 run 内、项目 fixture 外；真实运行默认使用用户目录 `.specgate/anchors`。

- [聚焦回归](../../verification/specgate-core-mvp/execution-20261025/m1-green-focused.txt)：102/102，0 fail/skip/cancel。
- [完整回归](../../verification/specgate-core-mvp/execution-20261025/m1-green-full.txt)：704/704，0 fail/skip/cancel。
- [lint](../../verification/specgate-core-mvp/execution-20261025/m1-green-lint.txt)、[format](../../verification/specgate-core-mvp/execution-20261025/m1-green-format.txt)、[pack](../../verification/specgate-core-mvp/execution-20261025/m1-green-pack.txt)、[smoke](../../verification/specgate-core-mvp/execution-20261025/m1-green-smoke.txt)：退出 0。

旧生成/验证用例暴露出的 manifest 和 required-files 对旧 state.json 的依赖已同步移除，保持对完整生成产物和真实验证结果的校验。未迁移的旧事件库缺少外部锚点时明确阻断，不自动制造信任锚或重写历史。真实金丝雀、人工审批、AI 角色运行仍未在本阶段执行。
