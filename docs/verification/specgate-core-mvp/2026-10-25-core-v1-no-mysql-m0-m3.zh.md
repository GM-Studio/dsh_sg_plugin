# Core v1 移除 MySQL 依赖与 M0–M3 重跑记录

- 日期：2026-10-25（Asia/Shanghai）。
- 分支：`sg-codex`；基础 HEAD：`2df0832134e570eda4908929dc7c646fed784d53`。
- 授权来源：用户要求查明 MySQL 来源及必要性；v1 不需要时移除，并重跑 M0–M3。
- 范围：移除根包 MySQL 安装/捆绑依赖、隔离数据库集成测试、保留历史代码并按需加载驱动。
- 结果：**依赖移除与数据库无关回归验证通过；M1–M3 的完整条款验收仍未通过，未进入 M4。**

## 1. MySQL 是怎么引入的，为什么引入

Git 提交 `3ce4406bde1276b8cc350f4d08744c7211e6a4b2`（2026-10-24 08:24:53，UTC+8，`feat(control): complete M1 MySQL persistence and recovery`）把 `mysql2@^3.24.6` 同时加入根包 `dependencies` 和 `bundledDependencies`，并新增数据库仓储与真实数据库集成测试。原始 diff 保存在 [mysql-introduction.txt](../../../.task-evidence/core-no-mysql-20261025/mysql-introduction.txt)。

当时执行的是 **2026-10-23 控制面产品计划**，其 M1 与本次 Core 计划的 M1 是不同里程碑。历史设计文档 [07-m1-persistence-design.md](../../implementation/2026-10-23-codex-ai-delivery-control-plane/07-m1-persistence-design.md) §1 明确说明目的：为云端认证、远程决策、本地 Worker 提供持久化契约，以数据库 schema、唯一键、版本 CAS、幂等键和审计链保存项目、WorkItem、Run、Attention、Decision、Evidence、Notification、Delivery、Audit 等对象。后续认证和 Worker 实现扩展了这条持久化链路。

此前 `npm test` 自动发现所有测试文件，数据库组也随之进入默认回归。HEAD `2df0832` 的主题是移除条件式 integration skip；在真实数据库不可用时，这些测试会明确失败。因此先前 MySQL 失败来自旧控制面套件与默认回归边界混合。

## 2. v1 哪些部分需要 MySQL

**本次 Core v1 没有必须使用 MySQL 的环节。** 冻结需求 D05 明确规定本地文件、Git 与 append-only 事件链，不使用 MySQL；D16 和 §3 排除远程平台能力；RQ-021 / AC-023-03 要求安装、启动与核心测试不依赖数据库。D19 同时要求保留历史实现，先隔离而不是删除。

| 能力                                             | 历史 MySQL 用途                | Core v1 是否需要 |
| ------------------------------------------------ | ------------------------------ | ---------------- |
| 本地 Change、H1/H3、测试冻结、质量证据、交付记录 | 使用本地文件、Git 和事件链即可 | 不需要           |
| 控制面 WorkItem、跨进程任务与审计                | 数据库持久化、CAS、幂等和恢复  | 非 v1 范围       |
| 远程账号、TOTP、设备会话                         | 认证凭据及会话状态存储         | 非 v1 范围       |
| Worker 身份、连接、outbox、重放                  | 多连接并发状态与审计           | 非 v1 范围       |
| 数据库备份与恢复演练                             | MySQL 专用运维验证             | 非 v1 范围       |

本轮没有修改冻结需求，也没有改成使用另一种外部数据库。

## 3. 实际修改

