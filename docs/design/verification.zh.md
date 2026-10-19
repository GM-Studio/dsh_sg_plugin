# 验收记录（v0.1.0 → v3.6.0）

日期：原始记录为 2026-10-18；第 1 部分的当前能力面按 `dsh-plugin-specgate` `3.6.0` 复核
环境（2026-10-18 记录时）：DSH `0.2.1-rc.2`；Node `v24.14.0`；Windows；profile `desktop`

> **本文档一半是当前参考，一半是历史存档。**
> **第 1 部分**描述 v3.6 当前能力面，以此为准。
> **第 2 部分**是 2026-10-18 的原始验收日志（v0.1.0 – v1.1），仅作追溯保留。
> 它描述的能力面已不存在：旧一代 `sg_*` 工具、`G1`–`G11` 门控、
> `L1`/`L2`/`L3` 变更分类、`.specgate/agents/`、`.specgate/deviations.log`、
> `.dsh/skills/specgate/`，以及“会话技能目录出现 30 个 `specgate-*` 技能”。这些在 v3.6 中均不成立；
> 第 2 部分若有与第 1 部分冲突之处，以第 1 部分为准。

---

# 第 1 部分 — 当前能力面（v3.6.0）

以下结论经阅读源码与运行测试套件复核。

## 命令与工具

- **斜杠命令：共 5 个** — `/sg-init`、`/sg-change`、`/sg-status`、`/sg-context`、`/sg-skill`
  （见 `src/v3/commands.js`）。
- **工具：共 6 个** — `sg_init`、`sg_change`、`sg_status`、`sg_skill`、`sg_run`、`sg_approve`
  （见 `src/v3/tools.js`）。
- 仓库中出现的其他 `/sg-*` 名称 —— `/sg-run`、`/sg-approve`、`/sg-gate`、`/sg-apply`、
  `/sg-commit`、`/sg-doctor`、`/sg-enable`、`/sg-disable`、`/sg-migrate`、`/sg-test`、
  `/sg-propose`、`/sg-archive`、`/sg-explore`、`/sg-next`、`/sg-classify`、`/sg-deviation` ——
  指的是**工具**，不是已注册的斜杠命令。第 2 部分若称某命令“已注册”，应理解为“存在同名工具”。

## 门控与阶段

- 人工门控为 `H0`、`H1`、`H2`、`H3`；质量门控为 `M1`、`M2`。不存在 `G1`–`G11`，
  运行时也没有 `L1`/`L2`/`L3` 分类。
- 阶段机：`IDLE` → `H0_PENDING` → `H1_PENDING` → `PLAN` → `H2_PENDING` → `EXECUTING` →
  `INTEGRATING` → `H3_PENDING` → `ARCHIVING`，另有 `BLOCKED` 与终态 `DONE` / `ABORTED`。

## 技能

- **随插件资产发布 22 个技能**：`assets/skills/` 下 17 个 `sg-skill-*`，`assets/sp/` 下
  5 个 `sp-skill-*`。命名前缀是 `sg-skill-*` / `sp-skill-*`，不存在 `specgate-*` 技能前缀。
- **技能不会注册进 DSH 会话技能目录。** `index.js` 声明的是 `inject = ['tools', 'agents']`
  ——没有 `skills`，也没有 `systemPrompt`——且 `src/` 与 `index.js` 中没有任何代码调用
  `skills.register` / `skills.registerProvider`；也没有任何代码写入 `.dsh/skills/specgate/`。
- 技能真正的用途：按 `src/v3/skills.js` 的角色/阶段映射，把技能正文注入**子 Agent 提示词**。
  `sg_skill` 工具与 `/sg-skill` 命令可在需要时打印技能正文。

## Agent

- 不存在 Agent 目录。`src/v3/pool.js` 的 `ROLE_PROMPTS` 只有 `implementer` 与 `tester`。
  11 个 `sg-agent-*` 资产从未接入任何代码，现已删除；第 2 部分中任何 `sg-agent-*` 或
  `.specgate/agents/` 引用都是悬空引用。

