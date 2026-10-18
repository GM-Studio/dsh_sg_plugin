# 插件架构（v0.3）

本文说明 `dsh-plugin-specgate` 的分层、扩展点与数据流。需求基线见
[requirements-confirmation.md](requirements-confirmation.md)。

## 1. 设计目标

- **Host-only 优先**：不依赖 Client 插件，不引入 Web UI 才能工作。
- **零外部运行时依赖**：只用 Node 内置模块，避免安装期网络与版本风险。
- **项目级 opt-in**：插件可安装到 profile，但只有检测到 `.specgate/` 或显式启用时才拦截写入。
- **文件即事实源**：`.specgate/` 与 `openspec/` 是状态来源；`.specgate/state/` 只保存可删除的幂等/派发记录，doctor 可审计。
- **可卸载**：删除插件后，项目文件仍可读；不生成只有插件能解析的必需文件。

## 2. 使用的 DSH 扩展点

| 扩展点 | 用途 | 失效时的降级 |
|--------|------|--------------|
| `ctx.tools.register` | `sg_status`、`sg_gate`、`sg_propose` 等工具 | 插件不可用（核心能力） |
| `ctx.tools.guard` | 写 `write`/`edit` 前检查门控 | 退化为软提醒 |
| `ctx.on('tools/post-execute')` | 写入成功后失效下游门控 | 门控可能过期，但不会误放行 |
| `ctx.systemPrompt.context` | 注入当前 Change、门控与下一步 | 仅少提示，不影响工具 |
| `ctx.commands.register` | `/sg-*`、`/sg-*` 命令 | 命令不可用，工具仍可用 |
| `ctx.skills.register` | 内置 30 个 Skill（运行时兜底） | 依赖项目 `.dsh/skills/specgate/` |
| `ctx.userQuestions.ask` | 门控确认/跳过的结构化提问 | 无法安全确认，fail closed |
| `ctx.agents.create` | `/sg-apply` worktree 子 Agent、`/sg-doctor` 并行体检 | 降级串行 / 本地 doctor |
| `ctx.inject` | 等待 `commands`/`skills`/`systemPrompt` 服务就绪 | 服务缺失时跳过对应能力 |

## 3. 模块

```text
index.js                 插件入口：apply + 注册/清理
src/
├── constants.js         门控定义、写入需求、范式豁免、源码/测试识别
├── util.js              文件、YAML 子集、路径、frontmatter
├── project.js           项目根、.specgate/config.yaml、启用与范式
├── gates.js             confirmed/waived 标记、缺失/失效
├── openspec.js          Change/Artifact 状态推断、propose/archive
├── status.js            状态汇总、下一步、提示文本、缓存
├── deviations.js        append-only 偏离日志
├── classify.js          L1/L2/L3 启发式
├── doctor.js            完整性/矛盾/格式检查
├── init.js              初始化、启用/停用、新建目录、AGENTS.md 合并
├── assets.js            技能/Agent/模板/文档/示例物化与内容适配
├── git.js               Git 仓库初始化、状态、提交
├── runtime.js           cwd 解析、写入门控、写后失效
├── gate-actions.js      门控 status/confirm/waive
├── idempotency.js       操作键、状态记录、24h 去重、并发锁
├── mutations.js         修改类命令的幂等执行与项目完整性判断
├── task-graph.js        tasks.md 的 [P]/depends/role 解析与波次
├── worktree.js          Git worktree 创建/合并/清理/冲突
├── dispatch.js          Agent 派发、worktree 编排、doctor 并行
├── tools.js             Tool 注册
├── commands.js          Command 注册
├── prompt.js            系统提示注入
├── guards.js            guard + post-execute
└── skills.js            运行时 Skill 注册
```

## 4. 门控模型

门控顺序（`GATE_ORDER`）：

```text
G1 需求 → G2 分类 → G3 proposal → G4 design → G5 specs → G6 tasks
→ G6.5 Brief（可选）→ G7 实施 → G8 审查 → G9 提交 → G10 验收 → G11 分支
```

写入前置条件（`ARTIFACT_REQUIREMENTS`）：

| 目标 | 前置门控 |
|------|----------|
| `proposal.md` | G1、G2 |
| `design.md` | G1、G2、G3 |
| `specs/**` | G1、G2、G3、G4 |
| `tasks.md` | G1、G2、G3、G4、G5 |
| 测试文件 | G1-G6 |
| 源码 | G1-G7 |

