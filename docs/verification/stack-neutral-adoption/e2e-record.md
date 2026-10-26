# M8 端到端验收记录

日期：2026-10-26
状态：**部分通过** —— 可在本机真实仓库上验证的 E2E 已执行；需业务生产环境的项如实标 `NOT_RUN`。

## 1. 使用的真实仓库

本机存在的真实 Git 仓库（非 fixture）：

| 仓库                            | 技术栈            | HEAD      |
| ------------------------------- | ----------------- | --------- |
| `E:/ai_workflow/pilot-node-api` | Node.js + npm     | `bbcc758` |
| `E:/ai_workflow/pilot-py-api`   | Python + Makefile | `70630bc` |
| `E:/ai_workflow/pilot-is-odd`   | Node.js + npm     | `2a00d9b` |

三者**均无 Maven、无 Vue/React**，正是 E2E-01 所需形态。

## 2. E2E-01 非 Java/Vue 仓库缺少业务工具链 —— 通过

| 仓库           | detectProject | stack          | 模块                | 能力 | 缺口            | 扫描          |
| -------------- | ------------- | -------------- | ------------------- | ---- | --------------- | ------------- |
| pilot-node-api | ok            | javascript-npm | `root/library/npm`  | 4    | 1（无约定入口） | 77 文件，完整 |
| pilot-py-api   | ok            | make+python    | `root/other/python` | 2    | 1（无约定入口） | 49 文件，完整 |
| pilot-is-odd   | ok            | javascript-npm | `root/library/npm`  | 2    | 1（无约定入口） | 60 文件，完整 |

验收要点：

- 三个仓库**全部返回 `ok: true`**，无 `PROJECT_STACK_UNSUPPORTED` —— AC-01 达成；
- 未补造前后端模块，`moduleList` 反映真实构建事实 —— AC-02 达成；
- 缺口显式列出，扫描 `complete: true` 且 `unscanned: 0` —— AC-03 达成；
- **未安装任何依赖、未运行仓库脚本**。

### 2.1 本次暴露并修复的真实缺陷

`pilot-py-api` 只有 `requirements.txt` / `setup.cfg`，**没有** `pyproject.toml`，导致模块识别为空（`moduleList: []`）。

修复：`modules.js` 与 `stack.js` 的构建文件表补入 `setup.cfg`、`Pipfile`、`requirements.txt`，并新增两条断言锁定（含「两个探测器对 python 构建文件口径一致」）。

## 3. E2E-02 实现/文档/测试对同一行为冲突 —— 通过（展示层）

在 `pilot-node-api` 上并列读取多源证据：

| 来源           | 内容摘要                                  |
| -------------- | ----------------------------------------- |
| `README.md`    | `API with Express`                        |
| `package.json` | `name: api-with-nodejs`, `version: 1.0.0` |

候选基线把两者作为**独立来源并列保留**，不静默合并（这是 `candidates.js` 中 `sourceRefs` 的设计目的）。

**未做**：本轮未让真实用户对冲突做确认（需人工介入），因此「经用户确认真实目标」这一步标 `NOT_RUN`。

## 4. E2E-05 四类变更各一个实例 —— 通过（策略层）

| 场景             | 红基线策略        | 回归策略                |
| ---------------- | ----------------- | ----------------------- |
| 新增功能 feature | `target-only-red` | `unchanged-cases-green` |
| 修改功能 modify  | `target-only-red` | `unchanged-cases-green` |
| 修复 bug fix     | `reproduce-red`   | `unchanged-cases-green` |
| 重构 refactor    | `none`            | `all-green`             |

策略与场景一一对应，且**没有**要求所有场景先全红。

**未做**：未在真实仓库上把四类变更各跑一遍完整工作流（需要 H1 审批与真实用户确认），标 `NOT_RUN`。

## 5. E2E-08 超大仓库与敏感文件 —— 部分通过

| 仓库           | 跳过（疑似密钥） | 标记脱敏 | 扫描完整 |
| -------------- | ---------------- | -------- | -------- |
| pilot-node-api | 0                | 1        | 是       |
| pilot-py-api   | 0                | 0        | 是       |

两个真实仓库均完整扫描，无敏感文件被误当已分析。

**未做**：未找到真正「超大」的仓库来触发预算截断，也未有含真实密钥的仓库可测跳过。这两点由单元测试（`codex-scan-budget.test.js` 15 条）覆盖，标为「单元覆盖，真实样例 `NOT_RUN`」。

## 6. 未执行的 E2E（如实记录）

| 编号              | 场景                         | 状态      | 原因                                         |
| ----------------- | ---------------------------- | --------- | -------------------------------------------- |
| E2E-03            | 兼容与不兼容工具并存         | `NOT_RUN` | 需在 VM 上安装真实工具链做对照               |
| E2E-04            | 安装被拒绝/下载失败/校验失败 | `NOT_RUN` | 需 OI-04（下载源策略）确认后才能真实执行安装 |
| E2E-06            | 多任务并发 + 依赖 + 资源冲突 | `NOT_RUN` | 需真实多任务工作流（H1 审批后）              |
| E2E-07            | 宿主并发不足/超时/预算耗尽   | `NOT_RUN` | 同上                                         |
| E2E-09            | 普通变更 vs 内核变化         | `NOT_RUN` | 需真实关键版本闭环（OI-06 未定）             |
| E2E-02 用户确认   | 冲突经用户裁决               | `NOT_RUN` | 需人工介入                                   |
| E2E-05 完整工作流 | 四类各跑一遍                 | `NOT_RUN` | 需 H1 审批                                   |

## 7. 结论

可在**无人工审批介入**前提下验证的 E2E 已真实执行并通过。需要审批、安装或业务生产环境的项目保持 `NOT_RUN`，不以单元测试冒充。

M8 因此**不能**判定为完全通过；发布声明需等待上述 `NOT_RUN` 项具备条件。
