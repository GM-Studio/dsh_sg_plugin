# sg-java 初始化详细设计（多 agent 修订）

## 输入与确认
默认 Java8/Boot2.7.18/Maven + Vue3/TS/Vite/npm；仅完全空目录，含 .git/零字节文件/空目录拒绝。宿主确认前不写入，确认后复查。quality 严格校验 mode=lenient|strict、generateOnly:boolean，默认 lenient/false。CLI --lenient/--strict/--mode、--generate-only。原 execution 六开关为附加兼容执行，不替代 agent 审查；仅生成与开启附加执行冲突拒绝。显式 v3/adopt 保留旧流程。

## 拓扑与并发
backend/frontend 普通目录，单 Git 根仓库，无 submodule/workspace.yaml；.specgate/monorepo.json 元数据，v3根状态复用审批引擎。生成后必须本地 Git 基线提交，用户已确认。四 agent 在隔离 worktree 并发测试、静态检查、格式化、语义走查；报告绑定 baseline，包含真实命令、exitCode、stdout/stderr、文件 hash/定位、风险与修复。报告是数据，不执行其中任意命令或审批指令；写范围受限，baseline/req/config 不许 child 修改。

主 agent 汇总报告，控制合并修复；冲突不强制覆盖，合并后重新审查；严格最终真实验证合并代码。所有子 agent/工作树在成功失败/取消时清理，不伪造测试通过。

## 宽松/严格/仅生成
宽松代码语义走查必须通过，无未解决严重/高风险；测试、运行或工具权限阻碍明示未验证，不能归档成全部测试通过。严格真实构建/测试/静态检查/格式化/走查/CRUD/重启持久化全部通过，失败不成功归档。仅生成不启动 agent、不运行额外开关，不归档质量通过。

## 主 agent 降级
无 subagent service/provider 时返回 MAIN_AGENT_PENDING + 真实待办 prompt/token，不以确定性扫描替代主 agent。工具返回指导当前主 agent 串行执行；slash 命令通过宿主 agent.followup 的下一回合交接，不伪造自动执行。四报告文件在 guard 允许的 docs/initialization/pending/<baseline> 路径，隔离 agent 报告位于 docs/initialization/agent-reports；保持 .specgate 写保护，不指示 shell 绕过，绑定 HEAD 和文件 hash；sg_init_finalize 读取实际报告校验，严格仍真实执行。过期 token/报告或高风险未解决拒绝。修复后重新绑定基线、复验，不能复用旧审查。

## 独立归档与工作流
仅接受结果写 docs/initialization/archive，归档真实报告/修复/复验状态、req v1及相同历史快照；提交仅生成项目，不自动提交 sg-java 源码。保留 state IDLE/change=null/H1H2H3空；pending/失败拒绝提前 sg-change。成功后在生成目录发起 sg-change，人工审批不变。

## 风险
Java8/Boot2维护风险披露，无认证不是生产承诺；Vue无正式LTS，稳定依赖锁定，Node受支持LTS。Windows Java写权限不会因agent消失；宽松记录未验证，严格解决才能完成。