## 初始化

- `/sg-init` 只生成很小的骨架：`.specgate/`（含 `worktrees/`、`evidence/`、`backups/`）、
  `openspec/{specs,changes}/`、`config.yaml` 和两个 `.gitkeep` 文件。它**不会**生成技能、
  Agent、模板、文档、示例，也不生成物化技能目录树。
- 在全新项目上批准 `H0` 会额外写入恰好 5 个文件 —— `.specgate/project-context.md`、
  `AGENTS.md`、`docs/glossary.md`、`docs/adr/0001-initial.md`、`.github/workflows/ci.yml`
  —— 外加一个示例变更。

## 测试

- **265 passed / 0 failed**（`node --test`）。此结论取代第 2 部分记录的 25 项与 90 项。

---

# 第 2 部分 — 历史验收日志（v0.1.0 – v1.1，2026-10-18）

> 以下内容为按原样保留的旧日志，**不是**当前插件的描述：其中的命令/工具数量、`G1`–`G11`
> 门控、`L1`/`L2`/`L3` 分类、`specgate-*` 技能目录、`.specgate/agents/`、
> `.specgate/deviations.log`，以及初始生成的技能/Agent/模板/文档/示例目录树，都已在 v3.6
> 移除或替换。日志中的技能数与测试数只属于当时版本。当前事实见第 1 部分。

## 1. 安装

- 命令：`plugin_manager install_bundle target=E:\ai_workflow\sg_dsh`
- 结果：`application: applied`；`bundle: dsh-plugin-specgate`；`version: 0.1.0`
- 插件行：`include:specgate` / `dsh-plugin-specgate` / `fiberPhase: active`
- 重载：`set_plugin include:specgate` 关闭再开启可加载新代码；无需重启 Host

## 2. 能力可见性

- 工具：`sg_status`、`sg_next`、`sg_gate`、`sg_deviation`、`sg_classify`、`sg_doctor`、`sg_propose`、`sg_archive`、`sg_init`、`sg_enable`、`sg_disable` 均出现在当前 Agent 的工具表。*（v3.6 更正：这些属于已被移除的一代工具；当前插件只注册 6 个工具 —— `sg_init`、`sg_change`、`sg_status`、`sg_skill`、`sg_run`、`sg_approve`。）*
- 技能：会话技能目录出现 30 个 `specgate-*` Skill；`sg-skill-entry-guard` 等可加载。*（v3.6 更正：**三处均错** —— 数量是 22 个，前缀是 `sg-skill-*` / `sp-skill-*`，且技能**从不**注册进会话技能目录。它们作为插件资产放在 `assets/` 下，只注入子 Agent 提示词。`sg-skill-entry-guard` 已删除；可参考 `sg-skill-systematic-debugging` 或 `sg-skill-code-review`。）*
- 提示：进入含 `.specgate/` 的项目后，系统提示自动出现“SpecGate 工作流已启用 / 当前门控 / 下一步 / 硬规则”。*（v3.6 更正：`index.js` 未声明 `systemPrompt` 注入，该提示段已不存在。）*

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

