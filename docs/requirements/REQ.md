# SpecGate v1.1 需求基线

**文档 ID**：REQ-SPECGATE-1.1
**版本**：v1.0（已确认基线）
**状态**：Approved（2026-10-18）。按用户决定，本文档**暂不进入插件门控流程**，以文档审批作为确认依据，不写 `.specgate` 标记。
**批准日期**：2026-10-18（v0.1 对话批准 → v0.2 独立审核修订 → v1.0 定稿）
**适用范围**：`dsh-plugin-specgate` 插件及其在用户项目中建立的 AI 协同工作流
**唯一性声明**：本文件是该改造的**唯一**需求基线。设计、任务、测试、验收均以本文件的 `REQ-xxx` 为准；任何新增需求必须走 `changes/vX.Y/delta.md`，不得散落在其他文件。

---

## 0. 一句话

把「需求」变成项目里唯一且带版本链的事实源，把「实现—测试—审查」变成由独立 Agent 在各自工作区完成、以证据写回、由机器判定及格的工作流；人类只在 4 个断点出现。

---

## 1. 术语

| 术语 | 定义 | 不要叫 |
|---|---|---|
| 需求基线（REQ） | 项目唯一权威需求文档 `REQ.md`，永远是**最新**版本 | 需求文档、PRD、proposal |
| 版本快照 | `history/vX.Y/REQ.md`，批准后**只读**，不可修改 | 备份、归档 |
| 变更包 | `changes/vX.Y/`，一次需求变更的全部产物（delta/design/tasks/tests） | change、提案 |
| 需求条款 | `REQ-xxx`，基线里一条不可拆的约束 | 需求点、条目 |
| 验收用例 | `AC-xxx`，可直接执行的判定条件（Given/When/Then），必须声明 `covers:` | 测试用例（二者不同） |
| 测试用例 | `T-xxx`，AC 的具体实现形式，含正/反/边界 | 单测 |
| 证据对象 | `evidence/Gx.json`，门控的机器可判定依据 | 报告、记录 |
| 工作区 | 每个 Agent 独立的 git worktree + 分支 | 沙箱 |
| 写回 | Agent 向主 Agent 提交结构化交接包，不直接改主干 | 提交、合并 |

---

## 2. 目录与数据模型

```text
openspec/
├── REQ.md                    # 唯一基线（最新）
├── queue.yaml                # 变更包队列（REQ-008）
├── history/
│   └── v1.0/REQ.md           # 只读快照
├── changes/
│   └── v1.1/                 # 变更包
│       ├── delta.md          # REQ 增量（新增/修改/废弃哪些 REQ-xxx）
│       ├── design.md         # 设计与取舍
│       ├── tasks.md          # 垂直切片任务（T-xxx 关联 AC）
│       ├── tests/
│       │   ├── cases.md      # 用例清单（AC → 正/反/边界）
│       │   └── *.test.js     # 可执行测试
│       └── evidence/         # G1–G11 证据对象
├── changes/v1.1/fixes/<id>/  # L3 修复（不升版本，REQ-009）
└── archive/v1.1/             # 版本冻结后的整包
```

### REQ-001 需求只能写在基线或增量里

需求语义只允许出现在 `REQ.md` 与 `changes/*/delta.md`。

**可机器判定部分**：形如 `### REQ-` 的条款标题、以及 `REQ-\d{3}` 编号，只允许出现在上述两个位置；出现在其他文件（proposal、design、tasks、注释、README）即判 error，由 `sg_doctor` 报出。
**不可机器判定部分**（散落的自然语言需求）由 G1 人工评审兜底，不承诺自动检测。

### REQ-002 每个变更包自包含

一个变更包必须能在脱离对话历史的情况下被理解与验收：包含增量、设计、任务、用例、证据五类产物。

L3 修复包（`fixes/<id>/`）的最小产物集为：`fix.md`（现象/根因/修复方案）、`tasks.md`、`tests/`、`evidence/`；不要求 delta 与 design。

---

## 3. 需求基线与版本链

