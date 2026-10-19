# SpecGate 协同工作流评审：机制、缺陷与目标态

> 评审对象：`dsh-plugin-specgate` v1.0.1（仓库 `E:\ai_workflow\specgate`，11 个提交，90 项测试通过）
> 评审视角：产品 / 交互设计 / 架构 / 并发与安全
> 评审方式：全量源码通读 + 文档与实现对照 + 可执行复现（见附录）

---

## 0. 一句话结论

SpecGate 把「门控式开发流程」实现成了 **写在系统提示词里的协议 + 散布在工作区里的文件标记**，
而不是一个 **由代码持有状态、由证据驱动、不可被被治理者改写的状态机**。

它现在能约束的只有一件事：**模型是否愿意配合**。
它不能约束的是：模型是否真的做了、做对了、测过了、审查过了——而这恰恰是「人类只做需求与验收」这个目标的前提。

---

## 1. 评审范围与事实基线

| 事实 | 说明 |
|---|---|
| 代码量 | `src/` 共 5,664 行 JS，13 个工具 / 15 个命令 / 30 个 Skill / 9 个角色文本 |
| 测试 | `node --test` → **90 passed / 0 failed**（本机复跑） |
| 提交历史 | 仅 **11 个提交，全部在 2026-10-18 同一天**；首个提交是整包 1.0.0（269 个文件 / +43,769 行），其后 5 个提交是发布后热修 |
| 自我使用 | 本仓库**没有 `.specgate/`、没有 `openspec/changes/`**：这套流程没有用它自己来开发自己 |
| 文档自述 | 架构文档明确承认「shell 写文件绕过 guard」，验收记录明确写「9 个 Agent 目前只是角色文本」 |

两个「元层面」的信号值得先记住：

1. **单提交发布 + 连续热修**（`fix(doctor) 崩溃`、`fix: agents 注入`）说明这套流程没有保护它自己的作者——发布前该暴露的集成缺陷，是在发布后以补丁形式补的。
2. 其中 `c50f3b3 fix(doctor): 修复 sg_doctor 缺少 agents 注入时崩溃` **只改了 CHANGELOG 与 package.json，没有改任何代码**——真正的修复在前一个提交里。提交信息与内容不一致，恰好是「门控只认标记」的一个现实隐喻。

---

## 2. 五个致命问题

### F1. 治理状态可被被治理者改写（信任模型倒置）

- **现象**：门控状态就是 `.specgate/gates/G3.confirmed` 这样的普通文件；而写入守卫把 `.specgate/` 整段列为「不受门控路径」直接放行。
- **证据**：`src/gates.js:17-19`（路径 = `.specgate/gates/<Gx>.<suffix>`）、`src/runtime.js:100-109`（`.specgate/` 白名单）、`src/runtime.js:127-129`（只拦 `write`/`edit` 两个工具名）。
- **复现**（附录 A）：同一个 `write` 工具，写 `src/a.js` 被 BLOCKED，写 `.specgate/gates/G8.confirmed` 被 **allowed**。
- **后果**：任何模型只要「想推进」，写一个空文件即可通过全部门控，且不触发任何失效。
  除此之外，`pwsh` / `bash` / `apply_patch` / MCP 工具全部在守卫之外（`docs/design/plugin-architecture.md:180-181` 已承认）。

> 这是整套体系的地基问题：一个门控，如果它的状态文件与被它检查的代码在同一个可写工作区里，且守卫对状态目录放行，那它就不是门控，只是提示。

### F2. 门控没有事实校验，只认「文件存在」