1. `package.json` 删除根包 `mysql2` 运行依赖和 bundled 声明；没有改为 optional dependency，默认安装也不会下载它。
2. 重新生成 `package-lock.json`，清除驱动及其专用依赖记录；执行离线 uninstall，当前工作区实际移除 12 个包，`node_modules/mysql2` 已不存在。`npm ls --omit=dev --all` 返回空运行依赖树。
3. 历史 `mysql-repository.js` 改成创建 pool 时才加载驱动；导入模块不需要驱动。显式调用历史路径而驱动缺失时抛出 `MYSQL_DRIVER_NOT_INSTALLED`，不自动安装、不连接替代数据库。
4. 新增 `scripts/run-tests.mjs`：`npm test` 跑 96 个数据库无关测试文件；`npm run test:mysql` 显式跑 5 个数据库组文件；`npm run test:all` 选择两组共 101 个文件。集合断言证明完整分组且无重复；新的静态数据库 import 必须显式登记分组。
5. 数据库测试没有删除、改断言或改成 skip；既有两份用户修改中的 MySQL 测试文件保持原字节 hash。
6. 增强包验收：从 tarball 离线安装后断言驱动不存在、无 bundled 依赖、历史 pool 调用明确报缺驱动，同时 MCP handshake/status 仍通过。
7. CI 默认验证调用数据库无关套件，README 中英说明核心与历史扩展边界及显式测试入口。

这是用户本轮明确要求的数据库依赖清理，不表示完整 M5 产品面、所有可选模块静态加载图和 Skill 收敛已经完成。历史控制面/数据库源码与迁移文件继续保留。

## 4. 测试与质量证据

新断言先在旧包配置上真实失败，失败原因是 `dependencies` 中仍有 `mysql2`，见 [red-dependency.log](../../../.task-evidence/core-no-mysql-20261025/red-dependency.log)。修改后验证如下：

| 检查                                          | 退出码        | 结果                                                     | 证据                                                                                                |
| --------------------------------------------- | ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 数据库隔离与离线安装聚焦测试                  | 0             | 6 tests / 6 pass / 0 fail / 0 skipped                    | [focused-no-mysql.log](../../../.task-evidence/core-no-mysql-20261025/focused-no-mysql.log)         |
| 默认原 TEMP 的 `npm test`                     | 1             | 698 tests / 676 pass / 22 fail / 0 skipped               | [npm-test-default.log](../../../.task-evidence/core-no-mysql-20261025/npm-test-default.log)         |
| 独立短 TEMP 的 `npm test`                     | 0             | 698 tests / 698 pass / 0 fail / 0 skipped / 0 cancelled  | [npm-test-isolated.log](../../../.task-evidence/core-no-mysql-20261025/npm-test-isolated.log)       |
| 实际卸载驱动后，再跑独立短 TEMP 的 `npm test` | 0             | 698 tests / 698 pass / 0 fail / 0 skipped / 0 cancelled  | [npm-test-no-driver.log](../../../.task-evidence/core-no-mysql-20261025/npm-test-no-driver.log)     |
| M1 既有聚焦回归                               | 0             | 89 tests / 89 pass / 0 fail / 0 skipped                  | [m1.log](../../../.task-evidence/core-no-mysql-20261025/m1.log)                                     |
| M2 既有聚焦回归                               | 0             | 64 tests / 64 pass / 0 fail / 0 skipped                  | [m2.log](../../../.task-evidence/core-no-mysql-20261025/m2.log)                                     |
| M3 既有聚焦回归                               | 0             | 30 tests / 30 pass / 0 fail / 0 skipped                  | [m3.log](../../../.task-evidence/core-no-mysql-20261025/m3.log)                                     |
| 条款负向探针 P01–P10                          | 1             | 8 项不满足、2 项满足，无探针执行异常                     | [requirements-probes.json](../../../.task-evidence/core-no-mysql-20261025/requirements-probes.json) |
| `npm run test:mysql`                          | 1（预期）     | 缺少驱动明确失败，无数据库测试被伪装为通过               | [optional-mysql.log](../../../.task-evidence/core-no-mysql-20261025/optional-mysql.log)             |
| `npm run lint`                                | 0             | ESLint 通过                                              | [lint.log](../../../.task-evidence/core-no-mysql-20261025/lint.log)                                 |
| `npm run format:check`                        | 0（最终复跑） | Prettier 通过；初轮仅本轮新增 hash JSON 格式失败，已修正 | [format-final.log](../../../.task-evidence/core-no-mysql-20261025/format-final.log)                 |
| `npm run pack:check`                          | 0             | tarball dry-run 通过，驱动不再捆绑                       | [pack.log](../../../.task-evidence/core-no-mysql-20261025/pack.log)                                 |
| `npm run codex:smoke`                         | 0             | MCP smoke 通过，真实审批和角色会话仍为 not-run           | [smoke.log](../../../.task-evidence/core-no-mysql-20261025/smoke.log)                               |

