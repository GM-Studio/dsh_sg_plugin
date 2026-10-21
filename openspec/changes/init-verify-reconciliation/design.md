# 设计

- 继续沿用 `src/v3/commands.js` / `tools.js` 到 `src/v4/java-init.js` / `java-verify.js` 的默认路由，不改旧 v3 审批状态机。
- Vue UI 放在独立模板模块中，避免继续扩大序列化模板；固定 Element Plus 版本并重新生成前端 lockfile。
- 环境扫描区分发现与可执行验证。Windows 持久变量合并后显式进程变量优先，Linux 跟随 alternatives 符号链接。自定义路径经相同扫描和探测，不直接信任。
- 每次验证立即使旧成功状态失效，逐阶段写报告；完整日志保存到 `.specgate/verify-runs/<runId>/`，报告保存摘要与相对路径。
- 修改模板后原 Golden 记录保持历史含义；不自动赋予新模板已验收状态，必须重新本地验证。
