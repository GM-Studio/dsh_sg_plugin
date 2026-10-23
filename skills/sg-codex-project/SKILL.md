---
name: sg-codex-project
description: 需要新建或初始化 Java/Vue/React 业务项目、接入存量项目、配置项目 Agent/Skill/MCP 或补建项目基线时使用。
---

# SpecGate 项目准备

先只读 `sg_project_status` 核对业务项目路径；错误时按用户提供的绝对路径 `sg_project_bind`，不得绑定插件源码或缓存。项目准备不自动创建业务需求。

- 新项目：`sg_project_create` 中文表单收集目录、company/business、JDK/Spring Boot、Vue/React、必要的 Git 身份。路径留空使用绑定目录，不改父目录；只确认一次，失败保留选择。
- 返回 `ENV_*` 时用 `$sg-codex-env` 按保留选择预检补齐，再继续原创建请求，不重复表单。环境就绪后才能生成源码。
- 已明确给出全部参数：`sg_init_preview` → 展示预览 → `sg_init`，显式传 preset、frontend、company、business、previewHash。包为 `com.<company>.<business>`。
- 已生成未验证：优先继续 `sg_project_verify`（与 `sg_verify` 同一实现）→ `sg_project_finalize_new`，不再创建。宿主只投影项目工具时不得因此跳过验证。
- 存量工程：`sg_adopt_preview`，读取真实栈并补齐环境；按精确路径请求必要的脏文件批准，再 `sg_adopt_commit_dirty`、`sg_adopt_apply`。通过 `sg_project_status` 看基线结果，不对存量工程 `sg_init`。
- 缺配置：`sg_project_setup` 只补齐 Agent/Skill/MCP，保留冲突文件，不能把它描述为完整工具链安装。

六个真实 Agent：specgate_test_designer、specgate_frontend、specgate_backend、specgate_tester、specgate_formatter、specgate_reviewer。项目配置包含四个任务 Skill、统一导航和旧别名；宿主需要重载时明确说明。

生成不是验证。真实 `sg_project_verify` / `sg_verify` 后建立 ProjectProfile/ProjectBaseline。新项目本地演示管理员 `admin / admin`、只读账号 `viewer / viewer`；已有自定义 `.env` 必须保留，不能重置或仍宣称默认密码。

项目就绪且用户未给出需求时停下等待；已有明确需求交回 `$sg-codex-change` 澄清。表单不可用时保持待输入/待批准，不代选或伪造审批。不要求用户会话外运行安装脚本。
