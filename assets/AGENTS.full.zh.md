# SpecGate 工作流（DSH）

> 本文件由 `dsh-plugin-specgate` 生成。以下规则在当前项目内生效。
> 状态：`/sg-status`；下一步：`/sg-next`；门控：`/sg-gate <Gx>`；提交：`/sg-commit`。

## 核心原则

- 用户指令优先；不确定时先提问，不臆想 API、配置或文件内容。
- 任何修改请求先做入口判定：答疑 / 轻量修改 / 重量修改。
- **1% 规则**：只要有 1% 可能某个 Skill 适用，就先加载它；认为不需要时必须说明原因并取得用户同意。
- 不跳过门控；用户说“继续”只表示继续当前讨论，不表示跳过评审。
- 不按技术组件/层次水平切分 Spec；每个 Spec 必须描述端到端用户价值。
- 禁止过度设计、表面修复、无目标执行。

## 门控

| 门控 | 名称 | 触发 | 通过条件 |
|------|------|------|----------|
| G1 | 需求理解确认 | 需求盘问完成 | 用户明确确认理解正确 |
| G2 | 变更分类确认 | L1/L2/L3 建议完成 | 用户确认范式 |
| G3 | proposal 评审 | proposal.md 完成 | 用户确认通过 |
| G4 | design 评审 | design.md 完成 | 用户确认通过 |
| G5 | specs 评审 | specs/ 完成 | 垂直切片、覆盖需求、用户确认 |
| G6 | tasks 评审 | tasks.md 完成 | 拆分合理、粒度合适、用户确认 |
| G6.5 | Brief 生成检查 | 大型变更 | 生成 Brief 或记录偏离 |
| G7 | 批判性审核/实施 | tasks 通过后 | 用户批准进入实施 |
| G8 | 代码审查 | 代码完成 | 用户确认启动审查 |
| G9 | 审查通过/提交 | 审查完成 | 用户确认提交 |
| G10 | 功能验收 | 开发完成 | 用户确认验收 |
| G11 | 分支处理 | 测试通过 | 用户确认合并/PR |

- 一次只等待一个门控确认；禁止合并询问多个 artifact。
- 命令通道确认必须显式带 `--yes`：`/sg-gate G1 confirm --yes`；未带时只返回待确认提示。
- 跳过门控必须：说明原因、告知用户、用户批准、`/sg-gate <Gx> waive --yes <原因>` 并写入 `.specgate/deviations.log`。

## 范式

| 范式 | 含义 | 门控强度 |
|------|------|----------|
| L1 | 需求驱动 | G1-G11 全量 |
| L2 | 技术实现 | G1-G11 标准 |
| L3 | 缺陷修复 | 可跳过 G1/G3/G4/G5；G2/G6/G7-G11 必须 |

## 技能导航

核心：`sg-skill-entry-guard`、`sg-skill-change-classification`、`sg-skill-requirements-definition`、`sg-skill-critical-review`、`sg-skill-test-driven-development`、`sg-skill-code-review`、`sg-skill-vertical-slicing`、`sg-skill-triage-brief`。

支撑：`sg-skill-architecture-design`、`sg-skill-domain-modeling`、`sg-skill-systematic-debugging`、`sg-skill-writing-plans`、`sg-skill-executing-plans`、`sg-skill-experience-summarization`、`sg-skill-knowledge-retrieval`、`sg-skill-knowledge-research`、`sg-skill-anti-patterns`、`sg-skill-terminology-management`、`sg-skill-prototype`、`sg-skill-zoom-out`。

完整 30 个 Skill 位于 `.dsh/skills/specgate/`，按需通过 `skill` 工具加载。

## Agent 角色

- `sg-agent-po`：需求澄清、验收标准、优先级、评审。
- `sg-agent-architect`：Spec 拆分、依赖排序、技术路径、架构评审。
- `sg-agent-ddd`：领域驱动设计、限界上下文、聚合设计。
- `sg-agent-developer`：Spec Task 实现、代码编写、单元测试。
- `sg-agent-reviewer`：代码审查、质量评估、反模式检测。
- `sg-agent-knowledge-engineer`：经验沉淀、ADR 维护、知识冲突裁决。
- `sg-agent-process-guardian`：范式执行、规则遵守、偏离记录、流程审计。
- `sg-agent-config-maintainer`：`.specgate/` 目录治理、配置一致性、版本管理。
- `sg-agent-scaffold-maintainer`：生成资产通用性审计、导入导出验证。

