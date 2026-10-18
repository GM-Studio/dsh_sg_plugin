# SpecGate for DSH

把 AgentKit47 的门控式开发工作流迁移到 DeepSeek Harness（DSH）的 Host 插件。

- 来源：`AgentKit47-Qoder` 的 `templates/qoder/`（MIT）
- 目标：DSH `0.2.1-rc.2` 及以上
- 形态：workspace bundle，安装到当前 DSH profile；**按项目 opt-in 激活**
- 版本：`1.0.0`

## 能力

- **插件内建初始化**：`/sg-init` 在当前目录生成 `.specgate/`、`openspec/`、`AGENTS.md`、30 个 Skill、9 个 Agent、模板、文档与示例；默认执行 `git init` 并创建初始 commit。
- **新建项目目录**：`/sg-init --path <dir>` 创建目录并初始化。
- **轻量模式**：`--minimal` 只生成骨架、30 Skill、`openspec/`、精简 AGENTS.md。
- **完整 AGENTS.md**：已有文件先备份，再合并/替换 SpecGate 段落，不覆盖用户内容。
- **Git 提交纪律**：门控确认前工作区必须 clean；`/sg-commit` 提交当前变更。
- G1-G11 门控：写入硬阻断 + 阶段推进软提醒（混合模式）。
- L1/L2/L3 变更分类：L1 需求驱动、L2 技术实现、L3 缺陷修复。
- OpenSpec 状态推断：proposal / design / specs / tasks、项目状态、下一步。
- 偏离日志：`.specgate/deviations.log`，跳过门控必须记录。
- **DSH 输出适配**：命令结果显示为持久命令卡片；空会话额外写入一条 `notice` 上下文消息，避免结果被欢迎页遮住；工具结果显示为工具卡片。**不再向会话注入合成 assistant 消息**，不会破坏 `tool_use` / `tool_result` 配对。
- **修改命令幂等**：状态检查优先；追加类操作记录 24h 去重；并发锁防止重复执行；只读命令不落盘、不加锁。
- **多 Agent 并行**：`/sg-apply` 按 `tasks.md` 的 `[P]` / `depends` 分波次，9 个角色 Agent、默认并发 4、每任务独立 worktree；`/sg-doctor` 四维并行体检。
- 命令：`/sg-init`、`/sg-status`、`/sg-next`、`/sg-gate`、`/sg-commit`、`/sg-deviation`、`/sg-classify`、`/sg-doctor`、`/sg-enable`、`/sg-disable`、`/sg-migrate`、`/sg-propose`、`/sg-apply`、`/sg-archive`、`/sg-explore`
- 工具：`sg_status`、`sg_next`、`sg_gate`、`sg_commit`、`sg_deviation`、`sg_classify`、`sg_doctor`、`sg_init`、`sg_enable`、`sg_disable`、`sg_migrate`、`sg_propose`、`sg_archive`

## 安装

### 从 npm 安装

```text
plugin_manager install_bundle target=dsh-plugin-specgate
```

插件管理器会把 `dsh-plugin-specgate` 加入当前 profile。启用、禁用、卸载都在 DSH 插件管理器中完成。

### 从本地目录安装

```text
plugin_manager install_bundle target=E:\ai_workflow\specgate
```

### 启动与关闭

SpecGate 是 Host 插件，没有独立后台进程。“启动/关闭”分两层：

- **全局**：在 DSH 插件管理器中启用/禁用/卸载 `dsh-plugin-specgate`。
- **项目级**：`/sg-enable`、`/sg-disable`。只切换门控与提示，保留 `.specgate/` 与 `openspec/` 文件。

安装后插件行 `include:specgate` 会出现在当前 profile。它默认**不会**拦截所有项目：只有检测到项目根 `.specgate/` 或执行 `/sg-enable` 后才激活。

## 从 `.ak47/` 迁移