L3（缺陷修复）豁免 `G1`、`G3`、`G4`、`G5`、`G6.5`；因此源码写入只需 `G2`、`G6`、`G7`。

门控标记：

```text
.specgate/gates/G3.confirmed     # 确认（文件内容为 ISO 时间）
.specgate/gates/G3.waived        # 跳过（JSON: { at, reason }）
```

`invalidateFrom(gate)` 会删除该门控及其所有下游门控。例如修改 `proposal.md` 后，
`G3`-`G11` 全部失效，必须重新评审。

## 4.1 初始化与 Git

```text
/sg-init [--path <dir>] [--minimal] [--no-git]
  → 解析目标目录（当前目录或新建目录）
  → 非空 --path 需要 --force
  → 默认 git init（--no-git 跳过）
  → 生成 .specgate / .dsh/skills/specgate / openspec / AGENTS.md / agents / templates / docs / 示例
  → 工作区 init 前 clean：git add -A + commit "chore(specgate): 初始化工作流项目"
  → 工作区 init 前 dirty：跳过初始提交并报告，避免卷入无关改动
```

门控确认：

```text
sg_gate 工具
  → 前置门控检查
  → Git 仓库检查（--no-git 项目跳过并警告）
  → 工作区 clean 检查（dirty 则拒绝，不写 marker）
  → 结构化提问（askTimed，超时 fail closed）
  → 写 marker

/sg-gate <Gx> confirm --yes
  → 同样的前置/Git/clean 检查
  → 未带 --yes：只返回待确认提示，不提问、不写 marker
  → 带 --yes：直接写 marker
```

- `sg_commit` 工具/命令：`git add -A`（或指定 paths）+ `git commit -m`；不创建空 commit。
- 每次确认 Gate 都会写 marker，marker 是变更；下一次 Gate 前必须提交，因此每个 Gate 至少产生一次提交。
- `sg_status` / `sg_doctor` 展示分支、dirty 数量、最近提交。

## 4.2 幂等模型

```text
mutating command / tool
  → operationKey = sha256(projectRoot + command + normalizedArgs + target)
  → acquire lock in <tmp>/sg-locks/<key>.lock (wx; stale 10min)
  → state check (check target state)
      → already satisfied: return "幂等跳过"
  → append dedupe only (ttlMs > 0): .specgate/state/idempotency.json
      → success record 24h; --force bypasses
  → execute effect
  → record on success (append only)
  → release lock
```

- 只读命令不进入该流程。
- `.specgate/state/` 与 `.specgate/reports/` 自动写 `.gitignore`，不污染门控 clean 检查。
- 失败不写成功记录；锁在 `finally` 释放。
- 各命令的状态检查见 `src/commands.js` / `src/tools.js`；共享逻辑在 `src/mutations.js`。

## 4.3 多 Agent 并行

```text
/sg-apply <change> [--plan]
  → 解析 tasks.md: [P] + depends: + role:
  → buildWaves(maxConcurrency=4)
  → 每波：
      → 每任务 git worktree add .specgate/worktrees/<change>/<task>
      → 并发创建 9 角色 Agent（默认 developer / reviewer）
      → 收集结果
      → 顺序 merge --no-ff；冲突则停止并保留
      → 记录 .specgate/state/dispatch.json (contentHash + commit)
  → 写 .specgate/reports/<timestamp>-dispatch-<change>.md
```

- 非 Git 或 dirty：降级串行单写者。
- `/sg-doctor`：4 个 reviewer Agent 并行检查后合并 checks/issues。
- Agent 运行器：`ctx.agents.create({ parentAgent, meta.cwd, setup })` + `followup` + `whenIdle`；缺少 agents 服务时降级本地 doctor / 报错。

## 5. 写入流程

```text
write/edit 调用
  → tools.guard
     → 解析 file_path（相对 session cwd）
     → 不在项目根 / 项目未启用 / enforcement=advisory → 放行
     → classifyWrite:
          proposal | design | specs | tasks | test | source | null
     → requiredGatesFor(kind, paradigm)
     → missingGates
        → 有缺失：返回拒绝文本（含下一步）
        → 无缺失：放行
  → 工具执行
  → tools/post-execute
     → 成功且是受控路径：invalidateFrom(下游门控)
```