| 编号 | 规则 |
|---|---|
| REQ-003 | 一个项目有且仅有一份 `REQ.md`；所有设计与测试必须引用其中的 `REQ-xxx` |
| REQ-004 | 需求变更只能通过新建 `changes/vX.Y/delta.md` 发起，禁止直接改 `REQ.md` |
| REQ-005 | G10 通过后由 G11 事务写回基线（见 REQ-010），失败则整体回滚、版本号不前进 |
| REQ-006 | 快照只读；任何修改都必须走下一个版本 |
| REQ-007 | 每个 REQ 条款有稳定 ID，废弃不删除，标记 `status: deprecated` 并注明被谁取代；ID 永不复用 |
| REQ-008 | 同一时刻只允许一个进行中的需求变更包，排队用 `openspec/queue.yaml` 表示（`version` / `priority` / `state` / `requested_at`）；当前包到 G11 后激活下一个，或由 `/sg-req activate <version>` 人工指定 |
| REQ-009 | L3 缺陷修复默认不改需求基线、不升版本，归档到 `changes/<当前版本>/fixes/`（产物见 REQ-002） |
| REQ-010 | 基线冻结与 G11 受控写回（见下） |

### REQ-010 基线 hash 与受控写回

- G1 冻结时对 `REQ.md` 取 hash，写入 `evidence/G1.json`。
- **除 G11 的受控合并事务外**，任何时点 `REQ.md` 的 hash 与 `G1.json` 不一致，即视为基线被篡改，G3–G10 全部失效。
- G11 事务：① 合并 delta 进 `REQ.md` → ② 重算 hash 写 `evidence/G11.json` → ③ 写 `history/vX.Y/REQ.md` → ④ 打 annotated tag `sg-vX.Y` → ⑤ 归档变更包 ⑥ 清理 G1 旧 hash。
- 事务任一步失败 → 回滚全部步骤，版本号不前进，变更包保持打开。

---

## 4. 追溯链

```text
REQ-003 ──▶ AC-007 ──▶ T-012 ──▶ 测试文件/用例 ──▶ 代码 diff ──▶ 验收结果
```

### REQ-011 强制编号与双向追溯

- 每个 AC 必须声明 `covers: [REQ-xxx]`；每个 T 必须声明 `ac: [AC-xxx]`。
- G1 校验：全部 active AC 的 `covers` 并集 **等于** 全部 active REQ 集合；未覆盖的 REQ 使 G1 不通过。
- G4 校验：每个 AC 至少被一个 T 覆盖。
- G7 校验：每个 AC 至少一个已执行用例。

### REQ-012 追溯可查询

给定任意 `REQ-xxx`，列出 AC / T / 测试文件 / 代码文件 / 验收结果。代码文件来自写回交接包的 `changedFiles`，**不要求静态分析**。

---

## 5. 测试体系

| 编号 | 规则 |
|---|---|
| REQ-013 | G1 通过后先做设计（G3）；**G3 确认后**才启动 test-design agent 编写用例，G4 人审后生效。G3 重开即作废 G4 及后续门控 |
| REQ-014 | 产物 = 用例清单 `cases.md` + 可执行测试代码，二者按 `T-xxx` 一一对应 |
| REQ-015 | 每个 AC 至少 **1 个正向 + 1 个异常/边界**用例；分支路径必须以 `BR-xxx` 编号在清单中显式列出 |
| REQ-016 | 测试代码**只允许 test agent 写**；开发 agent 对 `tests/**` 只读 |
| REQ-017 | 编码前必须验证 RED：测试可运行且因**断言失败**（非语法/环境错误）而失败；证据须含失败断言与错误片段 |
| REQ-018 | 编码后由**独立 test-runner agent** 在干净工作区执行，不接受开发 agent 自报结果 |
| REQ-019 | 覆盖率、通过率、AC 结果写入 `evidence/G7-<T>.json`（逐任务）与 `evidence/G7.json`（汇总） |

---

## 6. 及格线（机器判定）

### REQ-020 及格线定义

```text
通过 = AC 全部通过
     ∧ 本变更 diff 命中文件的行覆盖 ≥ 80%（分母 = 变更涉及的可执行文件）
     ∧ 全项目分支覆盖 ≥ 70%（Node 内置 coverage 口径）
     ∧ 相比上一版本快照，行覆盖下降 ≤ 2 个百分点
     ∧ 每个 AC 至少 1 正 + 1 反用例且均执行
     ∧ 无 skip / todo 用例
```

- 覆盖率来源：Node 内置 `--experimental-test-coverage`（零外部依赖，已实测可用）。
- 不采用「无新增未覆盖分支」——该口径无法稳定定义分支身份，改为「变更文件覆盖 + 不回归」。
- 阈值写入 `.specgate/config.yaml`，可按项目调整，但不得低于以上默认值。