```text
/sg-migrate --dry-run     # 只查看计划，不改文件
/sg-migrate               # 备份 .ak47/，迁移到 .specgate/，重写受管资产
/sg-migrate --force       # .specgate/ 已存在时重新迁移（先备份目标）
```

- 旧目录重命名为 `.ak47.backup-<timestamp>`，不会删除。
- 迁移 gates、deviations、config、state、agents、skills、rules 与 docs。
- `AGENTS.md`、`.dsh/skills/**`、`openspec/**` 等受管文件中的旧命令/路径会被重写。
- 已有 `ak47/*` worktree/分支不会自动移动，迁移报告会列出。
- 报告写入 `.specgate/reports/migrate-<timestamp>.md`。

## 配置

全局默认值位于 DSH profile 的插件 config：

```yaml
- id: specgate
  name: 'dsh-plugin-specgate'
  config:
    defaultEnabled: true
    enforcement: hybrid
    maxConcurrency: 4
    git: true
    language: zh
    materializeSkills: true
    materializeAgents: true
```

项目配置位于 `.specgate/config.yaml`，覆盖该项目的全局默认值：

```yaml
version: 1
enabled: true
enforcement: hybrid
paradigm: null
language: zh
git: true
minimal: false
maxConcurrency: 4
materializeSkills: true
materializeAgents: true
```

优先级：**项目配置 > 全局插件 config > 内置默认值**。全局默认只用于新项目初始化，不会静默改写已有项目。

- `language`：`zh` / `en`，默认 `zh`；选择运行时 Skill/Agent/docs 内容与命令结果/报告语言。
- `maxConcurrency`：默认 4，供 `/sg-apply` 与 `/sg-doctor` 使用。
- `materializeSkills` / `materializeAgents`：关闭时只用运行时注册，不物化到项目。
- `defaultEnabled`：`/sg-init` 写入的初始 `enabled`，默认 `true`。

## 多语言

SpecGate 资产为双语：英文 `*.md` 与中文 `*.zh.md`。中文为权威源，英文为完整翻译；运行时按 `language` 选择。已有项目切换语言后，执行 `/sg-init --force` 重新物化 Skill/Agent/docs。

```text
/sg-init --force
```

## 快速开始

```text
/sg-init                       # 当前目录初始化；默认 git init + 初始 commit
/sg-init --path my-app         # 新建目录并初始化
/sg-init --minimal             # 轻量骨架
/sg-init --no-git              # 不创建 Git 仓库
/sg-status                     # 项目/Change/门控/Git 状态
/sg-commit "chore: 初始化"     # 提交当前变更
/sg-gate G1                    # 查看 G1
/sg-gate G1 confirm --yes      # 明确确认 G1（命令通道）
/sg-classify 新功能 ...         # 建议 L1/L2/L3（需 G1 已确认）
/sg-propose add-login          # 创建 OpenSpec change 骨架（需 G1/G2）
/sg-apply add-login --plan     # 只查看并行任务计划
/sg-apply add-login            # 执行：按 [P]/depends 并行派发 9 个角色 Agent
/sg-migrate --dry-run          # 预览从旧 .ak47/ 项目迁移
```

`tasks.md` 的并行写法：

```markdown
- [ ] T1 实现登录接口 [P]
- [ ] T2 实现登录页面 [P]
- [ ] T3 集成登录流程 depends: T1,T2 role: reviewer
```

没有 `[P]` / `depends` 时默认串行；`/sg-apply` 默认执行实现，`--plan` 只查看计划。

`sg_init` 工具也支持同样参数：`path`、`minimal`、`force`、`git`、`example`、`docs`、`disabled`。

## 门控、Git 与写入

| 写入目标 | 前置门控 |
|----------|----------|
| `openspec/changes/<c>/proposal.md` | G1 需求确认、G2 分类确认 |
| `design.md` | G1、G2、G3 proposal 评审 |
| `specs/**` | G1、G2、G3、G4 design 评审 |
| `tasks.md` | G1、G2、G3、G4、G5 specs 评审 |
| 源码 | G1-G7（L3 下 G1/G3/G4/G5 可跳过） |
| 测试文件 | G1-G6（TDD RED 先于 G7） |

