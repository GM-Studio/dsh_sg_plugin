# SpecGate 工作流（DSH）

> 由 `dsh-plugin-specgate` 2.x 生成。以下规则在当前项目生效。
> 状态：`/sg-status`；下一步：`/sg-next`；门控：`/sg-gate <Gx>`；提交：`/sg-commit`。

## 核心原则

- 用户指令优先；不确定时先提问，不臆想 API、配置或文件内容。
- 任何修改请求先做入口判定：答疑 / 轻量 / 重量；重量修改需要 L1/L2/L3 分类。
- 项目只有一份当前有效需求：`requirements/REQUIREMENTS.md`。
- 需求变更必须版本化。禁止静默修改当前需求；用 `/sg-change <id>` 创建变更包，经 G3 批准后生成新版本。
- `requirements/history/vX.Y.Z/` 中的历史版本只读。
- design、specs、tasks、tests、report 可以存在，但必须引用需求 ID/版本，不能复制需求正文。
- **1% 规则**：只要有 1% 可能某个 Skill 适用，就先加载。
- 不跳过门控；用户说“继续”不等于批准。

## 需求与版本链

```text
requirements/
├── REQUIREMENTS.md                 # 当前已批准需求
├── history/vX.Y.Z/REQUIREMENTS.md  # 不可变快照
└── changes/<change>/
    ├── change.md                   # 意图/范围/影响，不复制完整需求
    ├── change.json                 # added/modified/deprecated/acceptance 增量
    ├── design.md
    ├── tasks.md
    ├── tests/cases.md
    ├── tests/matrix.md
    ├── approval.md
    └── test-report.md
```

- `/sg-change <id>` 创建变更包。
- G3 批准增量后写入新版本和快照。
- G3 之后需求再变，必须新建 change 和版本。

## 门控

| 门控 | 含义 |
|---|---|
| G1 | 需求理解/基线确认 |
| G2 | 变更分类（L1/L2/L3） |
| G3 | 需求增量批准与版本落盘 |
| G4 | design 评审 |
| G5 | 测试计划/用例评审并冻结 |
| G6 | tasks 评审 |
| G7 | 进入实施 |
| G8 | 测试执行通过 |
| G9 | 代码审查 + 提交 |
| G10 | 功能验收 |
| G11 | 分支处理 |

- 一次一个门控；命令确认必须带 `--yes`。
- G5 冻结测试用例；之后修改预期需重新审批。
- G8 需要通过的测试报告和覆盖率。

## 测试 Agent 与及格线

- `sg-agent-tester` 与实现者独立。
- 测试用例和自动化必须在编码前写好。
- 测试在独立 test worktree 执行；tester 禁止修改生产代码。
- 及格线：P0/P1 100%，P2 至少 90%，行覆盖至少 80%，分支覆盖至少 70%；构建/类型检查/lint 必须通过；不允许新增回归。
- 单元测试和集成测试必须做；可自动化的 E2E 必须做；最终人工验收在 G10。

## Worktree 与合并

```text
开发：specgate/<change>/<task>-dev
测试：specgate/<change>/test
```

- 每个开发任务独立 worktree。
- 每个 change 一个测试 worktree。
- 主 Agent 是唯一合并者。
- 测试失败返回开发 Agent 修复，tester 重新执行。
- tester 不合并、不提交生产代码、不修改测试预期来强行通过。

## 常用命令

- `/sg-init` — 初始化 v2 项目与需求基线。
- `/sg-change <id>` — 创建需求变更包。
- `/sg-test <change> plan|run` — 测试 Agent 编写/执行测试。
- `/sg-status` — 项目、需求版本、change、门控、测试状态。
- `/sg-next` — 下一步建议。
- `/sg-gate <Gx> [status|confirm --yes|waive --yes <原因>]`。
- `/sg-commit <message>`。
- `/sg-apply <change>` — 按 `[P]`/`depends` 派发开发任务。
- `/sg-archive <change>`。
- `/sg-migrate` — `.ak47/` → `.specgate/`。
- `/sg-requirements-migrate` — 旧 `openspec` → `requirements/REQUIREMENTS.md`。

## Git 与提交

- 每个门控确认前工作区必须 clean；先提交或 `/sg-commit`。
- Conventional Commits：`<type>(<scope>): <description>`。
- G11 后不得留下孤立 dev/test 分支。

## Agent

`.specgate/agents/` 共 10 个角色：po、architect、ddd、developer、reviewer、knowledge-engineer、process-guardian、config-maintainer、scaffold-maintainer、tester。

## DSH 输出

- 工具结果显示为工具卡片；命令结果显示为持久命令卡片。
- 空会话第一条命令可能额外写 `notice`；禁止在 `tool_use` 与 `tool_result` 之间插入消息。
- SpecGate 不提供 MCP server/tools；MCP 由 DSH 独立管理。
