---
name: sg-codex
description: SpecGate 统一使用向导，首次与后续都从这里开始；自动安排项目准备，再等待用户需求、澄清及人工审批。支持 $sg-codex。
---

# SpecGate 中文项目交付

## 从这里开始

首次和后续使用都推荐只调用 `$sg-codex`。先用中文告知用户当前处于「项目准备」「就绪等待需求」或「需求交付」。`$sg-codex-setup` 是辅助入口，只负责初始化、接入和环境修复；本向导按需完成这些步骤，用户不必自行决定先后，也不要让用户分别调用两个技能来重复新建。

所有用户可见的引导、表单标题、说明、选项、审批文档和总结使用中文。代码标识、路径、命令、版本号及用户原文保持准确；不直接粘贴英文工具错误或内部 JSON 作为对话说明。

新建表单只填写确认一次；目录留空使用当前绑定仓库，明确显示实际路径，不擅自换成父目录。失败时复用工具保留的包名和技术栈，按原目录排查原因，不反复调用新建向导收集相同信息，不遗漏 JDK 8 + Spring Boot 2.7。只有用户明确换目录或要求重选才改选择。

若结果已有 `alreadyInitialized` 或项目状态显示已生成但未验证，继续验证；若提示接入已有工程，走接入流程。不能因为尚未就绪就再次新建。

SpecGate MCP 是项目就绪、需求、审批、证据与交付记录的状态源。禁止手工改写 .specgate/codex/state.json、事件链、冻结哈希和交付记录。

## 项目绑定与环境准备

先调用 sg_project_status，向用户展示 projectRoot。插件服务器脚本位于插件目录是正常的，业务状态必须指向业务项目。路径错误或返回 PROJECT_SOURCE_FORBIDDEN 时，用 sg_project_bind 指定用户的业务项目绝对路径；不得接入插件源码目录。

- 新建：调用 sg_project_create 请求中文配置表单，用户亲自选择目录、company、business、JDK/Spring Boot 和 Vue/React；复用 Git 环境或配置身份，缺失时向用户采集。禁止代选默认技术栈。
- 用户已明确提供所有参数时：sg_init_preview → 展示预览 → sg_init，两个工具都必须显式传入 preset、frontend、company、business。后端包为 com.<company>.<business>。
- 初始化自动安装六个项目 Agent、项目 Skill 和项目 MCP 配置。默认本地演示管理员为 `admin / admin`，只读账号为 `viewer / viewer`；在生成完成的中文说明中明确告知。已有自定义 `.env` 保留，不能擅自重置或宣称密码仍是默认值。
- 现有项目或 Agent 缺失：由 Codex 调用 sg_project_setup 自动补齐，保留已有配置和冲突文件；冲突应展示具体路径，不能直接覆盖。
- 安装后的 Skill 可用 $sg-codex 与 $sg-codex-setup 显式调用。宿主需要重新加载配置或新建会话时明确说明。

六个 Agent：specgate_test_designer、specgate_frontend、specgate_backend、specgate_tester、specgate_formatter、specgate_reviewer。不能把主线程模拟工作描述为子代理工作。

## 建立基线后停在就绪

新项目生成不代表验证通过：sg_init → sg_verify → sg_project_finalize_new，随后读取 sg_project_status。验证会有界发现并复用已安装 JDK/Maven/Node；工具链缺失时说明缺项，不能先要求用户下载或自选路径。

现有项目：sg_adopt_preview → 必要时按精确路径请求人工批准脏文件基线 → sg_adopt_commit_dirty → sg_adopt_apply。后者启动独立基线任务，通过 sg_project_status 查看完成或失败；不得对现有项目调用 sg_init。基线在临时 worktree 验证，不能把生成视为通过。

**项目就绪后必须停止自动推进，等待用户主动提出业务需求。** 不得编造简单示例需求、自动创建 Change 或开始开发。若用户已在当前会话明确提出需求，可按该需求进入澄清。

## 用户主导的需求与 H1