门控确认有两条 DSH 原生路径：

- `sg_gate` 工具（模型调用）走结构化问答，弹出“通过 / 需要修改”；
- `/sg-gate <Gx> confirm --yes` 命令走显式命令行确认。未带 `--yes` 时只返回“待确认”与操作提示，**不会**在命令通道里打开一个可能不可见的问题。

跳过门控必须同时提供原因与 `--yes`，例如 `/sg-gate G4 waive --yes 用户明确要求跳过`。

## 输出显示（DSH 适配）

| 入口 | 显示方式 | 历史 |
|------|----------|------|
| `sg_*` 工具 | 工具结果卡片（成功/错误文本） | 会话日志持久化 |
| `/sg-*` 命令 | DSH 持久命令卡片，可展开完整文本 | `command/run` + `command/done` |
| 新会话中的第一条命令 | 额外写入一条 `notice` 上下文消息，确保离开欢迎页并显示结果 | `user/message`（source.kind=`specgate`） |

设计约束：

- 只在 agent 空闲且会话还没有任何消息时追加 `notice`；活跃会话只显示命令卡片，不重复写历史。
- 绝不在工具调用与工具结果之间追加消息。旧版本曾注入合成 `assistant/message`，会导致 `tool_use` 没有紧邻的 `tool_result`，使后续请求直接 400。
- 命令异常同样有输出：返回 `kind: 'error'`，空会话同样写入错误 `notice`。

## 幂等保护

| 类型 | 命令 | 行为 |
|------|------|------|
| 状态修改 | init / enable / disable / gate confirm / gate waive / classify --apply / sg-propose / sg-archive | 先检查目标状态；已达成返回“幂等跳过”，不重复写文件 |
| 追加修改 | deviation | `.specgate/state/idempotency.json` 记录 24h；同命令+参数不重复追加；`--force` 可显式重复 |
| Git 提交 | commit | 无变更返回“没有可提交的变更”；并发提交加锁 |
| 只读 | status / next / doctor / classify（无 --apply）/ gate status / sg-apply（无 name）/ sg-explore | 不建状态文件、不加锁 |

- 锁位于系统临时目录，避免污染项目工作区；状态文件位于 `.specgate/state/`，该目录自动写入 `.gitignore`。
- 失败不记录成功状态；修复后可直接重试。
- 相同操作并发时只有一个执行，其余返回“相同操作正在执行”。

## 多 Agent 并行

- `/sg-apply <change>`：读取 `tasks.md`，按 `[P]` / `depends` 分波次；每波最多 4 个 Agent；每个任务独立 Git worktree 和分支。
- 9 个角色来自 `.specgate/agents/`；任务可用 `role: reviewer|architect|ddd|...` 指定，默认 `developer`。
- 每波完成后顺序合并；冲突时停止合并并保留全部 worktree/分支，返回冲突文件。
- 成功任务自动勾选 `tasks.md` 并提交 `chore(specgate): mark <change> tasks done`；失败任务保持未勾选。
- 非 Git 项目或工作区 dirty：自动降级为串行单写者，并在结果中说明原因。
- `/sg-doctor`：结构/Git、门控/Artifact、偏离/幂等、Skill/Agent 四个维度由 reviewer Agent 并行检查后汇总。
- 结果同时输出到命令卡片、`notice`（空会话）和 `.specgate/reports/<timestamp>-dispatch-<change>.md`。

**提交纪律（门控级强制 clean）**：

1. `sg_gate confirm` / `waive` 前检查 `git status`；工作区有未提交改动则拒绝。
2. 确认门控会写 `.specgate/gates/<Gx>.confirmed`，该 marker 本身也是变更；下一次门控前必须提交。
3. 用 `/sg-commit <message>` 或 `sg_commit` 工具提交；消息遵循 Conventional Commits。
4. 跳过门控还必须：用户明确选择“跳过”、提供原因、写入 `.specgate/deviations.log` 和 `.specgate/gates/<Gx>.waived`。

