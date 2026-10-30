---
name: sg-codex-project
description: 在 SpecGate Core 中绑定或接入已有 Git 项目并核验项目基线时使用。
---

# 已有项目接入

1. `sg_project_bind` 绑定用户给出的绝对路径；拒绝插件源码、缓存、文件系统根和不安全符号链接。
2. `sg_project_status` 读取项目栈、Git 与基线；`sg_adopt_preview` 只读列出接入计划和精确脏文件。
3. 仅在用户明确批准的文件集合上调用 `sg_adopt_commit_dirty`；然后 `sg_adopt_apply`，轮询 `sg_project_status` 直至真实基线完成。
4. 未通过基线时保持阻塞，报告真实失败命令与未执行项；生成或探测结果不能冒充通过。

新项目使用 `sg_project_create` 由用户选择目录与技术栈，默认仅准备环境，不生成业务模板；缺项转 `sg_env_prepare` 请求确切安装批准后复验。环境就绪不代表项目基线就绪，不自动配置六个历史 Agent。项目就绪后，已有业务需求转 `$sg-codex-change`；没有需求时等待用户提出。
