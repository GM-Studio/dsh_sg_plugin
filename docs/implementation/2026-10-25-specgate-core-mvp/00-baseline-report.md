# M0 基线报告（v1.0）

- 取证日期：2026-10-25（Asia/Shanghai）。
- 执行依据：用户本次明确选择的 v1.0 冻结需求和原计划。v2.0 与 Delta v1.1 不作为本轮实施依据，也未改写。
- 分支：`codex/core-reliable-delivery-mvp-v1`；基线 HEAD：`2df0832134e570eda4908929dc7c646fed784d53`。
- 实施目录：`E:\ai_workflow\specgate\.runtime\core-mvp-v1-worktree`。原目录：`E:/ai_workflow/specgate`。
- 状态：本次命令基线已验证；尚未宣称 M1–M6 或 MVP 已交付。

## 原工作区保护与隔离

初始原目录状态：

```text
M test/codex-control-auth-mysql.test.js
 M test/codex-control-worker-mysql.test.js
?? .codex-read-change-add.txt
?? .npm-cache/
?? docs/implementation/specgate-core-mvp-v2/
?? docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md
?? docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan.zh.md
?? docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.delta-v1.1.zh.md
?? docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md
?? node-out.txt
?? patch-probe.txt
?? patch-probe2.txt
```

- 初始跟踪及未跟踪文件哈希登记：`E:/ai_workflow/specgate/.runtime/core-mvp-v1-m0/initial-snapshot.json`。
- 其中两处已跟踪测试修改、全部未跟踪文档（含 v2.0 产物）、探针文件和缓存均保留；未清理、未提交。
- 用户在本次会话选择“在独立干净工作区实施，保留当前目录”。执行 `git worktree add -b codex/core-reliable-delivery-mvp-v1 .runtime/core-mvp-v1-worktree HEAD` 后返回 `HEAD is now at 2df0832`，在复制本次授权的两份文档前无工作区改动。
- 机械检查原目录 868 个预先存在文件的 SHA-256，差异为 0。
- 独立工作区只复制本次授权的两份 v1.0 文档，不复制旧 v2.0 验收报告，也不合并原目录用户测试修改。
- 独立工作区共享已安装 node_modules（目录联接），未安装或更新依赖。

## 工具链

| 工具      | 真实版本                     |
| --------- | ---------------------------- |
| Node      | v24.14.0                     |
| npm       | 11.9.0                       |
| Git       | git version 2.45.1.windows.1 |
| Codex CLI | codex-cli 0.117.0            |

注意：CLI 版本检查不是宿主原生审批或子代理运行验证。

## 失败复现及基线修复

1. 原目录首次 `npm test` 退出码 1；5 个 MySQL 测试入口因 `ECONNREFUSED 127.0.0.1:34367` 失败。原始日志：`E:/ai_workflow/specgate/.runtime/core-mvp-v1-m0/test.log`。
2. 复用仓库现有 `.runtime/mysql-test/dist/mysql-8.4.13-winx64` 与 data 目录。沙箱内 `mysqld --no-defaults --version` 退出码 -1073741502（0xC0000142），沙箱外只读探测成功，版本 8.4.13。仅启动本地 loopback 测试实例，未下载/安装软件、未新增核心依赖。
3. 首次数据库聚焦回归因 `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER` 失败（40 tests / 19 pass / 21 fail）。在该现有测试实例启用 `log_bin_trust_function_creators=1` 后重跑：40 tests / 40 pass / 0 fail / 0 skipped。未修改断言或加入 skip。
4. 原目录完整复验：737 tests / 737 pass / 0 fail / 0 skipped，退出码 0。日志 `E:/ai_workflow/specgate/.runtime/core-mvp-v1-m0/test-recheck.log`。
5. 独立工作区从 HEAD 开始，两个测试文件的原始排版不满足 Prettier。只对独立副本执行确定性格式化：`test/codex-control-auth-mysql.test.js`、`test/codex-control-worker-mysql.test.js`。已机械证明每个当前文件恰好等于 `prettier.format(git show HEAD:<file>)`，没有业务或断言更改；原目录两文件未动。

