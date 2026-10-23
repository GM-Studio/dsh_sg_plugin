---
name: sg-codex-change
description: 用户请求 SpecGate 新增功能、修改或修复已有功能，继续/暂停/取消明确任务，或对当前需求进行验收交付时使用。
---

# SpecGate 需求开发与任务控制

读取 `sg_state`、`sg_project_status` 和必要的 `sg_work_item_status`，多个任务时明确目标。查询进度转 `$sg-codex-status`，不编造示例需求。执行前使用 `$sg-codex-env` 环境门禁与 `$sg-codex-project` 项目基线能力，保留已有选择，需求可先澄清，实际实现和交付必须满足前置门禁。

## 需求与 H1

`sg_change` 接受 feature / modify / fix 及 details；`sg_change_add` 是 feature 别名。`sg_change_propose` 覆盖功能、非功能、边界、失败场景及验收标准；`sg_change_questions` 收集真实答案，反述并 `sg_change_critique` 分析歧义、安全、性能、并发和测试盲区。

展示完整文档、验收标准与假设，再 `sg_request_h1` 请求可信人工审批。只有真实批准可冻结；模型同意、普通聊天或工具参数不能冒充回执。elicitation 不可用时明确保持 H1_PENDING / WAITING_FOR_USER。

## 实现与独立验证

H1 后 `sg_plan_generate` → `sg_plan_freeze_contracts` → `sg_test_design_prepare`，启动真实 specgate_test_designer 等待提交，再 `sg_test_design_freeze`。

`sg_development_prepare` 后真实前端 Agent 与后端 Agent 串行实现，再 `sg_development_run` 验证集成；不能模拟子代理或修改冻结测试。

独立 specgate_tester 对固定提交/worktree 执行 `sg_quality_run`，每条冻结用例、构建、覆盖率、HTTP 与运行证据绑定当前提交。跳过、取消、超时和未运行不得当通过，质量失败用 `sg_development_repair` 回实现方。

质量通过后真实 specgate_formatter 执行 `sg_format_run`，真实 specgate_reviewer 在固定格式化提交只读 `sg_review_prepare` / `sg_review_run`，阻塞 finding 用 `sg_development_rework` 返回实现方。

遵循 ProjectProfile、`docs/style.md` 和固定参考，扩展现有 `/api/sys/**` 模块。包为 `com.<company>.<business>`，Java/TypeScript/Vue 中文注释，i18n 默认 zh-CN 保留 en-US。GET 查询、POST 修改，更新/删除 id 在 JSON body，业务响应为 JSON，批准的文件传输除外。

## 验收与交付

`sg_review_request_h3` 获真实批准后 `sg_release_preview` 展示固定提交与证据，`sg_release_archive` 生成 DeliveryRecord、tag 和交付包。远程 URL 不等于推送授权，明确 `push=true` 才非强制推送。反馈通过 `sg_change` 引用 parentDeliveryId 与受影响/复用验收标准，不覆盖历史。

## 继续、暂停、取消

先读取明确 Change 当前版本，再 `sg_pause`、`sg_resume`、`sg_cancel` 传 expectedVersion。恢复原检查点，不新建重复 Change、不越过审批或重试失败推送；取消保留代码、分支、worktree 和证据。

异步任务读取 `sg_work_item_status` 并使用控制台受控 Decision，不能把 Change 控制冒充 WorkItem 调度成功。WAITING_FOR_USER 后停止，真实 Decision 后重新读取状态。缺 exec --json 或原生子代理就报告阻塞，不模拟角色。技术验证、人工验收、客户接受、推送与部署分别报告。

MCP 是权威状态源，禁止手改状态、事件链、冻结哈希或交付记录。