### REQ-021 判定不可被自述覆盖

开发 agent 的自我评价只能作为参考写入报告，不能作为任何门控的通过依据。

---

## 7. Agent 与工作区

| 角色 | 工作区 | 写权限 | 产出（写回） |
|---|---|---|---|
| 主 Agent（编排） | 主干 | 只合并、只写状态 | 调度决策、证据校验结果 |
| test-design | `worktrees/vX.Y/tests` | 仅 `tests/**`、`cases.md` | 用例包 + RED 证据 |
| implementer × N | `worktrees/vX.Y/<T-xxx>` | 仅源码目录，`tests/**` 只读 | 分支 + commit + 测试证据 |
| test-runner | 干净检出（只读） | 仅报告 | 执行结果 + 覆盖率 |
| reviewer | 候选 diff（只读） | 仅报告 | 结构化审查（P0/P1，带 file:line） |
| integrator（主 Agent 执行） | 集成分支 | 合并 | 冲突报告 / 回归结果 |

### REQ-022 权限由机制限制

角色工具集按上表裁剪（reviewer / test-runner 默认无写工具）；此外设**合并前硬校验**：

> 候选分支相对集成分支的 diff 中，`tests/**` 与 `.specgate/**` 必须**零改动**。任何改动（包括 shell 写出来的）一律拒绝合并，并判该任务失败。

这条不依赖工具白名单，因此对 shell 绕过同样有效。

### REQ-023 独立工作区

开发与测试 agent 各自拥有独立 worktree 与分支；工作区之间不得互相写入。

---

## 8. 门控（保留 G1–G11 编号）

| Gate | 谁 | 通过条件（机器可判定） |
|---|---|---|
| **G1 需求理解确认** | **人** | REQ hash 冻结 + 每个 REQ 有 AC 覆盖 + 人确认 |
| G2 变更分类确认 | 系统（人可改） | 版本号分配 + L1/L2/L3 + 影响面清单 |
| **G3 设计评审** | **人** | delta 引用 REQ、设计含固定小节：备选方案 / 代价 / 影响面 / 风险 |
| **G4 用例评审** | **人** | 每个 AC 有正/反用例、`BR-xxx` 分支清单完整、RED 证据存在 |
| G5 实施就绪 | 系统 | 测试分支已合并、任务图无环、每任务有 Brief |
| G6 实施完成 | 系统 | 全部任务合并成功、无冲突残留、无未提交改动、预算未超 |
| G7 独立验证 | 系统 | 逐任务证据齐全 + 及格线满足（REQ-020） |
| G8 独立审查 | 系统 | reviewer P0=0、P1 已修或已记录 |
| G9 集成就绪 | 系统 | 集成分支全量回归通过 + 证据齐全 + 工作区干净 |
| **G10 验收** | **人** | AC 全部执行并展示结果 + 证据链完整 |
| G11 版本冻结 | 系统 | 按 REQ-010 事务完成 |

### REQ-024 人类断点仅 4 个

正常路径只有 G1 / G3 / G4 / G10 请求人类输入。
**红灯升级不计入**：3 轮失败、预算超限、证据矛盾时的升级询问，属于异常路径。

### REQ-041 门控 marker 版本化

- 新 marker 必须带 `schemaVersion: 2`。
- v1 的无版本 marker 在迁移时移入 `.specgate/legacy-gates/` 并清空，**不得**被直接视为 satisfied。
- 旧 G3–G7 的语义（proposal/design/specs/tasks/批判性审核）与新语义不同，迁移必须留证并重新走门控。

---

## 9. 写回协议

### REQ-025 结构化交接包

```json
{
  "agent": "implementer",
  "taskId": "T-012",
  "branch": "sg/v1.1/T-012",
  "commit": "9f3c2a1",
  "changedFiles": ["src/auth/login.ts"],
  "tests": {
    "cmd": "node --test",
    "exitCode": 0,
    "passed": 42,
    "failed": 0,
    "coverage": { "lines": 0.86, "branches": 0.74 }
  },
  "acCovered": ["AC-007"],
  "selfReport": "仅供参考，不参与判定"
}
```

### REQ-026 主 Agent 校验写回

主 Agent 必须校验：commit 存在、diff 非空、测试退出码 0、AC 覆盖成立、**`tests/**` 与 `.specgate/**` 零改动**。任一不成立 → 判失败，不进合并队列。

### REQ-027 失败即假绿

任何情况下**不得**把未合并成功的任务标记为完成。