- `.specgate/`：`config.yaml`、`deviations.log`、`workflow-state.yaml`、`README.md`、`gates/`、`agents/`、`templates/`、`rules/`、`briefs/`、`out-of-scope/`、`experiences/`、`reviews/` *（v3.6 更正：`/sg-init` 现在只生成小骨架 —— `.specgate/{,worktrees,evidence,backups}`、`openspec/{specs,changes}`、`config.yaml` 和两个 `.gitkeep` 文件。不再有 `deviations.log`、`agents/`、`gates/` 标记目录和 `templates/`。）*
- `.dsh/skills/specgate/`：30 个技能，53 个文件 *（v3.6 更正：**该目录不会被任何代码路径写入。** 技能放在插件内 `assets/skills/`（17 个 `sg-skill-*`）与 `assets/sp/`（5 个 `sp-skill-*`），共 22 个，不会物化到项目中。）*
- `.specgate/agents/`：9 个 Agent 角色文本 *（v3.6 更正：已移除。不存在 Agent 目录；`src/v3/pool.js` 的 `ROLE_PROMPTS` 只剩 `implementer` 与 `tester`。）*
- `.specgate/templates/`：10 个模板文件 *（v3.6 更正：不再创建 `.specgate/templates/`。）*
- `.specgate/templates/commands|rules/`：12 个参考文件 *（v3.6 更正：v3.6 不再创建。）*
- `.specgate/experiences/index.md`、`trigger-guide.md`；`.specgate/rules/` 5 个模块规则；`.specgate/briefs/README.md`；`.specgate/out-of-scope/README.md`（知识资产/模块规则共 9 个）*（v3.6 更正：v3.6 的 `/sg-init` 均不生成这些。）*
- `openspec/changes|specs|changes/archive/`
- `AGENTS.md`：创建并写入 `<!-- specgate:begin -->` 段落 *（v3.6 更正：`AGENTS.md` 现在在批准 `H0` 时写入，不由 `/sg-init` 生成，也不再使用 marker 段落。）*

第二次执行 `sg_init`：

- 技能新增 0、跳过 53；Agent 新增 0、跳过 9；模板新增 0、跳过 10；参考新增 0、跳过 12；知识资产/模块规则新增 0、跳过 9 *（v3.6 更正：已无技能、Agent、模板、参考、知识资产需要物化；`/sg-init` 改为对其小骨架与 `H0` 产物保持幂等。）*
- `AGENTS.md` 段落未重复
- 结论：幂等

## 5. 其他工具

- `sg_propose` 在 G1/G2 未确认时返回：`无法创建 proposal：缺少门控 G1、G2。请先完成 /sg-gate 确认。` *（v3.6 更正：已无 `sg_propose` 工具，也没有 `/sg-gate` 命令；当前用 `sg_change` / `/sg-change` 创建变更。）*
- `sg_doctor`：`materialized-skills: 30/30`，结论通过。*（v3.6 更正：**已失效** —— 没有 `sg_doctor` 工具，也没有 `materialized-skills` 检查，因为技能从不物化到项目。）*
- `sg_disable`：状态变为 `启用：否`，提示注入消失。*（v3.6 更正：没有 `sg_disable` 工具，也没有提示注入；改看 `/sg-status` 与配置文件。）*
- `sg_enable`：状态恢复 `启用：是`，提示注入恢复。*（v3.6 更正：没有 `sg_enable` 工具。）*
- `sg_deviation`：写入 `.specgate/deviations.log`，`sg_status` 偏离计数从 0 → 1。*（v3.6 更正：没有 `sg_deviation` 工具，也没有 `.specgate/deviations.log`。）*
- `sg_propose`（G1/G2 已确认时）：创建 `openspec/changes/demo-two/proposal.md`，状态出现两个 Change。*（v3.6 更正：没有 `sg_propose` 工具；改用 `sg_change` / `/sg-change`。）*

## 6. 自动化测试

命令：`node --test`

结果：**25 passed / 0 failed**。*（v3.6 更正：当前测试套件为 **265 passed / 0 failed**。§6 与 §8.5 的数字只属于当时版本。）*

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
- 斜杠命令 `/sg-*`、`/sg-*` 已注册，但未通过 Web UI 命令面板逐条点击验证。*（v3.6 更正：只注册 5 个斜杠命令 —— `/sg-init`、`/sg-change`、`/sg-status`、`/sg-context`、`/sg-skill`；其余是工具。）*
- 通过 shell（`pwsh` / `bash`）直接写文件绕过 `write`/`edit`，不被 guard 拦截。
- 9 个 Agent 目前是角色文本，不是独立 subagent。*（v3.6 更正：这 9 份角色文本与 `sg-agent-*` 资产已删除，`src/v3/pool.js` 只剩 `implementer` 与 `tester` 两个角色提示。）*
- G6.5 Brief 为可选门控，默认不进入“待确认”列表。*（v3.6 更正：不存在 G6.5；门控为 H0–H3 加 M1/M2。）*

---

