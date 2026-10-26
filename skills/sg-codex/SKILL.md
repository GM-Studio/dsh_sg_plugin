---
name: sg-codex
description: 在 Codex 中使用 SpecGate Core、寻找入口或按当前项目阶段继续时使用。
---

# SpecGate Core 导航

第一版只处理**已有 Git 项目**的本地可靠交付。先用 `sg_status` 和 `sg_project_status` 读取事实；未绑定时用 `sg_project_bind` 指向用户指定的业务项目绝对路径。

| 意图                           | 入口                |
| ------------------------------ | ------------------- |
| 检查已有 JDK、Maven、Node、Git | `$sg-codex-env`     |
| 绑定或接入已有项目             | `$sg-codex-project` |
| 需求、实现、验证与交付         | `$sg-codex-change`  |
| 只读进度、阻塞和证据           | `$sg-codex-status`  |

默认工具不提供新建项目、自动安装、异步 WorkItem、远程 Decision、Web 管理或生产部署。历史实现保留在源码的显式可选模式，未作为 Core 发行验收。H1/H3 只接受可信宿主审批；不得修改状态、事件、冻结文件或交付证据来代替工具执行。