- **现象**：确认门控只做三件事——前置 marker 是否在、Git 是否 clean、调用 `confirmGate` 写时间戳。它不检查 proposal 是否存在、内容是否为空、diff 是否非空、测试是否跑过、审查记录是否存在。
- **证据**：`src/gate-actions.js:99-114`（前置 + clean）、`src/gates.js:51-57`（内容仅时间戳）、`src/gates.js:43`（`satisfied = 文件存在`）。
- **需求 vs 实现的落差**：需求文档 FR-08 明确要求「源码写入前检查测试文件是否存在」「G8 前检查 review 记录」「G9 前检查审查结论」「提交前检查测试通过」（`docs/design/requirements-confirmation.zh.md:210-216`）。**这四条在代码里一条都没有实现**：`src/` 中不存在对 `.specgate/reviews/` 的读写，也没有任何执行测试的代码（`.specgate/reviews/` 只在 `src/init.js:56` 建了空目录）。
- **门控语义还停在「意图」而非「结果」**：G8「是否启动代码审查」、G10「是否启动验收测试」、G11「是否合并分支」（`src/constants.js:83-110`）——
  确认的是**将要做什么**，不是**已经做成了什么**；因此没有任何后置条件会被验证。

### F3. 任务完成判定失真：假绿会永久隐形

- **现象 1**：子 Agent 的 `ok` 只代表「没抛异常」。`createAgentRunner` 在 agent idle 后就返回 `ok:true`，连空回复都用占位符兜底（`src/dispatch.js:219`）。什么都没做的 agent = 成功。
- **现象 2**：合并冲突后，任务仍被勾选完成。`doneIds` 用的是 `item.ok`（runner 成功），不是 merge 成功（`src/dispatch.js:394-397` vs `368-382`），随后 `markTasksDone` 把它写成 `[x]` 并提交。
- **现象 3**：空分支合并返回成功（`git merge` 输出 `Already up to date`，`src/worktree.js:111-112`），于是「零代码」也会被记为 merged。
- **后果链**：任务显示完成 → 下次 `/sg-apply` 因 `open.length === 0` 直接报「全部完成」→ 缺陷永久不可见。
  这是当前代码里**最可能导致「流程全绿、产品是坏的」**的一条路径。
- 相关但独立：`commit` 归属靠 `headHash` 前后差（`src/dispatch.js:313`），任何来源的提交（包括用户手工提交）都会被算作该 agent 的成果。

### F4. 门控作用域错误：project-global，而不是 per-change

- **现象**：marker 路径与读取接口都不带 change 名（`src/gates.js:17-19`；`src/status.js:36-37`）。所有 change 共享一套 G1–G11。
- **复现**（附录 A）：为 `alpha` 确认 G1–G7 后，仅执行 `createChange('beta')`，`alpha` 的门控就只剩 G1、G2（`src/openspec.js:193` 调 `invalidateFrom('G3')`）；再 `archiveChange('alpha')`，**全部门控被清空**（`src/openspec.js:208` 调 `clearAllGates`）。
- **后果**：并行变更、增量变更、hotfix 与 feature 并存——这三种真实场景全部不可用；开第二个 change 等于毁掉第一个 change 的进度。
- 附带：`waive` 不检查前置（`src/gate-actions.js:187-198`），可以乱序 `waive G1…G10` 后 `confirm G11` 全解锁；`deviations.log` 只写不读，没有任何决策逻辑消费它（仅 doctor 数条数）。

### F5. 编排靠人敲命令，AI 只做「最后一公里」

- **现象**：G1→G11 的推进没有任何自动触发点。`sg_next` 只返回一段文本，不驱动任何动作；`/sg-apply` 是唯一会拉起多 Agent 的入口，而且要人先手动过完 G1–G7。
- **证据**：`src/status.js:164-181`（`renderNext` 纯文本）、`src/commands.js:693-704`（dispatch 只在 `/sg-apply` 内）、`src/openspec.js:107-169`（`nextStepFor` 返回 action 字符串，无执行者）。
- **后果**：所谓「AI 协同工作流」，实际是「人来当调度器，AI 当打字机」。这与你想要的分工正好相反：人应该只在**需求澄清**与**验收**上消耗注意力。

---

