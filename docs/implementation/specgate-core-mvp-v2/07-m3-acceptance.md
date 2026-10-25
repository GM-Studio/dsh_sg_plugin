# M3 实现、质量与有界修复验收

- 日期：2026-10-25；依据 CORE2-0301…0303；结果：通过。

质量失败与 Review blocker 的具体 finding 进入实际角色 provider 和 native prompt，携带 ID、文件/行号（已知时）、AC、期望/实际、命令及退出码、证据引用和建议。摘要限制为 64 KiB，脱敏并保留完整输入 hash；缺少质量失败命令时拒绝启动修复。Review 的 finding 关联其 Review 证据，不拿旧质量报告替代。

自动修复只有 checkpoints.js 中一个上限常量。前两次失败允许重试，第三次失败 BLOCKED；同一 Change 换角色/任务类别不能刷新预算。合并冲突循环不再另设数值上限，由同一计数器决定退出。原先 failures <= 2 的同任务比较语义正确，未改成更宽松比较。

冻结测试命令与所有验证命令均记录服务端派生的来源（文件/注册点、命令标识及相关 hash），adopted 路径绑定 ProjectProfile。工具拒绝传入临时命令；失败验证报告也保留供修复定位。

- [聚焦回归](../../verification/specgate-core-mvp/execution-20261025/m3-green-focused.txt)：41/41，0 fail/skip/cancel。
- [完整回归](../../verification/specgate-core-mvp/execution-20261025/m3-green-full.txt)：711/711，0 fail/skip/cancel。
- [lint](../../verification/specgate-core-mvp/execution-20261025/m3-green-lint.txt)、[format](../../verification/specgate-core-mvp/execution-20261025/m3-green-format.txt)、[pack](../../verification/specgate-core-mvp/execution-20261025/m3-green-pack.txt)、[smoke](../../verification/specgate-core-mvp/execution-20261025/m3-green-smoke.txt)：退出 0。

验证环境仍使用独立短 TEMP。M1/M2 回归包含在全量内。此前八项缺口对应的新增反例均有回归：状态映射、唯一状态源、整体回退、锁外授权、故障序号一致性、任务边界、findings 输入、受控测试重开。质量命令与跨类别预算另有负向断言。

实际人工审批、AI 角色原生会话及真实金丝雀仍未执行，M4–M6 尚未验收。本报告不将 fixture 等同于真实业务交付。