**已知边界**：通过 shell（`pwsh` / `bash`）直接写文件不经过 `write`/`edit`，不会被 guard
拦截。这与 SpecGate Qoder Hook 的覆盖范围一致。

## 6. 状态推断

- **Artifact**
  - proposal：存在且含 `## Intent` + `## Scope` → completed；存在 → drafting。
  - design：存在且含 `## Architecture` + `## Technical Approach` → completed。
  - specs：存在 `specs/**/spec.md` 且含 `## Requirements` + `Scenario:` → completed。
  - tasks：存在且有 `- [x]` 且无 `- [ ]` → completed。
- **Change**
  - tasks completed → implementing
  - design completed → tasking
  - specs completed → designing
  - proposal completed → specing
  - proposal drafting → proposing
- **Project**
  - 无活跃 Change 且 archive 有内容 → completed
  - 有 implementing → developing
  - 其余有 Change → planning
  - 无 Change 且 archive 为空 → idle

状态每次查询实时推断，带 400ms 进程内缓存；写入后主动失效。

## 7. 双轨技能

- **内置**：`assets/skills/**/SKILL.md`，插件启动时通过 `ctx.skills.register` 注册，
  作为全局兜底。
- **物化**：`/sg-init` 复制到 `<project>/.dsh/skills/specgate/<name>/SKILL.md`，可审计、可改。
- 项目文件优先级高于运行时注册；升级时 `init` 默认跳过已存在文件，避免覆盖定制。

## 8. 失败与降级

| 情况 | 行为 |
|------|------|
| `commands` 服务晚于插件加载 | `ctx.inject` 等待服务就绪后注册，不静默丢失 |
| `skills` 服务晚于插件加载 | 同上；服务缺失时只跳过运行时技能 |
| `userQuestions` 缺失 | `confirm`/`waive` 返回失败，不写标记（fail closed） |
| `userQuestions` 超时 | 返回 pending 提示，不写标记 |
| `systemPrompt` 缺失 | 不注入提示，门控仍由 guard 执行 |
| 项目未初始化 | 所有拦截放行；`sg_status` 提示 `/sg-init` |
| Git 不可用 | 初始化失败并提示 `--no-git`；`--no-git` 项目门控跳过 Git 检查并警告 |
| 工作区 dirty | 门控确认/跳过被拒绝；提示 `/sg-commit` |
| `.specgate/config.yaml` 损坏 | 按默认值处理，`doctor` 报告 |
| 命令执行完成（agent 空闲） | 通过 `agent.followup` 把完整输出交回 agent，由 agent 在对话中完整呈现并追问下一步 |
| runtime 无 `followup` 或交回被拒 | 降级为追加 `notice` 上下文消息（仅新会话），结果不丢失 |
| agent 正在运行 | 不追加任何消息，只显示命令卡片，保护 `tool_use`/`tool_result` 配对 |

## 9. 测试

- `test/state.test.js`：状态推断
- `test/gates.test.js`：门控确认/跳过/失效
- `test/git.test.js`：Git 初始化、状态、提交
- `test/guard.test.js`：写入拦截、L3 豁免、写后失效
- `test/init.test.js`：初始化、幂等、AGENTS.md 追加
- `test/init-v11.test.js`：`--path`、`--minimal`、`--no-git`、非空目录、AGENTS.md 备份合并
- `test/next-step.test.js`：下一步门控顺序（G1 → G2 → G3）
- `test/gate-actions.test.js`：门控交互三分支（通过 / 需要修改 / 确认跳过）
- `test/gate-git.test.js`：门控前 Git clean 检查与 `--no-git` 降级
- `test/lifecycle.test.js`：新建 Change 清空 G3-G11、归档清空全部门控
- `test/plugin.test.js`：模拟 Cordis 上下文，验证工具/命令/技能/提示/guard 注册、提交工具与输出可序列化
- `test/commands-report.test.js`：命令结果交回 agent、`notice` 降级、命令级幂等（init/deviation）
- `test/idempotency.test.js`：操作键、24h 去重、force、并发锁、只读不落盘
- `test/task-graph.test.js`：`[P]`/`depends`/`role` 解析、串行默认、波次、依赖环
- `test/dispatch.test.js`：worktree 并行/冲突/非 Git 降级、任务勾选、doctor 并行汇总

运行：`node --test`（当前 **90 passed / 0 failed**）。