## 3. 次级但会咬人的问题

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| S1 | worktree 命名可碰撞、复用不校验 | `src/worktree.js:65-72, 82-85` | 重跑复用脏树/旧分支；大小写不敏感文件系统上 `T1`/`t1` 撞车 |
| S2 | 失败/冲突 worktree 与分支永不回收 | `src/dispatch.js:368-390`；`worktree.js:100-107` | 仓库堆积 `specgate/*` 分支，无清理命令 |
| S3 | dispatch 无 `try/finally` | `src/dispatch.js:342-345` | `createWorktree` 抛错或 runner reject → 同波次其它 agent 脱管、worktree 全泄漏 |
| S4 | 自动生成的 task id 永不被勾选 | `src/task-graph.js:44-46` vs `src/dispatch.js:73-74` | 没有显式 id 的任务每次重跑都被重复派发 |
| S5 | 串行降级把用户脏改动卷进任务提交 | `src/dispatch.js:128, 304-313` | `git add -A` 提交了与任务无关的未提交工作 |
| S6 | 状态缓存 400ms，与「永不缓存」需求冲突 | `src/status.js:9-10` vs `requirements-confirmation.zh.md:196` | 提示词注入可能短暂显示过期门控 |
| S7 | 幂等锁 10 分钟 stale，长任务会被夺锁 | `src/idempotency.js:15, 99-139` | 20 分钟的 `/sg-apply` 或 `/sg-doctor` 可被第二个进程并发执行 |
| S8 | `writeJson` 非原子（dispatch.json / idempotency.json） | `src/util.js:178-180` | 崩溃或并发写可让整份状态被静默重置（`readJsonIfExists` 解析失败返回 null） |
| S9 | 分类是关键词正则 | `src/classify.js:3-73` | 「修复一下这个需求」可能被判 L3 从而跳过 G1/G3/G4/G5——流程强度由一句描述里的词决定 |
| S10 | 产物完成度靠字符串存在 | `src/openspec.js:47-69` | 模板里的「待补充」占位符也算 completed，空壳可通过评审 |
| S11 | doctor 的只读约束只写在提示词里 | `src/dispatch.js:414-443` | 体检 Agent 拥有完整写权限，「只读检查」不被机制保证 |
| S12 | 子 Agent 的 cwd 回退到全局 `lastCwd` | `src/runtime.js:42-66` | 多会话/多项目并发时，守卫可能拿错项目根，越权写或误拦 |
| S13 | 文档与实现漂移 | `plugin-architecture.md:246` 写 90 测试；`1c92386` 提交信息写 88；README 写 v1.0.0 而 package 是 1.0.1 | 基线不可信，验收口径随文档漂移 |

---

## 4. 根因：三个「把手段当成了目的」

1. **把「流程」实现成了「提示词 + 文件标记」。**
   于是所有严肃性都依赖模型自觉；而模型恰恰是流程要约束的对象。
2. **混淆了「人类确认意图」与「机器验证结果」。**
   11 个门控全是「要不要继续」的对话，没有一个是「事实是否成立」的断言。
3. **用资产数量代替机制强度。**
   30 个 Skill、9 个角色、11 个门控看起来很完备，但真正的机制只有两个：`tools.guard` 的两个工具名，和几个文件是否存在。
   数量掩盖了强度。

由此可以推出一个反直觉但重要的判断：

> **当前设计里，人类被要求参与的 11 个门控，恰好是价值最低的 11 个决定。**
> 因为每个门控问的都是「可以继续吗」，而人类没有任何证据可依据（没有 diff 摘要、没有测试结果、没有审查清单），只能凭模型的自述点头。
> 这不是人在做验收，是人在给 AI 背书。

---

## 5. 目标态：人只做 4 件事

### 5.1 分工契约