## 8. v0.2.0 / v1.1 增量验收（2026-10-18）

> 历史日志。其记录的 v0.2.0/v1.1 能力面（12 个工具、`sg_commit`、`sg_gate`、`sg_doctor`、
> `materialized-skills`、`--minimal` / `--no-git`、`G1`–`G11` 门控与 `L1`/`L2`/`L3` 范式）
> 已在 v3.6 移除或替换，详见第 1 部分。

### 8.1 安装与能力

- 先 `remove_bundle dsh-plugin-specgate`，再 `install_bundle E:\ai_workflow\sg_dsh`。
- 结果：`application: applied`；`version: 0.2.0`；`include:specgate` active。
- 工具：新增 `sg_commit`，共 12 个 `sg_*` 工具。*（v3.6 更正：已无 `sg_commit` 工具；当前插件只注册 6 个工具。）*
- 技能：30 个 `specgate-*` 仍可加载。*（v3.6 更正：22 个技能随插件资产发布（`sg-skill-*` / `sp-skill-*`），只注入子 Agent 提示词，不注册进会话技能目录。）*

### 8.2 新建项目 + 默认 Git

命令：`sg_init { path: "demo-app" }`（在新目录 `\.specgate_v11_e2e` 下）。

- 新建目录：是；模式：full。
- Git：`git init` + 初始提交 `72826a0 chore(specgate): 初始化工作流项目`（111 个文件）。
- 生成：30 Skill（53 文件）、9 Agent、11 模板、12 参考命令/规则、9 知识资产/模块规则、7 文档模板、5 示例文件。*（v3.6 更正：`/sg-init` 不再生成其中任何一项。它只写一个小骨架 —— `.specgate/{,worktrees,evidence,backups}`、`openspec/{specs,changes}`、`config.yaml`、两个 `.gitkeep` —— 随后批准 `H0` 会写恰好 5 个文件：`.specgate/project-context.md`、`AGENTS.md`、`docs/glossary.md`、`docs/adr/0001-initial.md`、`.github/workflows/ci.yml`，外加一个示例变更。）*
- `AGENTS.md`：完整规则（含 `## 门控`、Git 工作流、知识沉淀、命令速查）。*（v3.6 更正：`AGENTS.md` 现在在批准 `H0` 时写入，内容是当前插件的规则，不含上述 v1.1 章节。）*
- 工作区：clean；`sg_status` 显示 `Git：master ｜ clean ｜ 最近提交：72826a0 ...`。
- `sg_doctor`：`git-repo` / `git-status` 均 OK，`materialized-skills: 30/30`。*（v3.6 更正：已无 `sg_doctor` 工具，也没有 `materialized-skills` 检查。）*

### 8.3 minimal 与 no-git

- `sg_init { path: "mini-app", minimal: true }`
  - Git 初始提交 `8b78a89`（60 个文件）。
  - 30 Skill、`openspec/`、`experiences/index.md` + `trigger-guide.md`。*（v3.6 更正：`/sg-init` 不再写技能，也不生成 `experiences/`；22 个技能改为随插件资产发布。）*
  - 无 `.specgate/agents`、无 `.specgate/templates`、无 `docs/`、无示例。
  - `AGENTS.md` 为精简规则（9 行，不含 `## 门控`）。*（v3.6 更正：当前 `AGENTS.md` 在批准 `H0` 时生成，已无 `--minimal` 精简分支。）*
  - 修复报告文案后 `mini-app2` 显示 `AGENTS.md：已创建精简规则`，初始提交 `51ba1b8`。
- `sg_init { path: "nogit-app", minimal: true, git: false }` *（v3.6 更正：v3.6 的 `sg_init` 不接受参数。）*
  - 不生成 `.git`；`.specgate/config.yaml` 写入 `git: false`；报告 `Git：未启用（--no-git）`。

### 8.4 门控 clean 与提交

