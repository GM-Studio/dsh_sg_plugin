# SpecGate 工作流迁移到 DSH 插件：需求澄清与确认稿

> 文档状态：**v1.1（已确认，2026-10-18）**
> 基线版本：AgentKit47 `0.7.11`；DSH `0.2.1-rc.2`；当前环境 Windows + PowerShell
> 约束：本文是设计、实现、验收的唯一需求基线。任何范围变更须追加“变更记录”并再次确认。
> v1.1 变更：插件内建初始化、新建项目目录、完整 `AGENTS.md`、默认 `git init`、门控级提交纪律、enable/disable 开关。

### 决策记录（v1.0，2026-10-18）

| 决策项 | 你的选择 | 对应问题 |
|--------|----------|----------|
| 交付与激活 | workspace bundle + 项目级 opt-in | Q1=A、Q9=B |
| 迁移范围 | **一次性全量迁移** | Q2=A |
| 门控强度 | 混合：写入硬阻断，阶段推进软提醒 | Q3=C |
| 技能承载 | 双轨：内置默认 + init 物化 | Q4=C |
| Agent 角色 | 先主 Agent + Skills，后续再拆 subagent | Q5=C |
| 其余 Q6-Q16 | 按推荐默认 | — |

**口径一致性说明（已确认）**：Q2 选择“一次性全量”，同时 Q5 选择“先主 Agent + Skills”。本文的解释是：

- “全量”指 **30 个 Skill、11 个门控、OpenSpec 流程、知识沉淀目录、9 个 Agent 的角色文本**全部迁移；
- “Agent 先不拆”仅指 **运行时不立即做 9 个独立 subagent**，角色先以 Skill/提示模板承载；9 个 subagent 模板留到后续可选阶段。

如果后续认为“全量”必须包含 9 个独立 subagent 的运行时拆分，需追加变更记录并调整范围与工期。

---

## 0. 一句话目标

把 SpecGate 在 Qoder 中的“技能 + 门控 + OpenSpec + 知识沉淀”工作流，做成一个可在 DSH 中安装、按项目启用、可审计、可卸载的插件，而不是把 `.qoder/` 配置原样复制一份。

---

## 1. 事实核查（已核实，避免臆想）

