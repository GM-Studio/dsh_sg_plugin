# 验收记录（v0.1.0 → v0.3.0）

日期：2026-10-18
环境：DSH `0.2.1-rc.2`；Node `v24.14.0`；Windows；profile `desktop`

## 1. 安装

- 命令：`plugin_manager install_bundle target=E:\ai_workflow\sg_dsh`
- 结果：`application: applied`；`bundle: dsh-plugin-specgate`；`version: 0.1.0`
- 插件行：`include:specgate` / `dsh-plugin-specgate` / `fiberPhase: active`
- 重载：`set_plugin include:specgate` 关闭再开启可加载新代码；无需重启 Host

## 2. 能力可见性

- 工具：`sg_status`、`sg_next`、`sg_gate`、`sg_deviation`、`sg_classify`、`sg_doctor`、`sg_propose`、`sg_archive`、`sg_init`、`sg_enable`、`sg_disable` 均出现在当前 Agent 的工具表。
- 技能：会话技能目录出现 30 个 `specgate-*` Skill；`sg-skill-entry-guard` 等可加载。
- 提示：进入含 `.specgate/` 的项目后，系统提示自动出现“SpecGate 工作流已启用 / 当前门控 / 下一步 / 硬规则”。

## 3. 门控拦截

测试项目：`openspec/changes/demo/`，仅有 `proposal.md`，G1/G2/G3 均未确认。

- 直接写 `design.md`：
  - 结果：拒绝。
  - 文案：`SpecGate 门控未通过：写入 openspec/changes/demo/design.md 需要先确认 G1 需求理解确认、G2 变更分类确认、G3 proposal 评审。`
- 写入 `.specgate/gates/G1.confirmed`、`G2.confirmed`、`G3.confirmed` 后重试：
  - 结果：允许。
  - 状态：`demo [tasking]`，`proposal=completed design=completed specs=not-started tasks=not-started`。
  - 下一步：`评审 design，确认 G4`。

## 4. 初始化

空项目（只有 `.git/`）执行 `sg_init`：

- `.specgate/`：`config.yaml`、`deviations.log`、`workflow-state.yaml`、`README.md`、`gates/`、`agents/`、`templates/`、`rules/`、`briefs/`、`out-of-scope/`、`experiences/`、`reviews/`
- `.dsh/skills/specgate/`：30 个技能，53 个文件
- `.specgate/agents/`：9 个 Agent 角色文本
- `.specgate/templates/`：10 个模板文件
- `.specgate/templates/commands|rules/`：12 个参考文件
- `.specgate/experiences/index.md`、`trigger-guide.md`；`.specgate/rules/` 5 个模块规则；`.specgate/briefs/README.md`；`.specgate/out-of-scope/README.md`（知识资产/模块规则共 9 个）
- `openspec/changes|specs|changes/archive/`
- `AGENTS.md`：创建并写入 `<!-- specgate:begin -->` 段落

第二次执行 `sg_init`：

- 技能新增 0、跳过 53；Agent 新增 0、跳过 9；模板新增 0、跳过 10；参考新增 0、跳过 12；知识资产/模块规则新增 0、跳过 9
- `AGENTS.md` 段落未重复
- 结论：幂等

## 5. 其他工具

- `sg_propose` 在 G1/G2 未确认时返回：`无法创建 proposal：缺少门控 G1、G2。请先完成 /sg-gate 确认。`
- `sg_doctor`：`materialized-skills: 30/30`，结论通过。
- `sg_disable`：状态变为 `启用：否`，提示注入消失。
- `sg_enable`：状态恢复 `启用：是`，提示注入恢复。
- `sg_deviation`：写入 `.specgate/deviations.log`，`sg_status` 偏离计数从 0 → 1。
- `sg_propose`（G1/G2 已确认时）：创建 `openspec/changes/demo-two/proposal.md`，状态出现两个 Change。

## 6. 自动化测试

命令：`node --test`

