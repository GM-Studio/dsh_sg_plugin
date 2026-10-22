# 变更记录

## 未发布

- 增加新项目与存量项目接入，以及 ProjectProfile 和 ProjectBaseline。
- 增加脏工作区显式文件批准提交和 known-failures 基线。
- 增加 detached 临时 worktree 基线执行、可轮询进度、命令证据落盘和成功后
  运行状态清理。
- 增加 lockfile 驱动的 install 命令发现，并只通过显式路径提交稳定的
  SpecGate 元数据。
- 增加统一 `sg_change`，支持 feature、modify 和 fix。
- 实现串行执行、环境指纹、证据充分性和 Flaky Test 显式记录。
- 增加不可变 DeliveryRecord、本地 tag、内部/客户交付包、增量再交付和显式
  非强制推送。
- 增加 Codex 源码加载、项目级 MCP、六个真实 subagents 和交互式 H1/H3 审批。
- 增加测试先行、前后端独立 worktree 并行、质量门、格式化、严格 Review 与自动回修闭环。
- 增加冻结测试受控替换和原生 runner 兼容层。
- 将所有共享运行时依赖迁移到 `src/codex/core/`。
- 删除与 Codex 插件无关的旧入口、测试、资产和历史验证数据。

## 0.3.0

- Codex Java/Vue 初始化、真实验证与可审计工作流状态。
