# 业务路径与 H1 会话恢复修复

## 问题与证据

- 本机 `E:\new_project\test_demo` 存在；当前插件连接仍返回 `PROJECT_NOT_BOUND`。
- 同一连接执行 `sg_project_bind` 成功，说明该 MCP 进程可以访问业务目录。
- 项目已有带 `--project-root` 的 `.codex/config.toml`，但当前连接仍以插件级 `specgate` 暴露工具；生成配置不等于当前连接已经加载配置。
- 当前可用工具缺少 `sg_state` / `sg_request_h1`，而已加载缓存的 `sg_change` 仍要求 request/type，不支持仓库已有的 request_h1 分支。不能仅凭版本号 0.3.3 判断缓存内容已同步。
- 原 `sg_project_status` 即使有活动需求也可能返回等待新需求，缺少恢复所需版本。

## 目标与设计

1. `sg_env_check` 增加可选绝对路径；显式路径通过既有业务目录校验后切换本会话绑定。路径不传时保留原行为，未绑定时不猜测插件目录。只读检查不写入配置。
2. `sg_project_status` 只读检查事件状态，返回 workflow 的 changeId/phase/version；H1_PENDING 返回同一需求的 `sg_change({ action: "request_h1", expectedVersion })` 参数。不得重复创建需求或将普通聊天作为审批。
3. 同步已修复的 H1 实现到实际加载的安装内容；已运行进程与工具 schema 需要宿主重新加载。保留旧缓存备份和用户业务状态，不自动实施业务需求。

## 验收与任务

- [x] 先用失败回归复现未绑定环境检查不接受路径、项目状态不暴露 H1 版本。
- [x] 实现环境路径绑定与状态恢复参数。
- [x] 定向验证路径错误不改变原绑定、检查不写入、H1 状态查询不改变事件状态。
- [x] 完整 test/lint/format:check/pack:check：以本次真实命令结果为准。
- [x] 同步安装内容并验证新进程握手；原会话原生审批弹窗不作为自动化测试通过项。

## 本次执行证据

- 定向回归 77 项通过，含本次新增两项恢复测试及已有 H1 审批安全回归。
- `npm test`：538 项，536 通过，2 跳过，0 失败，耗时约 102 秒；跳过项不作为验证通过证据。
- 当前已连接 MCP 执行 `sg_project_bind` 成功，随后 `sg_env_check` 返回 environmentReady=true、missing=[]，复用 Git / Node / JDK 8 / Maven；无安装。
- 备份并同步缓存中 8 个明确文件，未同步并行开发的控制平面/持久化改动。备份目录：`C:\Users\Administrator\AppData\Local\Temp\specgate-session-recovery-backup-4a3873df9dab4ffa990a63637a153946`。
- 从实际缓存启动新 stdio 进程，`tools/list` 证实 sg_request_h1、sg_change.action=request_h1、sg_env_check.path 均存在。只读状态证实原需求 dali-homestay-management 保持 H1_PENDING、version=11，并返回备用审批参数。
- lint、format:check、git diff --check 通过。pack:check 首次因默认 npm 缓存权限失败，指定本仓库既有 `.npm-cache` 后通过；未修改全局配置。
- 当前聊天仍使用启动时的旧工具声明。未运行桌面重载，也未验证真实审批弹窗；需宿主重新加载 SpecGate 连接后查看文档、继续同一需求。没有代替用户审批或开始业务实现。