- 在 `demo-app` 写入 `note.txt` 后，提示注入显示 `Git：... ｜ dirty 1`。*（v3.6 更正：已无提示注入；Git 状态由 `sg_status` / `/sg-status` 报告。）*
- `sg_gate G1 confirm` 返回：
  `工作区有 1 个未提交改动；请先 commit（?? note.txt）。请先 /sg-commit <message> 或手工 git commit，再确认门控。` *（v3.6 更正：已无 `sg_gate` 工具与 `/sg-commit` 命令；门控通过 `sg_approve` / `/sg-run` 推进。）*
- `sg_commit { message: "test: 添加门控 clean 验证文件" }`：
  `已提交 d078fc8：test: 添加门控 clean 验证文件（1 个文件）`。*（v3.6 更正：已无 `sg_commit` 工具。）*
- 再次 `sg_commit`：`没有可提交的变更。`
- 提交后提示注入恢复 `Git：master ｜ clean ｜ 最近提交：d078fc8 ...`。*（v3.6 更正：已无提示注入。）*

### 8.5 自动化测试

命令：`node --test`

结果：**90 passed / 0 failed**。*（v3.6 更正：当前测试套件为 **265 passed / 0 failed**。）*

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
- Skill：30 个注册项都带 `source`，满足 DSH 加载校验 *（v3.6 更正：**根本不存在技能注册。** 没有任何代码调用 `skills.register` / `skills.registerProvider`，22 个技能都不在会话技能目录中。）*
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
- 初始化：full 模式，`a64e3da` 初始提交（111 文件）；30 Skill / 9 Agent / docs / 示例。*（v3.6 更正：`/sg-init` 不再生成技能、Agent、文档或示例；见第 1 部分。）*
- L1：`add-login` 全流程 G1-G11，proposal/design/specs/tasks/源码/归档通过。*（v3.6 更正：运行时已无 `G1`–`G11`，也无 `L1`/`L2`/`L3`；当前门控为 H0–H3 加 M1/M2。）*
- L2：`e2e-l2` 全流程 G1-G11 通过（脚本 `docs/specgate/e2e-three-paradigms.mjs`）。
- L3：`fix-login` / `e2e-l3` 在 G3/G4/G5 未确认时仍可写 design/specs/tasks；源码仍需 G6/G7。*（v3.6 更正：L 范式分类已移除。）*
- 初始化分支：minimal、no-git、`--force` 合并、AGENTS 备份、非空目录保护、disabled、幂等全部通过。*（v3.6 更正：`sg_init` 现已不接受参数，v3.6 没有 `--minimal` / `--no-git` / `--force`。）*
- 三范式脚本输出：`PASS L1 e2e-l1`、`PASS L2 e2e-l2`、`PASS L3 e2e-l3`、`ALL_PARADIGMS_PASS`。
- 结果：94 个 commit、6 个归档 Change、0 个活跃 Change、Git clean、`sg_doctor` 通过。*（v3.6 更正：已无 `sg_doctor` 工具。）*
- 报告：`test_project/TEST_REPORT.md`。
- 覆盖率：行 81.05% / 分支 75.87% / 函数 75.32%（未达到 100%）。

### 8.7 v1.1 未覆盖 / 限制

- `userQuestions` 的真实 UI 点击未在自动化中驱动；门控交互用模拟回答覆盖。
- 斜杠命令 `/sg-*`、`/sg-*` 已注册，但未通过 Web UI 命令面板逐条点击。*（v3.6 更正：只注册 5 个斜杠命令 —— `/sg-init`、`/sg-change`、`/sg-status`、`/sg-context`、`/sg-skill`。）*
- 通过 shell 直接写文件仍绕过 `write`/`edit` guard。
- 9 个 Agent 仍为角色文本，不是独立 subagent。*（v3.6 更正：这些角色文本已删除；`src/v3/pool.js` 只剩 `implementer` 与 `tester`。）*
- 默认 `git init` 依赖系统 Git；无 Git 环境需 `--no-git`。*（v3.6 更正：`sg_init` 不再执行 `git init`，也不接受该参数。）*
- 门控确认后写 marker 会使工作区变 dirty，下一次门控前必须提交；这是 v1.1 的刻意设计。