| 阶段 | 人 | AI / 机器 | 机制保证 |
|---|---|---|---|
| 需求澄清 | **主导**：说清 What/Why/Who、边界、不做什么 | 盘问、复述、反例、冲突检测 | 产出 `REQ.md` + **可执行验收用例**（AC-01…） |
| 需求确认（唯一强人类门控） | **签字**：需求与验收用例一致 | 生成需求冻结包（hash 化） | 冻结后任何需求变更自动降级为「新 change」 |
| 方案设计 | 只看**风险与取舍**（1 页） | 架构、切片、任务图、Brief | 每个设计决策必须附「备选与代价」 |
| 实施 | **不参与** | 多 Agent 并行、TDD、自测 | 每任务必须产出 commit + 测试证据 |
| 独立验证 | 不看过程 | verifier agent（只读、跑测试） | 测试退出码/覆盖率写入证据对象 |
| 独立审查 | 只看**结论与红灯** | reviewer agent（独立上下文、rubric、file:line） | 审查输出 JSON，P0/P1 未清零则不可合并 |
| 集成 | **不参与** | integrator：合并、解冲突、回归 | 合并成功才允许勾选任务 |
| 验收（第二个人类门控） | **主导**：跑验收用例、看 demo、判是否交付 | 生成验收报告（用例 → 结果 → 证据） | G10 = 验收用例全绿，不是「是否启动」 |

人类只剩 4 个动作：**需求澄清、需求签字、风险取舍、验收判决**。
其余全部由状态机驱动，人只在「红灯」时被叫醒。

### 5.2 关键改造：把「门控」从对话框改成证据校验器

每个门控声明一个**可机器校验的后置条件**，确认时执行校验器，而不是问一句「是否通过」：

```yaml
# gate G4 (design)
requires: [G3]
evidence:
  artifact: openspec/changes/<change>/design.md
  must_contain: ["## Architecture", "## Technical Approach", "## Alternatives", "## Risks"]
  min_bytes: 800
  diff_nonempty: true
  links: [REQ.md#AC-01, REQ.md#AC-02]   # 覆盖率：每条验收用例必须被设计覆盖
asserts:
  - review_report: .specgate/reviews/design-<change>.json
  - review_p0_count == 0
human: optional   # 只有 P1 以上风险时才升级给人
```

规则：
- **证据对象不可手写**：由插件生成，写入工作区之外（用户级 `.dsh/specgate/state/` 或 git trailer / git notes），或写入带 HMAC 的记录。
- **`.specgate/gates/**` 对 agent 只读**：守卫必须拒绝任何对该目录的写入（当前恰好放行）。
- **门控只能由「人 + 证据」共同产生**；waive 必须记录「谁、何时、哪条证据缺失」，并且在 status 里持续显红。
- **门控作用域 = change**：`gates/<change>/G4.confirmed`，归档只清自己的。

### 5.3 关键改造：自动编排器（Orchestrator）

把「人敲命令」换成「一个状态机 + 一个队列」：

```
change 激活
  → planner: 规范 → 垂直切片 → tasks.md + 每任务 Brief（含验收用例 id）
  → wave loop:
       implementer(worktree) ── commit + 测试证据 ──▶ verifier(独立, 只读)
                                                     │ fail → 回 implementer，最多 N 轮
                                                     ▼ pass
                                                 reviewer(独立, rubric)
                                                     │ P0/P1 → 回 implementer
                                                     ▼ pass
                                                 integrator(合并 + 全量回归)
  → 全 wave 完成 → 生成验收包 → 人验收（唯一停顿点）
```

- 编排器是**代码**，不是提示词：`runNext(change)` 幂等、可恢复、有超时与成本上限。
- 每个角色是**受限 Agent**：verifier/reviewer 只读工具集、独立上下文、不看 implementer 的自我评价（避免自我确认偏误）。
- 冲突、失败、超预算 → **停下并升级给人**，而不是「假绿继续」。

### 5.4 关键改造：需求阶段的产物要「可执行」

你想把人放在需求与验收上，那这两端必须产出**机器可判定**的东西：

- `REQ.md`：What / Why / Who / 不做什么 / 约束 / 风险
- `AC.md` 或 `acceptance/*.feature`：每条验收用例一个 id，可执行（或至少有明确 given/when/then）
- 需求冻结 = 对 `REQ.md + AC.md` 取 hash；实现阶段的任何需求变更必须开新 change