| # | 结论 | 依据 |
|---|------|------|
| F1 | 本仓库是 SpecGate 的**生成器/模板仓库**，不是已经初始化过 SpecGate 的使用方项目。根目录没有 `.qoder/`、`.specgate/`、`openspec/`。 | `glob .qoder/**`、`glob .specgate/**` 均无结果；能力资产都在 `templates/qoder/` |
| F2 | 实际能力资产：**9 个 Agent、30 个 Skill、8 个 Command、9 个 Qoder Hook 绑定、4 个可选规则文件**。 | `templates/qoder/agents/*.md`（9）、`templates/qoder/skills/**/SKILL.md`（30）、`templates/qoder/commands/**/*.md`（8）、`templates/qoder/settings.json`（9 条绑定） |
| F3 | 能力数量口径不一致：仓库 `AGENTS.md` 写“33 个 Skill”，README 写“29 个”，实际模板是 **30 个**；被算进去的 4 个 `openspec-*` 在模板里其实是 `commands/sg/*`，不是 Skill。 | F2 的 glob 结果与 `AGENTS.md`、`README.md` 对照 |
| F4 | 门控状态已经**文件化**：`.specgate/gates/G1.confirmed` 等标记文件；偏离日志为 `.specgate/deviations.log`。 | `grep` 命中 `pre-write-artifacts-check.sh`、`requirements-definition`、`entry-guard` 等 |
| F5 | Qoder 侧 Hook 只有 5 类事件：`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`Stop`；脚本为 bash + jq，策略以阻断/警告混合为主。 | `templates/qoder/settings.json`、`templates/qoder/hooks/*.sh` |
| F6 | DSH 插件可以注册/拦截的能力（已通过 Inspect 核实）：`skills.register` / `skills.registerProvider`、`commands.register`、`tools.register` / `tools.guard`、`systemPrompt.section`、`systemPrompt.context`、`userQuestions.ask`、`tools/pre-execute`、`tools/post-execute`、`fs/write-intent`、`fs/edit-intent`、`agent/pre-step`、`session/event`。 | `cordis_inspect_query` Host `Service` / `Event` |
| F7 | DSH 技能可以从文件系统发现：项目根 `.dsh/skills`、`.agents/skills`、自定义目录、`$DSH_HOME/skills`；支持 `<name>/SKILL.md` 目录包或 `<name>.md` 扁平文件；frontmatter 必填 `name`、`description`，可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`。 | `@deepseek-ai/dsh-skill-filesystem` README |
| F8 | DSH 插件以 bundle 形式安装：`package.json` 声明 `dsh.bundle.patch`，由 `plugin_manager install_bundle` 安装到当前 profile；会影响该 profile 的所有会话，需要 danger-full-access 或审批；可用 `engines.dsh` 约束版本。 | `cordis-plugin-development`、`references/host-plugin.md`、`plugin_manager` 工具说明 |
| F9 | DSH 没有与 Qoder 等价的“Agent 自动路由”。当前可用的是 `subagent` / `subagent_fork` 工具、Agent Preset 机制，以及 Skill 按需加载。 | 当前 Tool 列表与 `agentPresets` Service；未发现自动角色分发器 |
| F10 | 当前环境的 `pwsh` 进程连续两次以 `0xC0000142`（DLL 初始化失败）退出，命令无法执行；这不是仓库代码问题，但会影响后续验证方式。 | 两次 `pwsh` 调用返回 `[exit code: 3221225794]` |
| F11 | 当前会话的 `skill` 工具可用，已加载的 Skill 来自 Agent Preset 的 bundled skills；profile 中 `skill-filesystem`、`tool-skill` 行显示为 inactive。说明“技能可用”不等于“文件系统技能源已启用”，实现前需确认挂载方式。 | `Config.listConfigs`、当前技能目录 |

---

## 2. 目标与成功标准

### 2.1 目标

- **G1 可安装**：作为一个 DSH bundle/plugin 安装，不要求用户手工拷贝 `.qoder/`。
- **G2 保留核心差异化**：11 个门控点 + 偏离日志 + L1/L2/L3 范式 + Spec 垂直切片 + TDD/审查门禁，不能被简化成“几个提示词”。
- **G3 技能按需加载**：30 个 Skill 不一次性注入上下文，只在匹配时加载。
- **G4 状态可查询、可审计**：用户随时能问“现在到哪一步”，状态来自项目文件而不是对话缓存。
- **G5 与现有 Qoder/SpecGate 项目共存**：读取既有 `.specgate/`、`openspec/`，不破坏 `.qoder/`；可渐进迁移。
- **G6 可验证**：提供可重复的端到端演示和自动化测试，而不是“看起来能跑”。

### 2.2 用户视角的成功标准

| # | 场景 | 成功表现 |
|---|------|----------|
| S1 | 在空项目里开始一个新功能 | 输入需求后，AI 先做入口判定和需求复述，不会直接写代码 |
| S2 | AI 想跳过 proposal/design/specs/tasks | 写后续产物或源码时被明确阻止，并提示“先完成 G3/G4/G5/G6” |
| S3 | 用户问“现在到哪了” | 一条命令返回当前 Change、Artifact 完成度、下一步建议 |
| S4 | 用户同意跳过某个门控 | 必须留下可追溯的偏离记录；没有记录则不能继续 |
| S5 | 用户不想用了 | 卸载插件后，项目里的 `.specgate/`、`openspec/` 仍可读，不被破坏 |
| S6 | 已有 Qoder 项目接入 | 不覆盖用户定制；重复初始化不产生重复内容 |

---

## 3. 范围

### 3.1 In Scope（全量范围，优先级仅表示实现顺序）

> 按 Q2=A，首期范围是**全量**；下表 P0/P1/P2 只表示建议实现顺序，**不表示首期可以裁剪**。任何降级都需要单独确认。

| 优先级 | 能力 | 说明 |
|--------|------|------|
| P0 | 插件打包、安装、启用/停用 | 一个可安装的 bundle；按项目 opt-in，避免污染所有会话 |
| P0 | 项目初始化 `/specgate:init` | 生成 `.specgate/` 骨架、技能、`openspec/` 目录、规则入口 |
| P0 | 30 个 Skill 的承载 | 全部 30 个可用；逐项校验 frontmatter 与正文；内容与源模板语义一致 |
| P0 | 状态查询与下一步 | `status` / `next`，基于 `openspec/changes/**` 与 `.specgate/` 实时推断 |
| P0 | 门控 G1-G11 的运行时表达 | 至少 G1、G2、G3、G7、G8、G9 必须可强制；其余可先软提醒 |
| P0 | 偏离日志 | 跳过门控必须落 `.specgate/deviations.log` |
| P0 | OpenSpec 流程 | `propose` / `apply` / `archive` 的命令或工具入口，文件格式不变 |
| P1 | L1/L2/L3 分类 | 入口判定 + 变更分类 + 门控强度矩阵 |
| P1 | TDD / 代码审查 / 垂直切片检查 | 写入源码、specs、提交前的检查 |
| P1 | 已有 SpecGate 项目的兼容读取 | 读取 `.specgate/config.yaml`、`progress.yaml`、`workflow-state.yaml` |
| P2 | 9 个 Agent 角色的承载 | 先以 Skill 文本/子代理提示模板承载，是否做 9 个独立 subagent 待定 |
| P2 | 知识沉淀 | `.specgate/experiences/` 的检索、归档、索引 |
| P2 | Web UI 面板 | 状态、门控、进度；首期可不做 |
| P2 | `specgate` CLI 能力封装 | `doctor`、`validate`、`upgrade` 等 |

### 3.2 Out of Scope（首期明确不做）

- 不重写 `specgate` CLI 的 `init` / `upgrade` / `doctor` / `validate` 全部逻辑。
- 不 1:1 移植 Qoder 的 shell Hook（bash + jq + stderr 警告模型）。
- 不做 Qoder 式的“Agent 自动路由/自动委托”。
- 不修改 OpenSpec 的文件格式、目录结构、`openspec` CLI 契约。
- 不修改 `templates/qoder/` 现有 Qoder 产物（除非确认要建立双平台单一源）。
- 不做 CI/CD、GitLab/GitHub 集成、团队权限系统。
- 不做非 Git 项目的完整支持（待确认）。
- 不默认全局强制所有项目使用 SpecGate 流程。

---

## 4. 用户与使用场景

### 4.1 目标用户

- 在 DSH Web GUI 或 DSH CLI 中开发真实项目的工程师。
- 已经了解或愿意接受 SpecGate 的流程纪律；不希望每次从零解释工作流。
- 可能已经在 Qoder 项目里使用过 SpecGate，希望把同一套流程迁移到 DSH。

### 4.2 核心场景

1. **新项目启动**：空仓库 → `/specgate:init` → 输入需求 → G1 复述确认 → L1/L2/L3 分类 → OpenSpec 产物 → 实现 → 审查 → 归档。
2. **已有 SpecGate 项目迁移**：项目已有 `.specgate/` 和 `openspec/` → 安装插件 → 插件识别现有状态 → 从当前阶段继续，不要求重来。
3. **日常小修**：typo / 版本号 / 单测 → 入口判定为轻量 → 不强制全流程。
4. **跳过门控**：用户明确要求跳过 G4 → 记录偏离 → 继续；未记录则不能继续。
5. **卸载/回退**：用户停用插件 → 项目文件保留 → 可以回到 Qoder 或手工流程。

---

## 5. 功能需求

### FR-01 安装与启用

- FR-01.1 以 DSH bundle 形式安装到当前 profile；包声明 `dsh.bundle.patch` 与 `engines.dsh`。
- FR-01.2 **默认按项目 opt-in**：只有项目根存在 `.specgate/config.yaml`，或用户显式执行 `/specgate:enable` 时，门控与提示注入才生效。避免一个全局插件影响所有会话。
- FR-01.3 提供 `/specgate:disable` 临时停用；停用后不拦截工具、不注入提示，但保留项目文件。
- FR-01.4 安装/卸载/停用不得修改用户项目文件；只有 `/specgate:init` 会写入项目。
- FR-01.5 安装结果必须可观察：安装后能通过 Inspect 或命令确认插件行已激活；不能只看日志。

### FR-02 项目初始化 `/specgate:init`

- FR-02.1 生成/补齐：
  - `.specgate/`：`config.yaml`、`gates/`、`deviations.log`（空文件或表头）、`experiences/` 四类目录。
  - `.dsh/skills/specgate/`：30 个 Skill（目录包结构）。
  - `openspec/`：`changes/`、`specs/`、`archive/`（若不存在）。
  - `AGENTS.md` 或 `.dsh/AGENTS.md`：项目级规则入口（不覆盖用户已有内容）。
  - `docs/` 模板：PRD、architecture、deviation log 等（可选，`--full` 时生成）。
- FR-02.2 幂等：重复执行不重复追加、不覆盖用户修改；写入前给出 diff 预览。
- FR-02.3 支持 `--minimal`（只生成门控与核心技能）和 `--full`（全量）。
- FR-02.4 不覆盖已有的 `.qoder/`；不删除任何用户文件。
- FR-02.5 初始化报告：生成了什么、跳过了什么、哪些需要用户确认。

### FR-03 技能承载

- FR-03.1 30 个 Skill 全部可被 DSH 的 `skill` 工具按名称加载，frontmatter 含 `name`、`description`、可选 `whenToUse`。
- FR-03.2 技能正文保留中文；把 Qoder 专有路径、工具名、Hook 术语替换为 DSH 等价物（如 `Write/Edit` → `write/edit`，`.qoder/` → `.dsh/` 或 `.specgate/`）。
- FR-03.3 技能附带的 checklist、模板、示例文件随包保留，资源路径可解析。
- FR-03.4 技能目录不一次性注入系统提示；只在匹配时由模型/用户加载。
- FR-03.5 30 个技能清单以实际模板为准，修正“29/33/30”口径；4 个 `sg` 命令是否升级为技能待确认（Q6）。

### FR-04 命令

候选命令（名称与命名空间待确认，Q10）：

| 命令 | 作用 | 优先级 |
|------|------|--------|
| `/specgate:init` | 初始化/补齐项目资产 | P0 |
| `/specgate:status` | 当前项目/Change/Artifact 状态 | P0 |
| `/specgate:next` | 下一步建议 | P0 |
| `/specgate:gate <Gx>` | 查看/推进指定门控 | P0 |
| `/specgate:deviation` | 记录一次偏离 | P0 |
| `/specgate:classify` | 判定 L1/L2/L3 | P1 |
| `/specgate:doctor` | 项目健康检查 | P1 |
| `/specgate:enable` / `/specgate:disable` | 项目级启用/停用 | P1 |
| `/specgate:uninstall` | 移除插件生成物（保留用户文件） | P1 |
| `/sg-propose` / `apply` / `archive` / `explore` | OpenSpec 流程入口 | P0/P1 |

- FR-04.1 命令必须有 `description` 与输入提示；错误用法返回可读错误。
- FR-04.2 命令名中的 `:` 是否被 DSH 命令注册表接受尚未验证；若不支持，回退为 `/sg-status` 等（Q10）。

### FR-05 门控

- FR-05.1 G1-G11 的定义、触发条件、确认问法、范式强度，沿用 `templates/qoder/rules/gate-control.md`，但按 DSH 能力重写交互方式。
- FR-05.2 门控状态落盘：
  - `.specgate/gates/<Gx>.confirmed`：确认标记（保留现有约定）。
  - `.specgate/workflow-state.yaml`：当前 Change、范式、阶段、最后更新时间（若确认使用）。
  - `.specgate/deviations.log`：跳过记录，append-only。
- FR-05.3 门控确认通过 `userQuestions.ask`（或等价的结构化提问）完成，必须给出“通过 / 需要修改 / 跳过（记录偏离）”选项，并记录时间、Gate、Change、用户选择。
- FR-05.4 **硬门禁**（待 Q3 确认强度）：对 `write` / `edit` 工具调用做前置检查；缺少前置 Gate 时 deny，并返回明确下一步。
- FR-05.5 **软门禁**：系统提示中注入“当前 Gate + 下一步 + 禁止事项”，但不阻断普通对话。
- FR-05.6 跳过硬门禁：用户明确批准 + `/specgate:deviation` 写入 + 门控状态标记为 `waived`；三者缺一不可。
- FR-05.7 一次只等待一个门控点；不得把多个 artifact 合并询问（沿用 SpecGate 规则）。

### FR-06 状态机与“下一步”

- FR-06.1 基于 `openspec/changes/**` 与 `.specgate/` 实时推断，不使用缓存（`always-refresh`）。
- FR-06.2 `status` 输出：项目状态、活跃 Change 列表、每个 Change 的 artifact 完成度、当前 Gate、下一步建议。
- FR-06.3 `next` 按 `templates/workflow/workflow-rules.yaml` 的 `nextStepRules` 优先级给出建议。
- FR-06.4 阻塞检测：`implementing` 且最后活动 > 2 天且完成率 < 50% 时，主动提示。
- FR-06.5 回退：识别“架构调整/需求变更/方案不对”等意图，提示受影响的 artifact 和回退顺序。
- FR-06.6 不手动修改 `workflow-state.yaml` 的状态字段；状态由工具计算后写入。

### FR-07 L1/L2/L3 变更分类

- FR-07.1 入口判定（答疑/轻量/重量）由 `sg-skill-entry-guard` 承担，任何用户输入的第一步都应加载。
- FR-07.2 重量修改进入 `sg-skill-change-classification`，给出 L1/L2/L3 建议与理由。
- FR-07.3 用户通过 G2 确认后，写入范式；后续门控强度按矩阵执行。
- FR-07.4 L3 简化路径必须保留 G2、G6、G7（简化）、G8-G11，不得全部跳过。

### FR-08 TDD / 审查 / 垂直切片检查

- FR-08.1 源码写入前：检查是否存在对应测试文件；不存在时按 Q3 的选择决定警告或阻断。
- FR-08.2 specs 写入时：检查是否按垂直切片组织；水平切分按“致命问题”处理（至少强警告）。
- FR-08.3 代码审查：G8 前检查是否有 review 记录；G9 前检查审查结论。
- FR-08.4 提交前：检查测试通过、审查记录、文档更新（可先做提醒，后续再硬化）。
- FR-08.5 所有检查必须给出“为什么被拦 + 怎么补救”，不能只报错。

### FR-09 知识沉淀

- FR-09.1 `.specgate/experiences/` 保持四类：`tool-research/`、`best-practices/`、`pitfall-records/`、`decisions/`。
- FR-09.2 提供检索入口（Skill 或命令），按 `trigger-guide.md` 的触发条件检索。
- FR-09.3 经验归档必须结构化（时间、来源、结论、适用范围、验证状态），拒绝未经验证的假设。
- FR-09.4 首期可以只做“技能 + 目录约定”，不做独立工具（Q2 范围）。

### FR-10 Agent 角色

- FR-10.1 9 个 Agent 的角色定义、职责边界、输出格式迁入 DSH 可用的载体。
- FR-10.2 承载方式待定（Q5）：
  - A. 9 个独立 subagent 提示模板（调用 `subagent` 时选择角色）。
  - B. 只保留 1 个主 Agent + Skill；角色作为 Skill 内的“视角”。
  - C. 先 B 后 A。
- FR-10.3 无论哪种方式，角色权限边界（只读/可写目录）必须明确，不能越权写用户文件。

### FR-11 OpenSpec

- FR-11.1 不改变 `openspec/changes/<name>/{proposal.md,design.md,tasks.md,specs/**}` 的结构。
- FR-11.2 提供 `propose` / `apply` / `archive` / `explore` 的入口，内部可以调用 `openspec` CLI，也可以只做文件约定。
- FR-11.3 是否依赖 `@fission-ai/openspec` CLI 待定（Q6）；若依赖，必须声明版本、失败时给出降级路径。
- FR-11.4 垂直切片策略作为 `propose` 的强制检查项。

### FR-12 兼容与迁移

- FR-12.1 读取已有 `.specgate/config.yaml`、`progress.yaml`、`workflow-state.yaml`，不要求迁移格式。
- FR-12.2 保留 `.specgate/gates/*.confirmed` 约定，使 Qoder 侧和 DSH 侧可以共享门控状态。
- FR-12.3 不修改 `.qoder/`；如需双平台并存，明确“谁是事实源”。
- FR-12.4 卸载时只移除插件自身生成且未被用户修改的文件；用户修改过的文件保留并提示。

### FR-13 可观测性

- FR-13.1 所有门控、偏离、初始化、状态变更都有可读日志。
- FR-13.2 `doctor` 能检查：目录缺失、artifact 不完整、门控状态矛盾、偏离日志格式错误。
- FR-13.3 日志不得写入密钥、Token、用户隐私内容。

### FR-14 Web UI（P2，待确认）

- FR-14.1 可选只读面板：当前 Change、artifact 进度、Gate 状态、偏离记录。
- FR-14.2 可选交互：在面板中直接确认/跳过门控。
- FR-14.3 首期默认不做；若做，必须遵循 DSH Client Slot 机制并单独确认设计。

---

## 6. 非功能需求

| # | 需求 | 验收口径 |
|---|------|----------|
| NFR-01 | 安全 | 不执行任意 shell；文件写入限定项目根；不绕过 DSH sandbox / approval；不读取凭据 |
| NFR-02 | 可审计 | 状态变更落盘、可 diff；偏离日志 append-only；日志不含敏感信息 |
| NFR-03 | 性能 | `status` 在中小项目 < 200ms；guard 检查 O(1) 文件存在/缓存，不阻塞每次工具调用 |
| NFR-04 | 兼容 | DSH >= 0.2.1-rc.2；Node >= 20；Windows / macOS / Linux 路径处理正确 |
| NFR-05 | 可维护 | TypeScript strict（若写 TS）；核心状态机/门控有单元测试；技能模板有校验脚本 |
| NFR-06 | 可卸载 | 删除插件后项目仍可读；不留下无法解析的必需文件 |
| NFR-07 | 可诊断 | 失败时给出“哪条规则、哪个文件、怎么修”，不只抛异常 |
| NFR-08 | 语言 | 中文正文 + 英文 kebab-case 标识符；命令/技能名稳定 |

---

## 7. 数据与文件契约（草案）

```text
项目根/
├── .specgate/
│   ├── config.yaml              # 项目配置（用户/插件共享；插件只读优先）
│   ├── workflow-state.yaml      # 当前 Change/范式/阶段（插件写，用户只读）
│   ├── gates/
│   │   ├── G1.confirmed         # 门控标记（保留现有约定）
│   │   └── Gx.confirmed
│   ├── deviations.log           # 偏离日志（append-only）
│   ├── experiences/             # 知识资产（四类）
│   └── reviews/                 # 审查记录（可选）
├── .dsh/
│   └── skills/
│       └── specgate/                # 30 个技能（目录包）
│           ├── sg-skill-entry-guard/SKILL.md
│           └── ...
├── openspec/
│   ├── changes/<change>/...
│   └── specs/...
├── AGENTS.md                    # 用户项目规则（插件只建议，不覆盖）
└── docs/                        # 可选模板产物
```

**文件所有权约定（待确认）**：

| 文件 | 所有者 | 插件行为 |
|------|--------|----------|
| `.specgate/config.yaml` | 用户 | 只读；缺失时初始化 |
| `.specgate/workflow-state.yaml` | 插件 | 可读写；状态由工具计算 |
| `.specgate/gates/*.confirmed` | 插件 | 可创建/读取；不随意删除 |
| `.specgate/deviations.log` | 用户 + 插件 | 只追加，不重写 |
| `.dsh/skills/specgate/**` | 插件生成，用户可改 | 初始化写入；升级时 diff，不覆盖用户修改 |
| `openspec/**` | 用户/模型 | 只读状态，不直接改写内容 |
| `AGENTS.md` | 用户 | 只建议追加片段，不覆盖 |

---

## 8. 端到端流程（目标行为）

```text
用户输入
  → entry-guard 判定（答疑 / 轻量 / 重量）
  → 重量：change-classification 建议 L1/L2/L3
  → G1 需求复述 + 用户确认（写 G1.confirmed）
  → G2 范式确认（写 paradigm）
  → proposal（G3）→ design（G4）→ specs（G5）→ tasks（G6）
  → Brief / critical review（G6.5 / G7）
  → 实现（TDD guard）
  → G8 代码审查 → G9 提交
  → G10 验收 → G11 分支处理
  → archive
```

**异常路径**：

- 未过 G3 就写 `design.md`：guard 拒绝，提示“先完成并确认 G3”。
- 用户要求跳过 G4：必须 `/specgate:deviation` + 用户明确批准；否则 guard 继续拒绝。
- 用户说“继续”：只继续当前讨论，不自动跨过任何 Gate。
- 状态文件损坏：`doctor` 报告并给出修复建议；不静默重置。

---

## 9. 验收标准（DoD）

| # | 验收项 | 通过条件 |
|---|--------|----------|
| AC-01 | 安装 | `plugin_manager install_bundle` 成功；重启后插件仍在；Inspect 可见对应行 |
| AC-02 | 初始化 | 空项目 `/specgate:init` 生成完整结构；重复执行幂等；不覆盖用户修改 |
| AC-03 | 技能 | 30 个 Skill 全部可被 `skill` 工具按名称加载；逐项校验 frontmatter 与正文；内容与源模板语义一致 |
| AC-04 | 门控硬阻断 | 未过 G3 时写 `design.md` 被拒绝；通过后可写；拒绝信息含下一步 |
| AC-05 | 门控软提醒 | 未过 Gate 时系统提示包含当前 Gate 与下一步，不阻断普通问答 |
| AC-06 | 状态查询 | 构造 3 种不同 Change 状态，`status` 输出正确；`next` 建议符合规则优先级 |
| AC-07 | 偏离日志 | 跳过 Gate 必须写 `.specgate/deviations.log`；未写则继续被拒绝 |
| AC-08 | 兼容 | 在已有 `.specgate/` 项目上运行不破坏文件；`.qoder/` 不被修改 |
| AC-09 | 卸载 | 停用/卸载后项目仍可读；插件生成物可按提示清理 |
| AC-10 | 回归 | 仓库现有测试仍通过（若改动 CLI/模板）；插件自身测试通过 |
| AC-11 | 文档 | README、安装、升级、回滚、已知限制齐全 |
| AC-12 | 端到端演示 | 在 DSH Web GUI 中完成一个真实小需求，覆盖 G1-G11 全部门控；至少演示一次硬阻断和一次“记录偏离后放行” |

---

## 10. 待确认决策（阻塞项）

> 回复方式：`确认 v1.0`（接受所有推荐默认），或逐项 `Q1=B, Q3=C ...`，或指出需要修改的条目。

### Q1 交付形态

- A. 只做本仓库内的 workspace bundle，先在当前 profile 验证。
- B. 直接做可发布到 npm 的独立插件包。
- C. **先 A 后 B**：先验证 DSH API 与门控体验，再整理为可发布包。
- 推荐：**C**。
- **已选：A（workspace bundle，先不发布 npm 包）**，配合 Q9=B 做项目级 opt-in。
- 影响：包结构、版本策略、文档、测试范围。

### Q2 迁移范围与节奏

- A. 一次性全量迁移（30 Skills + 9 Agent 文本 + 11 Gates + 9 Hook 等价物 + OpenSpec 命令）。
- B. 最小闭环 MVP：entry-guard / change-classification / requirements-definition / TDD / code-review + G1、G2、G3、G7、G8、G9 + status/next + init。
- C. **分阶段**：MVP → 全量 Skill/Gate → Agent/UI。
- 推荐：**C**。
- **已选：A（一次性全量迁移）**。实施时仍按依赖顺序分步提交，但验收覆盖全量。
- 影响：首期工期、验收范围、风险暴露面。

### Q3 门控强度

- A. 全硬阻断：所有 Gate 都用 guard deny。
- B. 全软提醒：只注入提示，依赖模型自律。
- C. **混合**：源码/Artifact 写入硬阻断；阶段推进、审查、验收软提醒；提供“记录偏离后放行”。
- 推荐：**C**。
- **已选：C（混合门控）**。
- 影响：开发体验、误伤率、实现复杂度。

### Q4 技能承载方式

- A. 物化到项目 `.dsh/skills/specgate/`，随项目版本控制，用户可改。
- B. 插件运行时 `skills.register`，不落盘，升级即生效，用户不可改。
- C. **双轨**：插件内置默认；`init` 物化到项目；项目文件优先，插件兜底。
- 推荐：**C**。
- **已选：C（双轨：内置默认 + init 物化，项目文件优先）**。
- 影响：可审计性、升级冲突、离线可用性。

### Q5 Agent 角色承载

- A. 9 个角色做成独立 subagent 提示模板。
- B. 只保留 1 个主 Agent + Skills，角色作为 Skill 内的视角。
- C. **先 B 后 A**：先验证主 Agent + Skills 是否足够，再决定是否拆 subagent。
- 推荐：**C**。
- **已选：C（先主 Agent + Skills；9 个 subagent 模板留到后续可选阶段）**。
- 影响：复杂度、上下文开销、与 Qoder 行为的一致性。

### Q6 OpenSpec 依赖策略

- A. 插件封装 `openspec` CLI，作为强依赖。
- B. 只提供 Skill 与文件约定，CLI 由用户/项目自行提供。
- C. **先 B 后 A**：先跑通文件约定，再按需封装 CLI。
- 推荐：**C**。
- 影响：安装门槛、网络依赖、跨平台兼容。

### Q7 文件布局

- A. **完全保留 `.specgate/` + `openspec/` 现有布局**。
- B. 改为 `.dsh/specgate/` 集中管理。
- C. 新布局 + 兼容读取旧布局。
- 推荐：**A**（兼容现有项目和文档，迁移成本最低）。
- 影响：兼容性、文档、用户迁移。

### Q8 Web UI

- A. **首期不做**，只做 Host 能力与命令。
- B. 做只读状态面板。
- C. 做可交互门控面板。
- 推荐：**A**；B/C 另立需求。
- 影响：工期、Client 插件复杂度、验收方式。

### Q9 安装与激活范围

- A. 安装到 profile 并全局激活，所有会话生效。
- B. **安装到 profile，但按项目 opt-in 激活**（检测 `.specgate/config.yaml` 或 `/specgate:enable`）。
- C. 只做项目本地插件，不进入 profile。
- 推荐：**B**（DSH bundle 是 profile 级安装；项目级 opt-in 避免污染）。
- **已选：B（安装到 profile，按项目 opt-in 激活）**。
- 影响：是否会干扰非 SpecGate 项目。

### Q10 命名

- A. **包名 `dsh-plugin-specgate`；命令 `/specgate:*`；Skill 保留 `specgate-*`**。
- B. 包名 `@specgate/dsh`；命令 `/sg-*`；Skill 保留 `specgate-*`。
- C. 其他（请指定）。
- 推荐：**A**；若 DSH 命令名不支持 `:`，自动回退为 `-` 形式。
- 影响：用户习惯、文档、命令注册兼容性。

### Q11 与 `templates/` 的关系

- A. 不动 `templates/`，只新增 DSH 插件目录（内容可能重复）。
- B. 重构 `templates/` 为双平台共享源。
- C. **保持 `templates/` 为单一源，插件构建时复制并校验，不手工双写**。
- 推荐：**C**。
- 影响：长期漂移风险、构建复杂度。

### Q12 当前 `pwsh` 异常的处理

- A. 允许我先修复 `pwsh` 或改用其他 shell（需要你批准）。
- B. **不依赖 `pwsh` 验证**，用 Node 脚本 / DSH 工具 / 静态检查完成首期验证。
- C. 暂不验证，只做静态检查。
- 推荐：**B**；若后续必须跑测试/构建，再单独处理。
- 影响：验证方式、能否做端到端演示。

### Q13 依赖策略

- A. 允许安装 npm 依赖（锁定版本），如 `yaml`、`zod`。
- B. **零运行时依赖**，只用 Node 内置模块，状态文件尽量用 JSON/纯文本。
- C. 按需引入，最少依赖。
- 推荐：**C**（如果 YAML 解析必须，允许 1-2 个锁定依赖）。
- 影响：安装体积、离线能力、解析正确性。

### Q14 规则强度

- A. **保留 SpecGate 的 1% 规则、禁止行为、Git 工作流规则**，作为提示注入 + 技能自律。
- B. 弱化为建议，只保留门控。
- C. 删除这些规则，只保留 OpenSpec 流程。
- 推荐：**A**，但默认只在 SpecGate 项目内注入。
- 影响：上下文长度、用户接受度、与 DSH 原生规则的冲突。

### Q15 验收演示方式

- A. **在当前 DSH Web GUI 中跑一个真实小需求**，覆盖关键路径。
- B. 只跑自动化测试与静态检查。
- C. 录屏/文档演示即可。
- 推荐：**A + B**。
- 影响：是否能证明“用户可见地可用”。

### Q16 技能数量口径

- A. **以实际模板为准，统一为 30 个**；4 个 `sg` 保持命令形态。
- B. 把 4 个 `sg` 命令升级为 Skill，凑成 34 个。
- C. 沿用 AGENTS.md 的 33 个口径，补齐缺失内容。
- 推荐：**A**。
- 影响：技能清单、文档、验收数量。

---

## 11. 风险与对策

| # | 风险 | 影响 | 对策 |
|---|------|------|------|
| R1 | 硬门禁误伤正常开发 | 用户绕过/停用插件 | 混合强度；白名单；`/specgate:deviation` 一键放行；默认只对源码/artifact 硬阻断 |
| R2 | 全局插件污染所有项目 | 非 SpecGate 项目被提示/拦截 | 项目级 opt-in；检测 `.specgate/`；`/specgate:disable` |
| R3 | DSH 0.2.1-rc API 不稳定 | 升级后插件失效 | 锁定 `engines.dsh`；适配层；e2e 回归 |
| R4 | 技能内容与 Qoder 模板漂移 | 两套规则不一致 | 单一源 `templates/` + 构建时同步 + 校验脚本 |
| R5 | `openspec` CLI 依赖/网络 | 安装失败或流程中断 | 先文件约定；CLI 可选；失败降级 |
| R6 | 状态文件并发/多会话 | 状态覆盖/冲突 | 先单会话；文件锁或 session-scoped；`doctor` 检测 |
| R7 | 命令名 `:` 不被 DSH 支持 | 命令注册失败 | 先验证；回退为 `-`；文档同步 |
| R8 | 技能数量口径混乱 | 验收标准不一致 | Q16 统一口径；以实际文件为准 |
| R9 | 当前 `pwsh` 不可用 | 无法跑构建/测试/演示 | Q12；改用 Node/DSH 工具；必要时修复环境 |
| R10 | 用户定制被升级覆盖 | 信任损失 | 初始化/升级 diff 预览；不覆盖用户修改；备份 |

---

## 12. 交付阶段与门控

> 范围按 Q2=A 定为全量；“阶段”只表示实施与验证的依赖顺序，不缩减验收范围。

| 阶段 | 内容 | 退出条件 |
|------|------|----------|
| Phase 0 | 本文最终确认 | 用户回复确认；冻结 v1.0 |
| Phase 1 | 技术验证 spike（不写产品代码）：验证 skill 注册、command 注册、guard、`userQuestions.ask`、项目 opt-in | 产出可行性结论；用户确认后才进入 Phase 2 |
| Phase 2 | 全量实现：初始化 + 30 Skill + G1-G11 + L1-L3 + OpenSpec + status/next + 偏离 + TDD/审查/垂直切片 + 知识沉淀目录 | 通过 AC-01 ~ AC-11 |
| Phase 3 | 全量验收与端到端演示 | 通过 AC-12 |
| Phase 4 | 可选增强：9 个独立 subagent / 知识沉淀专用工具 / Web UI / CLI 封装 | 单独需求确认 |

> 每个阶段开始前都需要用户明确确认；不得从 Phase 0 直接跳到 Phase 2。

---

## 13. 变更控制

1. 本文 v1.0 已冻结；后续变更须追加“变更记录”。
2. 任何新增/删除/降级需求，必须在本文件末尾追加“变更记录”，写明变更项、原因、影响、确认时间。
3. 未确认的变更默认不实施。
4. 实现过程中如发现 DSH API 与本文假设不符，先停手并回报，不自行改需求。

---

## 14. 确认

2026-10-18：用户回复 **“确认 v1.0”**，接受第一轮 5 项决策（Q1=A、Q2=A、Q3=C、Q4=C、Q5=C、Q9=B）以及 Q6-Q16 的推荐默认。本文冻结为 **v1.0**，作为设计、实现、验收的唯一需求基线。

后续变更只允许通过文末“变更记录”追加，并须再次确认。

**基线冻结后仍需遵守：**

- 阶段推进按第 12 节执行，每个阶段开始前向用户确认。
- 发现 DSH API 与本文假设不符时，先停手回报，不自行改需求。
- 不把“用户说继续”解释为“跳过门控”。

---

## 附录 A：依据与来源

- 仓库事实：`AGENTS.md`、`README.md`、`package.json`、`templates/qoder/**`、`templates/workflow/workflow-rules.yaml`、`src/core/flows/index.ts`
- DSH 能力：`cordis_inspect_query`（Host `Service`、Host `Event`、`Tool.listTools`、`Config.listConfigs`）
- DSH 技能机制：`@deepseek-ai/dsh-skill` README、`@deepseek-ai/dsh-skill-filesystem` README
- DSH 插件机制：`cordis-plugin-development`、`cordis-composition-reference`、`references/host-plugin.md`
- 当前环境：`package.json` 中的 DSH 版本；两次 `pwsh` 失败的退出码

## 附录 B：术语

| 术语 | 含义 |
|------|------|
| SpecGate | AgentKit47，本仓库提供的 AI 工程化脚手架 |
| DSH | DeepSeek Harness，当前运行的 Host/Client 运行时 |
| Bundle | DSH 的插件安装单元，通过 `dsh.bundle.patch` 插入插件行 |
| Skill | 可按需加载的任务指令包，DSH 通过 `skill` 工具加载 |
| Gate | 人工确认断点，G1-G11 |
| Artifact | OpenSpec 产物：proposal / design / specs / tasks |
| Change | `openspec/changes/<name>/` 下的一个变更 |
| 偏离 | 跳过门控或流程规则的行为，必须记录到 `.specgate/deviations.log` |
| L1/L2/L3 | 变更范式：需求驱动 / 技术实现 / 缺陷修复 |

---

# 变更记录 v1.1：插件内建初始化与开关（已确认）

> 状态：**v1.1 已确认（2026-10-18）**
> 基线：v1.0（已确认，2026-10-18）
> 本记录只描述增量；未提及的 v1.0 条款继续有效。

## C1. 背景

当前 v0.1.0 已具备 `sg_init` 工具与 `/sg-init` 命令，且**不依赖外部 `specgate` CLI**；但初始化体验仍不完整：

- 只能初始化当前目录，不能新建项目目录；
- `AGENTS.md` 只追加精简段落，不是完整工作流规则；
- 没有 `--minimal` 轻量模式；
- 初始化默认不创建 Git 仓库，也没有提交纪律；
- 未初始化项目的 `sg_status` 没有明确提示“先初始化”。

用户目标：**插件自己完成初始化**，生成一个可直接进入工作流的项目（`openspec/` + `AGENTS.md` + 技能/角色/模板/示例），不需要先跑 `specgate init`。

## C2. 本轮已确认决策

| 决策项 | 选择 |
|--------|------|
| 实际现象 | 没有报错，只是希望插件自己完成初始化 |
| 初始化位置 | 当前目录 + 可选新建目录 |
| 触发方式 | 显式命令 + enable/disable 开关 |
| AGENTS.md | 完整工作流，已有文件先备份再合并 |
| 初始化产物 | 可配置：默认完整模板，支持 `--minimal` |
| Git 初始化 | 默认 `git init`；初始 commit |
| 提交纪律 | 门控级强制 clean；`sg_commit` 辅助 |
| 文稿版本 | v1.1 增量变更记录 |

## C3. 新增/修改需求

### C3.1 FR-02 重写：插件内建初始化

- **FR-02.1 入口**
  - 工具：`sg_init`，参数 `path?`、`minimal?`、`force?`、`git?`（默认 true）、`example?`、`docs?`、`disabled?`。
  - 命令：`/sg-init`；DSH 命令名只允许小写字母、数字、`_`、`-`，**不注册** `/specgate:init` 别名。参数 `[--path <dir>] [--minimal] [--force] [--no-git] [--no-example] [--no-docs] [--disabled]`。
  - 初始化逻辑完全在插件内；**不调用外部 `specgate` CLI**。Git 操作通过 `git` 命令执行，默认开启，`--no-git` 可关闭。
- **FR-02.2 当前目录（默认）**
  - 在当前 session cwd 初始化完整模板（见 C3.2）。
  - 当前目录没有 `.git` 时默认执行 `git init`；`--no-git` 时跳过。
- **FR-02.3 新建目录（`--path <dir>`）**
  - 相对路径基于当前 session cwd；也接受绝对路径。
  - 目录不存在：创建后初始化。
  - 目录存在且为空：直接初始化。
  - 目录存在且非空：默认拒绝，提示使用 `--force`；`--force` 只合并不删除。
  - 拒绝文件系统根目录；拒绝把当前目录的父目录作为目标（防止误初始化整个工作区）。
  - 默认在新目录执行 `git init`；`--no-git` 时跳过。
- **FR-02.4 `--minimal`**
  - 生成：`.specgate/config.yaml`、`gates/`、`deviations.log`、`workflow-state.yaml`、`experiences/index.md` + `trigger-guide.md` + 四类目录、`.dsh/skills/specgate/` 30 技能、`openspec/changes|specs|archive`、`AGENTS.md` 精简 SpecGate 段落。
  - 不生成：9 Agent、`.specgate/templates`、`.specgate/rules`、`.specgate/briefs`、`.specgate/out-of-scope`、`docs/` 模板、示例 Change。
- **FR-02.5 默认完整模板**
  - 在 minimal 基础上增加：9 Agent、templates、rules、briefs、out-of-scope、完整知识资产、完整 `AGENTS.md`、`docs/` 模板、示例 Change。
  - `--no-example` / `example:false` 跳过示例。
  - `--no-docs` / `docs:false` 跳过 `docs/` 模板。
- **FR-02.6 幂等与合并**
  - 已存在文件默认跳过。
  - `--force` 只允许重新生成插件资产，不删除用户文件。
  - `AGENTS.md` 的合并规则见 C3.3。
- **FR-02.7 初始化报告**
  - 输出 created / skipped / backed-up / merged / failed 统计；失败不能静默。

### C3.2 完整模板产物

| 产物 | 默认完整 | `--minimal` |
|------|:---:|:---:|
| `.specgate/config.yaml`、gates、deviations、workflow-state | 是 | 是 |
| `.dsh/skills/specgate/` 30 技能 | 是 | 是 |
| `.specgate/agents/` 9 Agent | 是 | 否 |
| `.specgate/templates`、`rules`、`briefs`、`out-of-scope` | 是 | 否 |
| `.specgate/experiences/index.md` + `trigger-guide.md` + 四类目录 | 是 | 是 |
| `openspec/changes/`、`openspec/specs/`、`openspec/changes/archive/` | 是 | 是 |
| Git 仓库 + 初始 commit | 是；`--no-git` 可关 | 是；`--no-git` 可关 |
| 完整 `AGENTS.md` | 是 | 精简段落 |
| `docs/prd/vision.md`、`docs/architecture/01-system-overview.md`、`CONTEXT.md` | 是 | 否 |
| 示例 Change | 是 | 否 |

- **示例 Change 位置**：`docs/specgate/examples/example-change/`，**不放入 `openspec/changes/`**，避免被状态机当成活跃 Change。
- 示例包含 proposal / design / tasks / specs 的最小可读样例，文件头标注“示例，不参与门控”。
- `docs/` 模板仅在文件缺失时创建，不覆盖用户内容。

### C3.3 完整 `AGENTS.md` 与合并

新增 `assets/AGENTS.full.md`（DSH 适配版），包含：

- 工作流总览与 G1-G11 门控；
- L1/L2/L3 范式与门控强度；
- 30 个 Skill 导航；
- 9 个 Agent 角色；
- 1% 规则、禁止行为；
- Git 工作流；
- 知识沉淀；
- 命令/工具速查；
- 项目文件布局。

生成与合并规则：

1. **无 `AGENTS.md`**：写入完整文件。
2. **有 `AGENTS.md` 且无 SpecGate 标记**：先备份到 `.specgate/backups/AGENTS.md.<ISO timestamp>`，再在文件末尾追加完整 SpecGate 段落（`<!-- specgate:begin -->` / `<!-- specgate:end -->` 包裹），用户内容保留。
3. **有 `AGENTS.md` 且有 SpecGate 标记**：先备份，再用最新完整段落替换标记之间的内容；用户内容保留，段落不重复。
4. **备份失败**：中止 `AGENTS.md` 写入（fail closed），其余初始化可继续但报告失败项。
5. `--minimal`：只追加/替换精简段落（当前行为），不写完整规则。

### C3.4 开关

- `.specgate/config.yaml` 的 `enabled` 是唯一事实源。
- `/sg-enable` / `sg_enable`：`enabled: true`；未初始化时先执行完整初始化。
- `/sg-disable` / `sg_disable`：`enabled: false`；不删除文件。
- 初始化默认 `enabled: true`；`--disabled` 可在初始化后直接关闭。
- 开关只影响 guard 是否拦截、系统提示是否注入；不影响已存在的文件与技能目录。
- `sg_status` 必须显示开关状态及原因。

### C3.5 未初始化项目提示

- `sg_status` / `sg_next` / 系统提示：
  - 项目根没有 `.specgate/` 且没有 `.dsh/skills/specgate`：提示“项目未初始化；执行 `/sg-init` 或调用 `sg_init` 生成 `.specgate/`、`openspec/`、`AGENTS.md`”。
  - `.specgate/` 存在但 `enabled:false`：提示“已初始化但已停用；执行 `/sg-enable`”。
- 不自动初始化（本轮选择显式命令）。

### C3.6 外部命令边界

- 初始化路径不得调用 `specgate`、`openspec` 等外部命令。
- Git 是默认依赖：默认执行 `git init` 与初始 commit；`--no-git` 可关闭。
- 验收时在 PATH 中移除 `specgate` / `openspec` 后仍能初始化；Git 必须可用（除非 `--no-git`）。
- 只使用参数化 `git` 调用（`execFile` / `spawn` 参数数组），不拼接 shell 字符串。

### C3.7 Git 初始化与提交纪律（门控级强制 clean）

#### 初始化

- 默认 `git init`；`--no-git` 关闭。
- 若目录已有 `.git`，不重复 init。
- 初始化完成后创建首个 commit：
  - 工作区 clean：`git add -A` + `git commit -m "chore(specgate): 初始化工作流项目"`。
  - 工作区 dirty（已有未提交改动）：**不自动提交**，报告 `git: skipped (working tree dirty)`，提示先 commit。
  - 无 Git 用户身份：commit 失败，报告配置 `git config user.name` / `user.email` 的修复建议；不伪造身份。
- `--no-git`：不 init、不 commit；`sg_status` / `sg_doctor` 标记“Git 未启用，提交纪律未生效”。

#### 门控确认

- `sg_gate confirm` 与 `waive` 执行前检查：
  1. 项目是 Git 仓库（存在 `.git`）；
  2. 工作区 clean（`git status --porcelain` 为空）。
- 任一不满足：拒绝确认/跳过，返回明确原因与下一步；**不写 Gate marker**。
- 若项目以 `--no-git` 初始化：跳过 Git 检查，但返回警告“提交纪律未生效”。
- 说明：确认 Gate 会写 `.specgate/gates/<Gx>.confirmed`，该 marker 本身是变更；下一次 Gate 前必须 commit，因此**每个 Gate 至少产生一个 commit**。

#### `sg_commit` 工具

- 参数：`message`（必填）、`all?`（默认 true）、`paths?`。
- 行为：
  - 校验在 Git 仓库内；
  - `git add -A` 或指定 paths；
  - `git commit -m <message>`；
  - 返回短 hash、提交标题、变更文件数。
- 无改动时返回“没有可提交的变更”，不创建空 commit。
- 不自动设置 git 身份；不加 `--no-verify`。

#### 状态与体检

- `sg_status` 显示：是否 Git 仓库、当前分支、dirty 文件数、最近 commit。
- `sg_doctor` 检查：Git 仓库存在、工作区 clean、最近 commit；dirty 为 warning，未启用 Git 为 error（除非 `--no-git` 记录）。

## C4. 影响分析

| v1.0 条目 | 影响 |
|-----------|------|
| FR-01 安装与启用 | 增加 `--disabled`；启用/停用语义不变 |
| FR-02 项目初始化 | 重写为内建初始化 + 新建目录 + 完整模板 |
| FR-03 技能承载 | 不变；`--minimal` 仍物化 30 技能 |
| FR-04 命令 | `/sg-init` 参数扩展；enable/disable 已有 |
| FR-05 门控 | 增加 Gate 前置 Git clean 检查；开关控制 guard |
| FR-06 状态 | 增加未初始化/停用提示、Git 分支/dirty/最近 commit |
| FR-09 知识沉淀 | 默认完整模板包含 index/trigger-guide |
| 新增工具 | `sg_commit` |
| 验收标准 | 新增 AC-13 ~ AC-25 |
| 非目标 | 不自动初始化；不做 9 个独立 subagent；不重写 CLI；除初始化首次 commit 外不自动提交 |

## C5. 新增验收标准

| # | 验收项 | 通过条件 |
|---|--------|----------|
| AC-13 | 空目录完整初始化 | 无 `specgate` CLI 时，`/sg-init` 生成 `.specgate/`、`openspec/`、完整 `AGENTS.md`、30 Skill、9 Agent、docs、示例 |
| AC-14 | `--minimal` | 只生成骨架、30 Skill、`openspec/`、精简 AGENTS.md；无 agents/templates/docs/example |
| AC-15 | 新建目录 | `--path new-dir` 创建并初始化；默认生成 `.git`；`--no-git` 时不生成；非空目录无 `--force` 拒绝 |
| AC-16 | AGENTS.md 合并 | 已有文件生成备份；用户内容保留；SpecGate 段落只出现一次；重复 init 不重复 |
| AC-17 | 幂等 | 重复 init 不覆盖用户修改；报告 skipped |
| AC-18 | 开关 | `--disabled` 后 `enabled:false`；`/sg-enable` 恢复；`/sg-disable` 关闭 |
| AC-19 | 未初始化提示 | `sg_status` 明确提示 `/sg-init`，不自动改文件 |
| AC-20 | 无 `specgate` CLI 依赖 | 初始化路径无 `specgate`/`openspec` 调用；Git 默认可用 |
| AC-21 | 初始 commit | 新目录初始化后 `git log` 至少有 1 个提交；工作区 clean |
| AC-22 | 门控 clean | G1 确认前 clean 通过；确认后 marker 变 dirty；G2 确认被拒绝；`sg_commit` 后 G2 通过 |
| AC-23 | Git 状态展示 | `sg_status` / `sg_doctor` 显示分支、dirty 文件数、最近 commit |
| AC-24 | `--no-git` | 不生成 `.git`；Gate 确认跳过 Git 检查并提示“提交纪律未生效” |
| AC-25 | 已有仓库 | 已有 `.git` 且 clean 时创建初始 commit；dirty 时跳过并报告，不卷入无关改动 |

## C6. 实施计划（确认后）

1. 新增 `assets/AGENTS.full.md`（DSH 适配版）。
2. 新增 `src/git.js`：`isRepo`、`status`、`init`、`addAndCommit`、`lastCommit`；全部参数化调用，不拼 shell。
3. 扩展 `initProject` 选项与返回值：`{ path, minimal, force, git, example, docs, disabled }`；默认 `git init` + 初始 commit。
4. 实现新建目录、非空目录保护、AGENTS.md 备份/合并。
5. 扩展 `sg_init` 工具 schema 与 `/sg-init` 命令解析；新增 `sg_commit` 工具与 `/sg-commit` 命令。
6. `sg_gate confirm` / `waive` 增加 Git clean 前置检查；`--no-git` 项目跳过并警告。
7. 更新 `status` / prompt 的未初始化、停用、Git 状态提示。
8. 新增 AC-13 ~ AC-25 测试（Git 测试使用临时仓库与本地 user.name/email）。
9. 更新 README、架构文档、验收记录。
10. 重新安装/重载插件，在临时目录做端到端验证。
11. 提交后请你验收；每个实现步骤单独 commit。

## C7. 最终默认值（含本轮 Git 补充）

| 项 | 默认 |
|----|------|
| `git init` | **默认开启**；`--no-git` 关闭 |
| 初始 commit | 初始化完成后自动提交；消息 `chore(specgate): 初始化工作流项目` |
| 已有仓库 | 已有 `.git` 不重复 init；工作区 clean 才自动初始 commit，dirty 则跳过并报告 |
| 后续提交纪律 | **门控级强制 clean**：`sg_gate confirm` / `waive` 前工作区必须 clean，否则拒绝 |
| 提交辅助 | `sg_commit` 工具 / `/sg-commit` 命令；默认 `git add -A`，可指定 paths |
| 非空目录 | 默认拒绝；`--force` 才合并且不删除 |
| 示例 Change 位置 | `docs/specgate/examples/example-change/`，不进入 `openspec/changes/` |
| docs 模板 | 默认生成 `docs/prd/vision.md`、`docs/architecture/01-system-overview.md`、`CONTEXT.md`（仅缺失时） |
| 备份位置 | `.specgate/backups/AGENTS.md.<ISO timestamp>` |
| 初始化默认开关 | `enabled: true`；`--disabled` 可关闭 |
| 命令名 | `/sg-init`；DSH 语法不接受冒号别名；工具 `sg_init` |
| 版本 | v1.1 |

## C8. 确认

2026-10-18：用户确认 **v1.1**，包括默认 `git init`、初始 commit、门控级强制 clean 与 C7 默认值。本文冻结为 v1.1，开始实施。

- 实施时每个步骤单独 commit。
- `确认 v1.1`：已确认。
- `修改：...`：后续变更仍按变更记录流程追加。

## C9. DSH 输出与会话适配修订（2026-10-18）

- **命令名**：DSH 命令语法为 `^[a-z0-9][a-z0-9_-]*$`，冒号别名永远无法注册；删除 `/specgate:init` 等别名，文档统一使用 `/sg-init`。
- **命令输出**：命令结果由 DSH 持久命令卡片渲染；在“只有命令事件”的新会话中，额外写入一条 `user/message`（`source.kind=specgate`、`form=notice`）作为上下文消息，避免欢迎页遮住结果。
- **禁止合成 assistant 消息**：不得在会话日志中注入 `assistant/message`。在工具调用与工具结果之间插入任何消息都会产生 `tool_use` 无紧邻 `tool_result` 的 400 错误。
- **命令通道门控**：`/sg-gate <Gx> confirm` 不带 `--yes` 时只返回待确认提示；`--yes` 才写标记。结构化问答仅保留给 `sg_gate` 工具（在模型回合内执行）。
- **服务加载顺序**：`commands`、`skills`、`systemPrompt` 为可选服务，使用 `ctx.inject` 等待就绪，避免插件先加载时静默丢注册。
- **测试基线**：`node --test` → 58 passed / 0 failed。

## C10. v1.2 幂等保护（2026-10-18，已确认）

### C10.1 范围

| 修改类（需要幂等） | 只读类（不记录、不加锁） |
|---|---|
| `init`、`enable`、`disable`、`commit`、`gate confirm/waive`、`deviation`、`classify --apply`、`sg-propose`、`sg-archive` | `status`、`next`、`doctor`、`classify`（无 `--apply`）、`gate status`、`sg-apply`（无 name）、`sg-explore` |

命令与对应工具都适用；只读类不创建 `.specgate/state/`。

### C10.2 语义

- **状态幂等优先**：先检查目标状态；已达成返回“幂等跳过”，不重复写文件。
- **追加类操作去重**：操作键 = `sha256(projectRoot + command + normalizedArgs + target)`；`.specgate/state/idempotency.json` 记录 24h；`deviation` 在日志中写入 `opId`；`--force` 只对追加类开放。
- **失败不记录**：失败只释放锁；修复后可重试。
- **并发锁**：系统临时目录 `.specgate-locks/<key>.lock`，`wx` 原子创建；stale 10 分钟；相同操作并发时只有一个执行。
- **状态文件**：`.specgate/state/idempotency.json`，自动写 `.gitignore`，不污染门控 clean 检查。
- **各命令行为**：init 检查完整结构/30 Skill/9 Agent/Git；enable/disable 检查 enabled；commit 无变更即 no-op；gate 检查 marker；classify apply 检查 paradigm；propose 检查 change/proposal；archive 检查归档目录。

## C11. v1.2 多 Agent 并行（2026-10-18，已确认）

### C11.1 范围

- `/sg-apply <change>`：默认执行实现；`--plan` 只查看计划。
- `/sg-doctor`：四维并行体检（结构/Git、门控/Artifact、偏离/幂等、Skill/Agent）。

### C11.2 任务图

- 解析 `tasks.md` 的 `[P]` 与 `depends: T1,T2`；`role:` 可指定 9 个角色，默认 `developer`。
- 无 `[P]`/`depends` 默认串行；依赖成环或缺失时报错。
- 波次执行，默认 `maxConcurrency=4`，可在 `.specgate/config.yaml` 的 `dispatch.maxConcurrency` 调整。

### C11.3 Worktree 与合并

- 每个任务 `git worktree add .specgate/worktrees/<change>/<task> -b specgate/<change>/<task> HEAD`。
- 每波完成后顺序合并；冲突立即停止并保留全部 worktree/分支，返回冲突文件。
- 非 Git 或工作区 dirty：降级为串行单写者，并报告原因。
- 成功后移除 worktree、保留分支；失败/冲突保留 worktree。

### C11.4 失败与幂等

- 收集全部任务结果，不因单个任务失败取消其他任务。
- 任务成功后自动勾选 `tasks.md` 并提交；重跑时已勾选任务直接跳过。`.specgate/state/dispatch.json` 保留 contentHash + commit 审计记录。
- 同一任务并发由任务锁/分支复用阻止。

## C12. v1.2 Skill 与 MCP

- 修复 `skills.register` 缺失 `source`：30 个 Skill 都能通过 `skill` 工具加载；增加 `source` 回归测试。
- Skill 文档统一 DSH 路径/工具名（`.dsh/skills/specgate/`、`grep`、`todo_write`、`read/write/edit`）。
- MCP：插件不注册 MCP server/MCP 工具，本次不新增，仅记录“MCP 由 DSH 独立管理”。

## C13. v1.2 验收标准

| 编号 | 验收项 |
|---|---|
| AC-26 | 修改命令连续执行两次只产生一次副作用 |
| AC-27 | 相同操作并发只有一个执行 |
| AC-28 | 失败不写成功记录，可重试 |
| AC-29 | 24h 内重复偏离不重复写入；`--force` 可重复 |
| AC-30 | 只读命令不创建状态文件/锁 |
| AC-31 | `/sg-apply` 按 `[P]/depends` 分波次，最多 4 个 worktree 并行 |
| AC-32 | 合并冲突停止并保留 worktree/分支 |
| AC-33 | 非 Git 项目降级串行单写者 |
| AC-34 | 无标记的 tasks.md 默认串行 |
| AC-35 | 重复 `/sg-apply` 跳过已完成任务 |
| AC-36 | 30 个 Skill 全部可加载 |
| AC-37 | `/sg-doctor` 四维并行并汇总 |
| AC-38 | 不新增 MCP server/MCP 工具 |

## C14. v1.2 测试基线

`node --test` → **74 passed / 0 failed**。覆盖新增：幂等记录/force/并发锁、任务图解析与波次、worktree 并行/冲突/非 Git 降级、doctor 并行汇总、Skill `source` 校验。

## C15. v1.0.0 公开重命名与发布（2026-10-18，已确认）

### C15.1 命名

- 产品/插件：**SpecGate**；npm 包 `dsh-plugin-specgate`；仓库 `https://github.com/GM-Studio/dsh_sg_plugin`。
- 命令/工具前缀：`sg-` / `sg_`；项目数据目录 `.specgate/`；项目 Skill `.dsh/skills/specgate/`；Skill `sg-skill-*`；Agent `sg-agent-*`。
- 移除所有用户可见的 `/ak47-*`、`ak47_*`、`.ak47/`、`opsx-*` 标识；仅在 README/LICENSE 保留“源自 AgentKit47-Qoder”的来源说明。
- worktree 分支使用 `specgate/<change>/<task>`；提交前缀使用 `specgate(...)`。

### C15.2 迁移

- `/sg-migrate` 与 `sg_migrate` 把 `.ak47/` 迁移到 `.specgate/`。
- 默认备份旧目录为 `.ak47.backup-<timestamp>`，复制 config/gates/deviations/state，重写受管引用，并写迁移报告。
- `--dry-run` 只预览；`--force` 在 `.specgate/` 已存在时先备份目标再迁移。
- 已有 `ak47/*` worktree/分支只报告，不自动移动。

### C15.3 配置与生命周期

- 全局 profile 插件 config 提供新项目默认值：`defaultEnabled`、`enforcement`、`maxConcurrency`、`git`、`language`、`materializeSkills`、`materializeAgents`。
- 项目 `.specgate/config.yaml` 覆盖全局默认；全局默认不会静默改写已有项目。
- 全局启动/关闭由 DSH 插件管理器的 bundle 开关负责；项目级启动/关闭为 `/sg-enable` / `/sg-disable`；无后台常驻进程。

### C15.4 双语

- 中文为权威源，英文为完整兄弟翻译。
- 布局：英文 `README.md`、`SKILL.md`、`agent.md`、模板与文档；中文 `*.zh.md` 兄弟文件。
- `language: zh|en` 选择运行时 Skill/Agent/docs 内容与命令/报告语言，默认 `zh`。
- 已有项目切换语言后需 `/sg-init --force` 重新物化。

### C15.5 发布

- npm 公共包，MIT，作者 `andy.zx`。
- GitHub Actions：push/PR 跑 CI；tag 触发 `npm publish --access public --provenance`，使用 `NPM_TOKEN` secret。
- 安装：`plugin_manager install_bundle target=dsh-plugin-specgate`。
- 不新增 MCP server/MCP 工具。

### C15.6 测试基线

`node --test` → **89 passed / 0 failed**。新增覆盖：迁移 dry-run/force/备份、配置优先级、语言变体选择、双语清单配对、30 Skill + 9 Agent 标识一致。
