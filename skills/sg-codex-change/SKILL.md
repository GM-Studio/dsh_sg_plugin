---
name: sg-codex-change
description: 在已有 Git 项目中用 SpecGate Core 新增、修改、修复业务需求，或继续、暂停、取消、验收本地交付时使用。
---

# 本地可靠交付

先读 `sg_state`、`sg_project_status` 与环境检查。项目必须有真实 ProjectProfile 和 ProjectBaseline；无基线先用 `$sg-codex-project` 接入已有项目。

1. `sg_change` / `sg_change_add` 收集用户需求，按服务端问题澄清、反述、批判分析，形成可审阅的需求文档。使用 `sg_request_h1` 请求可信 H1；用户未批准不得冻结。
2. `sg_plan_generate`、`sg_plan_freeze_contracts` 冻结 AC、任务依赖和每任务文件白名单。Test Designer 在独立 worktree 提交可执行测试，`sg_test_design_freeze` 后真实运行全红基线。
3. `sg_development_prepare` 后由同一个 Implementer 角色按前后端任务分别串行实现。服务端检查提交、白名单、冻结测试与依赖变更。质量失败或 Review blocker 的具体 findings 回传修复轮次；全 Change 自动失败预算由服务端控制。
4. `sg_quality_run` 执行冻结测试和项目声明的验证命令。确定性 Formatter 用 `sg_format_run` 提交格式化结果，并在格式化后的 integration commit **重新执行完整质量门**。失败不得进入 Review。
5. Reviewer 只读检查固定提交；`sg_review_run` 只接受服务端角色报告，提交与质量证据必须一致。`sg_review_request_h3` 请求真实人工验收后，`sg_release_preview` / `sg_release_archive` 产生 DeliveryRecord 与包含全部已知问题的客户摘要。

`sg_pause`、`sg_resume`、`sg_cancel` 使用当前 expectedVersion；保留代码、worktree 与证据。H1/H3 不接受聊天同意或工具参数冒充。远程推送仅在 H3 后用户显式请求 `push=true`。不要声称未运行的命令、原生 Reviewer 会话或业务金丝雀已经通过。
