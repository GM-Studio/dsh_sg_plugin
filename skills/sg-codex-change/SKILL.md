---
name: sg-codex-change
description: 用户请求 SpecGate 新增功能、修改或修复已有功能，继续/暂停/取消明确任务，或对当前需求进行验收交付时使用。
---

# SpecGate 需求开发与任务控制

读取 `sg_state`、`sg_project_status` 和必要的 `sg_work_item_status`，多个任务时明确目标。查询进度转 `$sg-codex-status`，不编造示例需求。执行前使用 `$sg-codex-env` 环境门禁与 `$sg-codex-project` 项目基线能力，保留已有选择，需求可先澄清，实际实现和交付必须满足前置门禁。

## 需求与 H1

`sg_change` 接受 feature / modify / fix 及 details；`sg_change_add` 是 feature 别名。两者创建 Change 并进入 `REQ_CLARIFYING` 后，服务端必须立即发起原生澄清第 1 轮（5 个固定问题）。不得先自行 propose，也不得把模型推断当成用户回答。

固定流程：

1. `sg_change` / `sg_change_add` → 自动原生澄清第 1 轮。
2. 仍有歧义时，用 `sg_change_questions` 发起第 2 / 3 轮；每轮最多 5 问。选择题必须设置 `input: "choice"`（单选）或 `input: "multi-choice"`（多选）并提供 `options`，让宿主显示选择控件；文本填空使用 `input: "text"`（省略时也默认为文本框）。不得把选项只写进问题文字后要求用户手输。
3. 向用户展示真实回答，再 `sg_change_propose`，覆盖功能、非功能、边界、失败场景及验收标准。
4. 反向复述需求并执行 `sg_change_critique`，覆盖歧义、矛盾、不可行、非功能、安全/性能/并发及测试盲区。
5. `sg_change_critique` 写入包含完整需求、验收标准、假设、未决问题、风险和反向复述的 Markdown，返回 `H1_DOCUMENT_READY` 与 `document.absolutePath`。用绝对路径可点击链接交给用户查看、修改，不能只报告 H1_PENDING。该步骤不弹审批、不冻结需求。已有待审批需求尚无文档时，请求 H1 会在同一次调用内生成文档并打开审批。
6. 用户修改文档或提出修改意见后，读取修改内容，通过 `sg_change_propose` 更新提案并重新 `sg_change_critique` 生成新文档；禁止手改状态、候选 JSON 或审批指纹。文档直接编辑后旧审批会失效。
7. 用户查看文档后，调用 `sg_request_h1({ expectedVersion })` 立即打开可信审批表单。表单只展示变更目标、关键功能、核心要求、验收数量与全文跳转链接，不塞入完整文档，也不要求选择下拉项或填写审批意见。若当前宿主只暴露部分工具而没有该工具，直接用 `sg_change({ action: "request_h1", expectedVersion })` 请求同一审批，无需重复创建 Change。工具参数不接受审批决定；只有表单中的真实确认才能批准并进入 `REQ_FROZEN`。表单“拒绝”表示返回 `REQ_CLARIFYING`，关闭表单保留 `H1_PENDING`；如需终止需求，另行调用 `sg_cancel`。展示返回的明确操作结果，每次操作使用最新返回版本。

收到 `WAITING_FOR_USER`、`CLARIFICATION_REQUIRED`、`CLARIFICATION_PENDING` 或 `USER_INPUT_UNAVAILABLE` 时立即停止，不得继续 propose / critique / H1，也不得代替用户作答。待答轮次已持久化时，只能用 `sg_change_questions({ expectedVersion, round })` 恢复同一轮，不得新建重复轮次或 Change。

只有真实批准可冻结；模型同意、普通聊天或工具参数不能冒充回执。原生澄清或 H1 表单不可用时报告阻塞并保持待用户状态；重新加载 SpecGate 插件连接、新建会话后再继续。

## 实现与独立验证

H1 后 `sg_plan_generate` → `sg_plan_freeze_contracts` → `sg_test_design_prepare`。该工具会把完整挑战、工作区、角色配置和提交要求交给真实 specgate_test_designer；原生宿主不可调用时使用受控 `codex exec` 进程。只有返回真实提交后才调用 `sg_test_design_freeze`。

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