结果：**25 passed / 0 failed**。

覆盖：

- 状态推断（proposal/design/specs/tasks、项目状态）
- 门控确认/跳过/下游失效
- 写入拦截、L3 豁免、写后失效
- 初始化与幂等、AGENTS.md 只追加一次
- 插件装配（工具/命令/技能/提示/guard）
- 门控交互三分支（通过 / 需要修改 / 确认跳过）
- 失败工具输出可序列化为 lossless JSON

## 7. 未覆盖 / 限制

- `userQuestions` 的真实 UI 点击未在自动化中驱动；交互逻辑用模拟回答覆盖。
- 斜杠命令 `/sg-*`、`/sg-*` 已注册，但未通过 Web UI 命令面板逐条点击验证。
- 通过 shell（`pwsh` / `bash`）直接写文件绕过 `write`/`edit`，不被 guard 拦截。
- 9 个 Agent 目前是角色文本，不是独立 subagent。
- G6.5 Brief 为可选门控，默认不进入“待确认”列表。

---

## 8. v0.2.0 / v1.1 增量验收（2026-10-18）

### 8.1 安装与能力

- 先 `remove_bundle dsh-plugin-specgate`，再 `install_bundle E:\ai_workflow\sg_dsh`。
- 结果：`application: applied`；`version: 0.2.0`；`include:specgate` active。
- 工具：新增 `sg_commit`，共 12 个 `sg_*` 工具。
- 技能：30 个 `specgate-*` 仍可加载。

### 8.2 新建项目 + 默认 Git

命令：`sg_init { path: "demo-app" }`（在新目录 `\.specgate_v11_e2e` 下）。

- 新建目录：是；模式：full。
- Git：`git init` + 初始提交 `72826a0 chore(specgate): 初始化工作流项目`（111 个文件）。
- 生成：30 Skill（53 文件）、9 Agent、11 模板、12 参考命令/规则、9 知识资产/模块规则、7 文档模板、5 示例文件。
- `AGENTS.md`：完整规则（含 `## 门控`、Git 工作流、知识沉淀、命令速查）。
- 工作区：clean；`sg_status` 显示 `Git：master ｜ clean ｜ 最近提交：72826a0 ...`。
- `sg_doctor`：`git-repo` / `git-status` 均 OK，`materialized-skills: 30/30`。

### 8.3 minimal 与 no-git

- `sg_init { path: "mini-app", minimal: true }`
  - Git 初始提交 `8b78a89`（60 个文件）。
  - 30 Skill、`openspec/`、`experiences/index.md` + `trigger-guide.md`。
  - 无 `.specgate/agents`、无 `.specgate/templates`、无 `docs/`、无示例。
  - `AGENTS.md` 为精简规则（9 行，不含 `## 门控`）。
  - 修复报告文案后 `mini-app2` 显示 `AGENTS.md：已创建精简规则`，初始提交 `51ba1b8`。
- `sg_init { path: "nogit-app", minimal: true, git: false }`
  - 不生成 `.git`；`.specgate/config.yaml` 写入 `git: false`；报告 `Git：未启用（--no-git）`。

### 8.4 门控 clean 与提交

- 在 `demo-app` 写入 `note.txt` 后，提示注入显示 `Git：... ｜ dirty 1`。
- `sg_gate G1 confirm` 返回：
  `工作区有 1 个未提交改动；请先 commit（?? note.txt）。请先 /sg-commit <message> 或手工 git commit，再确认门控。`
- `sg_commit { message: "test: 添加门控 clean 验证文件" }`：
  `已提交 d078fc8：test: 添加门控 clean 验证文件（1 个文件）`。
- 再次 `sg_commit`：`没有可提交的变更。`
- 提交后提示注入恢复 `Git：master ｜ clean ｜ 最近提交：d078fc8 ...`。

### 8.5 自动化测试

命令：`node --test`

结果：**90 passed / 0 failed**。

新增覆盖：

