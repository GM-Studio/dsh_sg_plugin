# SpecGate v3 MVP 演示与验收

> 对应 `V3-MVP-REQ-001` v1.0 与 `V3-MVP-TASKS-001`。本文件只记录**怎么复现**，不重复需求。

## 1. 前置

- Windows + Node.js ≥ 20.19 + git。
- 插件已切到 v3（`index.js` 只注册 `src/v3`）。
- 演示仓库是一个**存量 Node 仓库**：有 main、有源码，最好已有 `test:json`；没有则在首个 change 用 `testing.command` 接入。

## 2. 命令

| 命令 | 用途 |
|---|---|
| `/sg-init` | 初始化 v3 项目 |
| `/sg-change <name> --type feature\|modify\|fix\|remove` | 创建 change |
| `/sg-run [--retry] [--force]` | 推进一个阶段/一批任务 |
| `/sg-approve H1\|H2\|H3` | 人批准（工具内弹窗） |
| `/sg-skill <name>` | 手动加载技能 |
| `/sg-status` | 状态 |
| `/sg-abort` | 中止 |

## 3. 四类变更演示

| 编号 | 类型 | 验收点 | 自动化用例 |
|---|---|---|---|
| D1 | feature | ADDED → 任务合并 → `[x]` → acceptance → H3 → 归档 tag | `test/v3/s4.e2e.test.js` 的 S4/S5 用例 |
| D2 | modify | MODIFIED 替换 specs 正文，旧行为消失 | `test/v3/s10.modify.test.js` |
| D3 | fix | 复现用例在 base 失败、修复后通过，归档补 AC | `test/v3/s6.fix.test.js` |
| D4 | remove | 删实现与清单内测试，归档后 REQ 消失 | `test/v3/s6.remove.test.js` |

每个用例都验证：人工只出现 3 次（H1/H2/H3），任务只有合并后才写 `[x]`。

## 4. 反向注入

| # | 注入 | 期望 | 覆盖 |
|---|---|---|---|
| 1 | tester 改源码 | diff 拒绝，任务失败 | `s4.worktree.test.js`、`s4.e2e.test.js` |
| 2 | 删除 `test:json` | `TEST_COMMAND_MISSING` | `s10.injections.test.js` |
| 3 | 报告全部 `skip` | AC 无通过用例，任务失败 | `s4.core.test.js` |
| 4 | 修复用例在 base 就通过 | `REPRO_PASSED_ON_BASE` | executor fix 分支（E2E 正向用例反向验证） |
| 5 | 改 `touched` 清单外的测试 | diff 拒绝 | `s4.worktree.test.js` |
| 6 | 两个 `[P]` 任务改同一文件 | 第二次合并冲突，integration 保留第一次 | `s10.injections.test.js` |
| 7 | H1 前写 design | 写守卫拒绝 | `s10.guard.test.js` |

## 5. 证据与验收

- 每次任务合并写 `.specgate/evidence/<change>/<seq>.json`，哈希链可由 `verifyEvidence` 校验。
- `acceptance.md` 由编排器生成，逐 AC 列出结果、commit、证据。
- 归档顺序：备份 → 合 integration → 应用 delta → 提交 specs → 打 tag → 移动 change。

## 6. 当前未纳入

- 多 change 并行（一次只允许一个 active change）
- 崩溃自动恢复（只做幂等重跑 + 锁）
- 旧项目迁移（`workflowVersion<3` 只读拒绝）
- v2 资产与代码清理（`src/*.js` 仍保留，`index.js` 已不引用）
- 真实 LLM 的 nightly 演示（当前 E2E 使用脚本化 runner）
