---
name: sg-codex-setup
description: SpecGate 项目准备辅助入口，仅初始化、接入或修复环境；统一向导会自动安排，无需用户先手动调用。支持 $sg-codex-setup。
---

# SpecGate 项目环境准备

这是辅助入口，仅负责项目准备，不接受业务需求或开始开发。推荐用户首次和后续都使用 `$sg-codex` 统一向导，由向导自动安排准备工作；不要求用户先后手动调用两个技能。

全程中文。新建表单只确认一次；路径可留空，留空使用当前绑定仓库并明确显示。初始化失败保留原技术栈和包名，修复原目录权限或路径后继续，不重新索要整张表单。已经生成的项目继续验证，不再次创建。非空目录保留已有文件并只补齐缺失项；已有完整业务工程则接入。

1. 读取 sg_project_status 并核对 projectRoot；目录错误时调用 sg_project_bind，使用用户提供的业务项目绝对路径。
2. 新建项目调用 sg_project_create，弹出中文表单选择目录、包名、技术栈和 Git 身份，确认后自动安装环境。不能替用户代选技术栈。
3. 现有项目或缺少 Agent/Skill 时直接调用 sg_project_setup；不要要求用户手工运行 PowerShell 或安装脚本。
4. 安装器保护已有配置，冲突时显示路径并保留原文件。确认六个 specgate_* Agent 以及 .agents/skills/sg-codex 和 sg-codex-setup；安装后的 Skill 可显式调用。若宿主需重载，告知用户新建该业务目录的 Codex 会话。
5. 当前宿主的 MCP 支持表单时使用 elicitation。不可用就明确告知，不能声称弹出了对话框，也不能伪造技术栈选择或用户审批。
6. 继续项目接入或验证：新项目 sg_verify 后 sg_project_finalize_new；现有项目 sg_adopt_preview 后走接入。生成不是验证。
7. ProjectProfile 与 ProjectBaseline 就绪后停下，等待用户提出需求，再澄清、反述和批判分析，提交 H1 人工审批。

源码安装脚本 scripts/codex-source-setup.mjs 仅供自动工具或维护诊断使用，普通用户流程无需手工执行。必要时由 Codex 执行 doctor 检查 plugin、exec --json、原生 subagents、elicitation，missing / not-probed 不能冒充可用。