## 文件布局

```text
.specgate/
├── config.yaml
├── gates/G1.confirmed
├── deviations.log
├── state/                  # idempotency.json / dispatch.json / .gitignore
├── worktrees/              # 并行任务的 Git worktree
├── reports/                # 并行派发报告
├── agents/
├── templates/
├── rules/                  # CLI / core / tests / types / docs 模块规则
├── briefs/
├── out-of-scope/
├── experiences/            # index + trigger-guide + 四类知识目录
└── backups/                # AGENTS.md 合并前备份
.dsh/skills/specgate/<skill>/SKILL.md
openspec/changes/<change>/{proposal.md,design.md,tasks.md,specs/**}
docs/prd/vision.md
docs/architecture/01-system-overview.md
docs/specgate/examples/example-change/
CONTEXT.md
.git/
```

## 验证

- 已在当前 DSH profile 安装成功（`application: applied`）。
- 30 个 Skill 出现在会话技能目录；13 个 `sg_*` 工具可调用。
- 真实拦截：G1/G2/G3 未确认时写 `design.md` 被拒绝；写入标记后放行。
- 真实初始化：空项目生成 30 Skill / 9 Agent / OpenSpec / 完整 AGENTS.md / docs / 示例 / Git 初始 commit。
- 门控 clean：G1 确认后 marker 使工作区 dirty，G2 确认被拒绝；提交后通过。
- 输出回归：新会话命令写入 `notice`；活跃会话不重复写历史；运行中的 agent 不写消息；失败命令同样有输出；自动化测试覆盖“绝不注入合成 assistant 消息”。
- 幂等回归：状态命令不重放缓存、追加命令 24h 去重、force 可重复、并发锁互斥、只读命令不落盘。
- 并行回归：worktree 并行/波次/依赖、重复派发跳过、合并冲突保留分支、非 Git 降级、doctor 并行汇总。
- 自动化测试：`node --test` → **85 passed / 0 failed**。

完整记录见 [verification.md](docs/design/verification.md)。

## 已知限制

- 写入拦截覆盖 `write` / `edit` 工具；通过 shell 命令直接写文件不会被拦截。
- 初始化默认要求 Git 可用；无 Git 环境使用 `--no-git`，但提交纪律不生效。
- 门控 clean 检查会在 marker 写入后留下未提交改动，这是刻意设计：每个门控至少产生一次提交。
- `commands` / `skills` / `systemPrompt` 是可选服务：插件通过 `ctx.inject` 等待它们就绪；composed 环境缺少某个服务时只跳过对应能力，工具与门控仍可用。
- 并行 worktree 要求工作区 clean；dirty 或非 Git 项目自动降级串行，不隔离未提交改动。
- 合并冲突时不会自动解决；worktree 和分支会保留，需人工合并后重新执行 `/sg-apply`。
- 9 个 Agent 并行会消耗更多模型调用与 token；默认并发 4，可在 `.specgate/config.yaml` 用 `maxConcurrency` 调整。
- 幂等 `--force` 只对追加类（deviation）开放；状态类命令通过删除目标文件/标记自然重跑。
- 不替代 AgentKit47 CLI 的 `init/upgrade/doctor/validate`；SpecGate 是 DSH Host 插件，不是独立 CLI。
- G6.5 Brief 为可选门控，默认不进入“待确认”列表。
- 插件不提供 MCP server 或 MCP 工具；DSH 侧的 MCP 能力与本插件相互独立。
- **升级提示**：前身插件 0.2.0 早期构建中的 `ak47_selftest_append` 会污染会话日志；升级后请在新会话中继续，旧会话若已出现 `tool_use` / `tool_result` 400 错误不要复用。

## 开发

```bash
node --test
```

## License

MIT，基于 AgentKit47-Qoder 的模板与工作流设计。