## 独立工作区真实质量门

| 命令                                                                                                                                                                                                                                                      | 退出码 | 开始时间（本机 UTC+8）            | 结束时间                          | 日志                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------- | --------------------------------- | ------------------------------------------- |
| `node --import ./test/setup-temp.mjs --test test/codex-control-auth-mysql.test.js test/codex-control-auth-runtime.test.js test/codex-control-persistence-mysql.test.js test/codex-control-worker-mysql.test.js test/codex-control-worker-runtime.test.js` | 0      | 2026-10-25T14:58:17.6286616+08:00 | 2026-10-25T14:58:28.9909834+08:00 | `.runtime/core-mvp-v1-m0/mysql-focused.log` |
| `npm test`                                                                                                                                                                                                                                                | 0      | 2026-10-25T14:59:07.4540845+08:00 | 2026-10-25T15:01:14.1724282+08:00 | `.runtime/core-mvp-v1-m0/test.log`          |
| `npm run lint`                                                                                                                                                                                                                                            | 0      | 2026-10-25T14:59:07.6536936+08:00 | 2026-10-25T14:59:11.0686130+08:00 | `.runtime/core-mvp-v1-m0/lint.log`          |
| `npm run format:check`                                                                                                                                                                                                                                    | 0      | 2026-10-25T14:59:07.8532933+08:00 | 2026-10-25T14:59:12.9346658+08:00 | `.runtime/core-mvp-v1-m0/format.log`        |
| `npm run pack:check`                                                                                                                                                                                                                                      | 0      | 2026-10-25T14:59:08.0984078+08:00 | 2026-10-25T14:59:10.3009827+08:00 | `.runtime/core-mvp-v1-m0/pack.log`          |
| `npm run codex:smoke`                                                                                                                                                                                                                                     | 0      | 2026-10-25T14:59:08.3442652+08:00 | 2026-10-25T14:59:08.8929426+08:00 | `.runtime/core-mvp-v1-m0/smoke.log`         |

`npm test`：**737 tests / 737 pass / 0 fail / 0 skipped / 0 cancelled**。日志与 result.json 分开保留，后者含命令、cwd、开始/结束和退出码。

- test：0
- lint：0
- format：0
- pack：0
- smoke：0

## 通过声明边界

- `pack:check` 仅证明当前包可构建：569 文件，约 1.3 MB，仍有 mysql2 等 10 个 bundled deps；这正是 M5 待隔离项，不能称为核心发行已合格。
- `codex:smoke` 的 stdio handshake 和状态读取通过；输出中 `hostInstallation`、`trustedApproval`、`subagents` 仍是 `not-run`，不得描述为通过。
- 本轮默认工具仍含 `sg_work_item_*`，是 M5 的真实差距。
- 本轮全量测试依赖已运行的旧可选 MySQL 实例；尚未证明“核心无需数据库”，M5 必须拆分。
- 金丝雀 build/test/lint/format/runtime 均 NOT_RUN，完整业务交付 NOT_RUN；栈不匹配导致 M6 BLOCKED。
- 当前源码未提交，HEAD 只是基线提交；命令证明的是记录在此处的工作树，最终交付仍需唯一 delivery commit。

## 原文锚点

- 需求规范化 LF SHA-256：`5f7f9067f960c17ae7c41bd23ddcaa0f4a2b06ef6a5beb6930910849254e4531`。
- 本轮批准前原计划规范化 LF SHA-256：`6661bf5486c7f2ba2eb1d9aa8cb280f415e5c4b620b25e851032e5c3ec6a8cea`。
- 复制时与原目录逐字节相同；已冻结需求不修改。
- 历史证据、用户目录、生产数据均未删除或覆盖；未执行 commit / push / publish。