角色文本位于 `.specgate/agents/`；当前版本以主 Agent + Skill 承载，不强制拆独立 subagent。

## Git 工作流

- 初始化默认执行 `git init` 并创建初始 commit。
- **每个门控确认前，工作区必须 clean**；有未提交改动时先 `/sg-commit` 或手工 commit。
- 确认门控会写 `.specgate/gates/<Gx>.confirmed`，该标记本身也是变更，需在下一次门控前提交。
- Commit 使用 Conventional Commits：`<type>(<scope>): <description>`；type 仅限 feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert；description 使用中文，不超过 72 字符，不以句号结尾。
- 开始新功能前从 `master`/`main` 创建 `feat/`、`fix/`、`refactor/`、`docs/` 分支。
- 功能完成后处理分支：合并 / PR / 保留 / 丢弃；不得留下孤立开发分支。

## 知识沉淀

- 触发：完成工具/框架调研、解决 P0/P1 Bug、做出重要技术决策、发现可复用最佳实践或反模式。
- 目录：`.specgate/experiences/{tool-research,best-practices,pitfall-records,decisions}/`。
- 入口：`.specgate/experiences/index.md`、`trigger-guide.md`。
- 记录必须包含时间、来源、结论、适用范围、验证状态；禁止记录未经验证的假设。

## 文件布局

```text
.specgate/
├── config.yaml
├── gates/<Gx>.confirmed | <Gx>.waived
├── deviations.log
├── agents/
├── templates/
├── rules/
├── briefs/
├── out-of-scope/
├── experiences/
└── reviews/
.dsh/skills/specgate/<skill>/SKILL.md
openspec/changes/<change>/{proposal.md,design.md,tasks.md,specs/**}
openspec/specs/
.specgate/state/            # 幂等/派发记录，自动忽略
.specgate/worktrees/        # 并行任务 worktree
.specgate/reports/          # 并行派发报告
```

## 常用命令

- `/sg-init`：初始化项目；`--path` 新建目录；`--minimal` 轻量；`--no-git` 关闭 Git。
- `/sg-status`：项目、Change、Artifact、门控、Git 状态。
- `/sg-next`：下一步建议。
- `/sg-gate <Gx> [status|confirm --yes|waive --yes <原因>]`：门控操作。
- `/sg-commit <message>`：提交当前变更。
- `/sg-classify <描述>`：建议 L1/L2/L3。
- `/sg-doctor`：健康体检（四维并行）。
- `/sg-propose <name>`：创建 Change 骨架。
- `/sg-apply <name> --plan`：查看并行任务计划。
- `/sg-apply <name>`：执行实现；按 `[P]` / `depends` 分波次，最多 4 个 Agent 并行，每任务独立 worktree。
- `/sg-archive <name>`：归档。

## 幂等与并行约定

- 修改类命令可安全重复执行：状态已达成会返回“幂等跳过”；不要为了重跑而手工删状态文件。
- `deviation` 默认 24h 去重；确实要重复记录时加 `--force`。
- `tasks.md` 中用 `[P]` 标记可并行任务，用 `depends: T1,T2` 声明依赖，用 `role: reviewer` 指定角色；没有标记默认串行。
- worktree 并行要求工作区 clean；非 Git 或 dirty 会自动降级串行单写者。
- 合并冲突会停止并保留 worktree/分支，先人工解决冲突，再重新执行。
- 不要同时手工修改正在被 Agent 派发的文件。

## DSH 输出约定

- 工具结果由工具卡片显示；命令结果由持久命令卡片显示。
- 新会话的第一条命令会额外写入一条 `notice` 上下文消息，确保结果可见并进入历史；不要在工具调用与工具结果之间插入任何消息。
- 插件不提供 MCP server；MCP 能力由 DSH 独立管理。
