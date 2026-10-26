---
name: sg-codex-status
description: 只读查看 SpecGate Core 绑定项目、环境、Change、审批、验证与交付状态时使用。
---

# 项目状态

调用 `sg_status`，必要时补充 `sg_project_status` 与 `sg_state`。分开说明项目基线、环境探测、当前 Change 阶段、H1/H3 待审批、质量报告的 commit 和最近 DeliveryRecord。

查询不得安装、初始化、修复、恢复、审批或启动可选控制面。历史证据标明时间和提交，不当作当前通过；不存在或未执行的证据明确标为未知或未执行。默认 Core 不显示 WorkItem、Worker、Decision、TOTP 或远程部署状态。