### 4.1 环境条件与可复跑命令

驱动实际卸载、报告落盘后再次完成全部静态与打包/启动检查，退出码均为 0：
[lint-final.log](../../../.task-evidence/core-no-mysql-20261025/lint-final.log)、
[format-final.log](../../../.task-evidence/core-no-mysql-20261025/format-final.log)、
[pack-final.log](../../../.task-evidence/core-no-mysql-20261025/pack-final.log)、
[smoke-final.log](../../../.task-evidence/core-no-mysql-20261025/smoke-final.log)。

原系统 TEMP 的祖先存在 `.git` 标记，继续触发 22 项 `INIT_EXISTING_GIT_UNSUPPORTED` 等初始化失败。本轮保留该失败日志，没有删除该标记、改产品保护逻辑或隐藏用例。

成功全量验证使用专用短目录 `C:\Users\Administrator\AppData\Local\SpecGateTestTemp`，事先只读核对祖先无 Git 标记，然后在获准的验证进程内设置 TEMP/TMP/TMPDIR；测试 bootstrap 管理并清理自己的 run 子目录。没有修改用户全局环境变量或原 TEMP。

以下命令在单独 PowerShell 进程中复现同一环境：

```powershell
$auditTemporaryRoot = 'C:\Users\Administrator\AppData\Local\SpecGateTestTemp'
$env:TEMP = $auditTemporaryRoot
$env:TMP = $auditTemporaryRoot
$env:TMPDIR = $auditTemporaryRoot
npm test
```

M1、M2、M3 的聚焦回归分别使用计划中已经存在的文件；缺少的 `codex-core-anchor.test.js` 等计划测试仍记为未实现，不算 PASS。最后一次无驱动全量回归覆盖这些全部既有聚焦文件。

## 5. M0–M3 的实际验收判断

| 阶段 | 本轮可证明的事实                                                         | 完整退出门判断                                                                          |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| M0   | 重新跑过基线命令、记录环境差异和数据库去除证据；原需求映射 30 条 RQ 仍在 | 基线复跑完成，保留历史记录，不重写为新的阶段交付声明                                    |
| M1   | 89 项既有聚焦回归通过                                                    | **未验收**：状态映射、第二写入源、整体回退检测、授权锁边界及故障事务一致性仍有缺口      |
| M2   | 64 项既有聚焦回归通过                                                    | **未验收**：缺文件白名单的计划仍被接受；依赖审批和冻结测试替换约束仍未补齐              |
| M3   | 30 项既有聚焦回归通过                                                    | **未验收**：findings 未贯通至 Implementer/native prompt；命令来源和循环上界收敛仍未完成 |

条款探针结果与[上一轮复验](2026-10-25-m1-m3-recheck.zh.md)一致：P01–P07、P09 不满足；P08 两次重试后第三次失败阻断、P10 拒绝模型注入命令满足。

P04 只验证合成异步授权 hook 在写锁中的行为，不声称真实 H1 表单等待必然持锁；P05 使用“事件写入后 fsync 故障、同事务再次写审计”的合成故障路径，不声称默认 authority 自然执行这一组合。完整边界仍以原报告和探针代码为准。

因此此次可以确认 MySQL 已从当前 Core v1 的安装、捆绑和必跑数据库测试依赖中移除，数据库无关回归在注明的隔离环境中全部通过；**不能确认 Core v1 的 M1–M3 需求全部完成，也不能进入 M4 或宣称 MVP 可发布。** 未更新任何计划完成状态。

## 6. 保留范围与未执行项

- 两份用户既有改动中的 MySQL 测试文件与保存的 [preserved-tests.json](../../../.task-evidence/core-no-mysql-20261025/preserved-tests.json) hash 一致。
- 冻结需求、旧执行计划、v2 执行计划、M0 历史报告均未修改。
- 未删除历史数据库实现、迁移 SQL、交付或审计数据；未启动、卸载系统 MySQL 服务或修改连接配置。
- **NOT_RUN**：历史 MySQL 功能集成验证；真实金丝雀交付；真实 H1/H3 人工审批；真实三个角色执行；M4–M6 实施与验收。
- 未提交、推送或发布。