- 命令完成后通过 `agent.followup` 把完整输出交回 agent（`source.kind=specgate`、`source.command=<命令名>`，消息本身是 `role=user`），由 agent 在对话里完整呈现并追问下一步
- 活跃会话同样交回（不再只剩命令卡片），新会话也不再被欢迎页遮住
- runtime 无 `followup` 或交回被拒时降级为 `notice`（`user/message`、`form=notice`、仅新会话）
- `agent.status === 'running'` 时绝不写消息（保护 `tool_use`/`tool_result` 配对）
- 失败命令同样交回 agent，并附带错误原文供 agent 转述
- 命令名符合 DSH 语法、无冒号别名、参数命令带 `input.hint`
- 命令服务晚加载时通过 `ctx.inject` 补注册，不会静默丢失
- 命令通道门控 `confirm --yes` / `waive --yes` 的显式确认路径
- 结构化确认超时 fail closed，不再无限等待
- 幂等：状态命令不重放缓存、追加命令 24h 去重、force、并发锁、只读命令不落盘
- 任务图：`[P]` / `depends` / `role` 解析、串行默认、波次、并发上限、依赖环报错
- 并行：worktree 并行/波次/依赖、重复派发跳过、合并冲突保留分支、非 Git 串行降级
- 体检：四维 reviewer Agent 并行结果合并
- Skill：30 个注册项都带 `source`，满足 DSH 加载校验
- `--path` 新建目录 + 默认 git init + 初始 commit
- `--minimal` / `--no-git` / 非空目录 `--force`
- 完整 `AGENTS.md` 备份/合并/去重
- 门控前 Git clean 检查、`--no-git` 警告
- `sg_commit` 工具提交与空提交
- 未初始化项目提示 `/sg-init`
- 归档清空门控、新建 Change 清空 G3-G11
- 勾选 tasks 不使 G6 失效；新增任务才失效
- L3 分类无需 G1；L3 可跳过 G3/G4/G5
- 测试文件识别仅限代码扩展名

### 8.6 真实 `test_project` 回归（2026-10-18）

- 路径：`E:\ai_workflow\test_project`
- 初始化：full 模式，`a64e3da` 初始提交（111 文件）；30 Skill / 9 Agent / docs / 示例。
- L1：`add-login` 全流程 G1-G11，proposal/design/specs/tasks/源码/归档通过。
- L2：`e2e-l2` 全流程 G1-G11 通过（脚本 `docs/specgate/e2e-three-paradigms.mjs`）。
- L3：`fix-login` / `e2e-l3` 在 G3/G4/G5 未确认时仍可写 design/specs/tasks；源码仍需 G6/G7。
- 初始化分支：minimal、no-git、`--force` 合并、AGENTS 备份、非空目录保护、disabled、幂等全部通过。
- 三范式脚本输出：`PASS L1 e2e-l1`、`PASS L2 e2e-l2`、`PASS L3 e2e-l3`、`ALL_PARADIGMS_PASS`。
- 结果：94 个 commit、6 个归档 Change、0 个活跃 Change、Git clean、`sg_doctor` 通过。
- 报告：`test_project/TEST_REPORT.md`。
- 覆盖率：行 81.05% / 分支 75.87% / 函数 75.32%（未达到 100%）。

### 8.7 v1.1 未覆盖 / 限制

- `userQuestions` 的真实 UI 点击未在自动化中驱动；门控交互用模拟回答覆盖。
- 斜杠命令 `/sg-*`、`/sg-*` 已注册，但未通过 Web UI 命令面板逐条点击。
- 通过 shell 直接写文件仍绕过 `write`/`edit` guard。
- 9 个 Agent 仍为角色文本，不是独立 subagent。
- 默认 `git init` 依赖系统 Git；无 Git 环境需 `--no-git`。
- 门控确认后写 marker 会使工作区变 dirty，下一次门控前必须提交；这是 v1.1 的刻意设计。