---

## 10. 失败、范围变化与回退

### REQ-028 自动回退与升级

测试失败 / 审查 P1 / 合并冲突 → 自动回退给对应 agent，最多 **3 轮**（可配置）；超限停止派发，输出「卡在哪、证据是什么、人需要决定什么」。

### REQ-031 实现中发现需求缺口（scope 变化）

- 立即停止该变更包的派发（不再启动新任务）。
- 只能追加 `changes/vX.Y/delta.md`，由人确认后重走 G3 → G4。
- 需求缺口导致的 G4–G10 证据全部作废；**禁止**实现 agent 自行改 AC、测试或基线。

### REQ-032 测试用例本身有误

- implementer 无权改测试；只能提交 `test-defect` 证据（失败断言、怀疑的用例 ID、复现方式）。
- test agent 修正用例后，该 AC 的 G4 证据作废，触发 **G4 增量复核**（只审被改的 T-xxx），并重跑 RED。
- 修正记录写入 `evidence/G4.json` 的 `revisions` 字段。

### REQ-033 G10 验收不通过

- 冻结变更包，禁止新的合并。
- 回退到本变更开始前的基线 tag（`sg-vX.Y-1` 或 G6 前的证据快照）。
- 现有证据标记 `superseded`，版本号不前进，重新走 G7–G10。
- 若返回修改需求 → 按 REQ-031 处理。

### REQ-034 L3 hotfix 并发

L3 修复可与一个活跃变更包并行，条件是：基于当前 `sg-vX.Y` tag、使用独立分支 `sg/fix/<id>`、独立 worktree；门控只要求 G2 / G6 / G7 / G8 / G9 / G10。hotfix 不得修改 REQ 基线与任何进行中变更包的文件。

---

## 11. 预算与安全

### REQ-035 逐任务验证证据

每个任务合并前，必须由 test-runner 在该任务 worktree 执行测试并产出 `evidence/G7-<T>.json`；合并后再跑一次集成分支全量。汇总 `G7.json` 不得替代逐任务证据。

### REQ-036 预算上限

- 单变更包：agent 会话数 ≤ 40、总 token 上限、单任务超时 30 分钟、总时长 8 小时（均可配置）。
- 超限 → 停止派发并升级给人；实际消耗写入 `evidence/G6.json`。

### REQ-037 shell 绕过

任何 agent 都可能有 shell。因此「写权隔离」的真值不靠工具白名单，而靠 REQ-022 的合并前 diff 硬校验：`tests/**`、`.specgate/**` 零改动，否则拒绝合并。工具裁剪只用于减少误操作，不作为安全边界。

---

## 12. 兼容与版本映射

### REQ-029 命令与门控编号保持

保留 `/sg-init`、`/sg-status`、`/sg-next`、`/sg-gate`、`/sg-commit`、`/sg-apply`、`/sg-doctor`。
新增：`/sg-req new|change|freeze|activate`、`/sg-verify`。G1–G11 编号不变（语义变更见 REQ-041）。

### REQ-030 旧项目迁移

旧项目（`openspec/changes/<name>/` 无版本号）通过迁移映射为 `v1.0`：每个旧 change 变成一个变更包，凭现有产物补齐 delta/design/tasks/tests；无法补齐的标记 `legacy` 并冻结，不得进入新流程。

### REQ-038 版本与 Git 映射

- 需求版本：`sg-vX.Y`（annotated tag，G11 打）。
- 分支：主集成 `main`；变更集成分支 `sg/vX.Y/integration`；任务分支 `sg/vX.Y/<T-xxx>`；用例分支 `sg/vX.Y/tests`；修复分支 `sg/fix/<id>`。
- 插件自身发版：`vX.Y.Z`（npm/GitHub release），与需求版本**刻意分离**，避免两套语义混用。

### REQ-039 旧需求基线退役

`docs/design/requirements-confirmation.md` / `.zh.md` 迁至 `openspec/history/v1.0/REQ.md`（保留原文，标注 `superseded`），并更新引用它的文档链接。旧文档中的 `AC-01…AC-09` 编号不复用。

### REQ-040 AC 结构

每个 AC 以结构化块存在：

```yaml
- id: AC-007
  covers: [REQ-011, REQ-020]
  given: 用户在未登录状态访问受保护页面
  when: 点击登录并输入正确凭证
  then: 跳转回原页面且会话有效
  type: positive | negative | boundary
```