这样 G10 才从「是否验收」变成「**运行 AC-01…AC-0N，展示结果**」。
人的注意力从「读 AI 的自述」变成「看用例是否通过」。

---

## 6. 重构路线（按投入产出排序）

### P0 — 先让「全绿」可信（1–2 天，改动小、收益最大）

1. **禁止自签**：`runtime.checkWrite` 对 `.specgate/gates/**` 与 `.specgate/state/**` 一律拒绝；marker 增加来源校验（或迁出工作区）。
2. **勾选前置条件改为合并成功**：`doneIds` 用 `merged.ok`，冲突任务永不 `[x]`（`dispatch.js:394-397`）。
3. **成功后置条件**：任务成功 = commit 非空 **且** diff 非空 **且** 有测试证据（命令、退出码、输出 hash）。
4. **补 `try/finally`**：`dispatchChange` 任何抛错都必须清理 worktree 并写出报告。
5. **门控 per-change**：marker 路径加 change 名；`archive` 只清自己的门控。

### P1 — 让门控变成证据校验（1–2 周）

6. 定义 evidence schema，`performGateAction` 在写 marker 前跑校验器；校验失败给出「缺什么、怎么补」。
7. 实现 FR-08 四条：测试文件存在性、review 报告存在且 P0=0、测试通过、文档更新。
8. reviewer / verifier 独立 Agent：只读工具集、独立上下文、结构化 rubric、必须引用 `file:line`。
9. 审查结果落 `.specgate/reviews/<change>/<gate>.json`（当前这个目录是死代码）。
10. 把 doctor 的「只读」变成机制（受限工具集），而不是提示词。

### P2 — 让「人只做需求与验收」成立（3–6 周）

11. Orchestrator 状态机 + 自动波次推进 + 断点恢复 + 预算控制。
12. 需求冻结包（REQ + AC + hash）与需求变更的自动降级。
13. 验收包生成器：AC → 执行 → 结果 → 证据 → 一页结论。
14. 度量：每个 change 的人工介入次数、门控停留时长、返工率、review 发现率、一次通过率。
15. 多 change 并行（per-change 状态 + 集成分支策略）。

---

## 7. 值得保留的部分

评审不是全盘否定，以下设计是对的，改造时应保留：

- **文件即状态**、可读可审计、可脱离插件阅读（`plugin-architecture.md:11-12`）。
- **单一入口的幂等语义**（状态检查优先，而非重放缓存）。
- **L1/L2/L3 分流**的产品直觉正确，只是判定方式（关键词）与流程强度（L2 仍全链）需要重做。
- **失败降级而非崩溃**（无 agents → 本地 doctor；无 Git → 串行）。
- **命令结果交回 agent**（`503e3af`）这个方向是对的：让结果进入对话、可追问，而不是沉在命令卡片里。

---

## 附录 A：复现记录

环境：Windows / Node v24.14.0 / 仓库 HEAD `503e3af`

```text
alpha gates before beta: G1,G2,G3,G4,G5,G6,G7
alpha gates after creating beta: G1,G2          ← 创建新 change 清空旧 change 的 G3-G11
gates after archiving alpha: (none)             ← 归档清空全部 change 的门控
guard on source file: BLOCKED
guard on gate marker: allowed                    ← 模型可自行写 G8.confirmed
```

复现代码：`node -e` 调用 `createChange` / `confirmGate` / `archiveChange` / `createRuntime().checkWrite`（见评审过程记录）。

## 附录 B：本次评审未覆盖

- 未在真实 Web UI 中点击验证 `userQuestions` 的交互链路（仅源码审读）。
- 未安装到独立 profile 复跑 `/sg-apply` 全流程（避免污染当前 profile）。
- 未做性能与成本测量（多 Agent 的 token 消耗、并发上限的实际影响）。
