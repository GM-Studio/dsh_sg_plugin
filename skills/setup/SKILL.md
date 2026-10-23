---
name: sg-codex-setup
description: 用户仍通过旧的 $sg-codex-setup 请求环境修复、初始化或项目接入时使用的兼容入口。
---

# SpecGate 准备入口兼容转接

只解释一次旧入口现转到明确的准备能力，不维护另一套执行流程。

- 缺 JDK/Maven/Node、环境自检、安装或诊断：读取并使用 `$sg-codex-env`。
- 新建、初始化、存量接入、Agent/Skill/MCP 配置：读取并使用 `$sg-codex-project`，由项目入口按需衔接环境准备。
- 意图不明确：先只读 `sg_status` 并做必要澄清。
- 业务需求：说明应使用 `$sg-codex-change`，不在准备别名里开始开发。

调用旧入口不等于安装确认或 H1/H3 审批。保留技术栈选择，不能重复表单、初始化或安装。不要求用户离开 Codex 执行外部安装脚本。