G1 校验 `covers` 并集完整性；G4 校验每个 AC 有正/反用例；G7 校验每个 AC 至少一条已执行。

---

## 13. 验收标准（DoD）

| 编号 | 验收项 | 通过条件 |
|---|---|---|
| AC-01 | 单一事实源 | 项目内只有一份 `REQ.md`；`REQ-` 编号出现在其他文件时 doctor 报 error |
| AC-02 | 版本链 | 连续两次变更后 `history/v1.0`、`history/v1.1` 存在且只读；G11 生成 `sg-vX.Y` tag |
| AC-03 | 追溯完整 | 随机抽 3 个 REQ，能列出其 AC / T / 测试 / 代码文件（来自 changedFiles） |
| AC-04 | 用例先行 | 编码前测试必然 RED，且证据包含失败断言而非语法错误 |
| AC-05 | 写权隔离 | implementer 的候选 diff 若含 `tests/**` 改动，合并被拒绝（对 shell 同样有效） |
| AC-06 | 独立验证 | 开发 agent 自报成功但测试未过时，任务判失败 |
| AC-07 | 及格线 | 变更文件行覆盖 < 80% 或相对上版下降 > 2pp 时无法通过 G7 |
| AC-08 | 假绿不可复现 | 合并失败的任务永远不会被标记 `[x]` |
| AC-09 | 写回协议 | 子 agent 无结构化交接包时，主 agent 拒绝合并 |
| AC-10 | 人工断点 | 正常路径只有 G1/G3/G4/G10 请求人类输入；红灯升级不计入 |
| AC-11 | 冲突升级 | 3 轮失败后停止并把证据交给人 |
| AC-12 | 范围变化 | 实现中改需求被拒绝，且自动停派、要求追加 delta |
| AC-13 | 验收回退 | G10 不通过后版本号不前进、证据标 superseded、可回到 G7 重跑 |
| AC-14 | 预算 | 超过 agent/token/时长上限时停止派发并升级 |
| AC-15 | marker 迁移 | v1 旧 marker 不再被识别为 satisfied，且留有 legacy 证据 |
| AC-16 | hotfix 并行 | L3 修复可在活跃变更包存在时独立完成，且不触碰基线 |

---

## 14. 非目标

不做 Web UI；不做多租户；不做云服务；不改变团队既有 Git 流程；不追求 100% 覆盖率。

---

## 15. 已确认决策

| # | 决策 | 状态 |
|---|---|---|
| D1 | 同一时刻只允许一个进行中的需求变更包（其余排队，见 REQ-008） | 已确认 |
| D2 | 版本号 = `vMAJOR.MINOR`，一次需求变更 minor+1 | 已确认 |
| D3 | L3 缺陷修复不升版本，归入当前版本的 `fixes/` | 已确认 |
| D4 | 首期只保证 Node 技术栈的测试执行与覆盖率 | 已确认 |
| D5 | 覆盖率口径：变更文件行覆盖 + 全项目分支覆盖 + 不回归 | 审核采纳 |
| D6 | 「无新增未覆盖分支」不作为判定条件（不可稳定定义） | 审核采纳 |
| D7 | 代码追溯来自 changedFiles，不做静态分析 | 审核采纳 |
| D8 | test-runner 保持为独立 agent（否决「降级为受限进程」的建议） | 与 REQ-018 一致 |

---

## 16. 审核处置记录

v0.2 采纳：REQ-010 受控写回、REQ-024 红灯豁免、REQ-041 marker 版本化、REQ-031～035（范围变化/测试纠错/验收回退/hotfix/逐任务证据）、REQ-036 预算、REQ-037 shell 边界、REQ-038 版本映射、REQ-039 旧基线退役、REQ-040 AC 结构。

v0.2 否决：将 test-runner 降级为受限进程（与用户明确要求的「专门测试 agent」冲突，保留 REQ-018）。

v0.2 修正：REQ-001 改为「语法可判定 + G1 语义兜底」；REQ-020 改为三项覆盖判据。

---

## 17. 变更记录

| 版本 | 日期 | 变更 | 批准 |
|---|---|---|---|
| v0.1 | 2026-10-18 | 初版基线（对话批准） | 用户 |
| v0.2 | 2026-10-18 | 独立审核修订：补 10 条、改 3 条、否决 1 条 | 用户 |
| v1.0 | 2026-10-18 | 定稿；按用户决定暂不走插件门控流程 | 用户 |