1. 用户提出业务需求后使用 sg_change（type 为 feature / modify / fix 及对应 details）；sg_change_add 仅是 feature 别名。
2. 根据真实用户输入提出 sg_change_propose，包括功能、非功能、边界、失败场景和可观察验收标准；模型假设必须明确标注为待确认。
3. 有阻塞问题时调用 sg_change_questions，请求宿主表单，收集用户的真实答案，禁止自行填写答案。
4. 反向复述每条需求，并用 sg_change_critique 批判分析歧义、冲突、不可行项、安全/性能/并发风险和测试盲点；有阻塞项就继续澄清。
5. 展示完整需求文档、验收标准、假设与风险，调用 sg_request_h1 请求人工审批表单。
6. 只有可信用户选择批准后才冻结需求。文字“到了 H1”或模型自己的同意不能代替用户审批。修改后必须重新评议和审批。

宿主没有 MCP elicitation 时，明确说明表单通道不可用并保持 H1_PENDING / WAITING_FOR_USER；不得谎称弹出对话框，不得伪造回执。异步模式在控制台的注意力队列显示审批表单。普通聊天回答只作为讨论，不冒充可信审批。

## 计划、实现与独立验证

H1 后依次 sg_plan_generate → sg_plan_freeze_contracts → sg_test_design_prepare，在返回 worktree 启动真实 specgate_test_designer，等待其提交，再 sg_test_design_freeze。测试成功必须来自可执行证据。

sg_development_prepare 后按计划先启动前端 Agent，等待提交，再启动后端 Agent；最后 sg_development_run 验证路径、提交、祖先关系与串行集成。不能并发实现前后端，也不能改写冻结测试。

集成后启动 specgate_tester，给出当前版本、固定 integration/test worktree、冻结 AC 和测试清单，不用实现者自评作证。Tester 执行 sg_quality_run。每个冻结用例必须执行通过，构建、测试、覆盖率和 HTTP/运行证据须绑定当前提交。已知基线失败与新失败分开记录，跳过、取消、超时和未运行不得当通过。

质量失败用 sg_development_repair 返回归属实现 Agent。质量通过后启动 specgate_formatter 执行 sg_format_run，再启动 specgate_reviewer，在固定格式化提交只读执行 sg_review_prepare / sg_review_run。阻塞 finding 用 sg_development_rework 返回实现方。

## 代码与开发启动约定

- 后端新增文件遵循 ProjectProfile 包与目录，禁止 com.example.*；读取 docs/style.md，遵循 .specgate/examples/ 的固定参考，不能改快照隐藏偏离。
- 扩展已有 /api/sys/** 用户、角色、部门、菜单、只读审计和仪表盘模块，CSV 传输遵循已有契约。
- Java、TypeScript、Vue 使用中文注释；前端显示文字使用 i18n，默认 zh-CN 并保留 en-US。
- npm run dev 仅启动前端，不需要 Java。npm run backend 启动后端，npm run dev:all 联合启动。
- npm run configure 补齐本地 .env，保留已有配置；Spring Boot 与启动脚本自动读取。必须保留密码长度校验。

## H3、交付与增量反馈

sg_review_request_h3 请求人工验收，只有用户批准后才能归档；sg_release_preview 展示固定提交、文件和证据，sg_release_archive 生成 DeliveryRecord、本地 tag、内部与客户交付包。远程 URL 不代表推送授权，只有用户明确要求 push=true 才能非强制推送。

客户反馈用 sg_change 引用 parentDeliveryId，并提供 impact.affectedAcIds；reusedAcIds 必须属于受影响且被接受的父验收标准。执行受影响回归，保留历史交付，不覆盖记录。

## 异步控制与恢复

SPECGATE_CONTROL_MODE=1 时先读取 sg_work_item_status。到 H1/H3 返回 WAITING_FOR_USER 后立即停止，不重试门禁、不保持连接、不编造审批；supervisor 收到真实 Decision 后恢复，重新读取状态和文档版本。

控制面默认 aggregate 共用管理端口，也支持 isolated 项目隔离。doctor 报告 available / missing / not-probed；未探测按不可用。缺少 exec --json 阻止交付；缺少原生 subagents 不得模拟角色；缺少 elicitation 保持人工门禁待决。

所有证据绑定固定提交和内容哈希；保留 worktree、失败日志与 Review，测试替换保留历史清单。技术验证、人工验收、客户接受、推送和部署是不同状态。
