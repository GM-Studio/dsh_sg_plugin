# M1 MySQL 持久化阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`；沿用用户当前分支，不切回历史计划登记的 `feat_web`
- 起始提交：`06482cf8601292860cc647667ac5b93313a8ef99`
- 制品标识：`WORKTREE-2026-10-24-M1`；最终提交包含本报告及对应源码、测试
- 状态：**实现与真实 MySQL 聚焦验证完成；全仓验证结果见下；人工阶段接受待用户确认**

## 1. 进度核对与本轮范围

冻结需求和计划的当前字节哈希与 `00-freeze-reconciliation.md` 一致，未修改冻结正文。
当前代码已包含 M0 的部署边界，以及 M1 的 schema、reducer 和内存仓储。
历史报告明确未实现 MySQL adapter，未执行真实迁移、并发和备份恢复，因此本轮继续 M1。

本轮只交付 M1，不进入 M2。用户已明确授权阶段完成后提交，以及下载并启动项目内临时 MySQL。
开始时已有的 `.codex-read-change-add.txt`、`.npm-cache/`、`node-out.txt`、
`patch-probe.txt`、`patch-probe2.txt` 均不纳入提交。

后续阶段核对：当前管理台仍使用本地 pairing/session，虽然已有 TOTP step-up，
但尚不具备 M2 的账号密码、强制 TOTP 注册、设备身份与撤销闭环。
当前 `daemon-worker.mjs` 是本地监督进程，不是 M3 的云端出站 Worker 协议。
现有 Codex adapter、飞书 outbox、Decision/Delivery 和多项目页面可在后续复用；
钉钉 adapter、SSE 和完整云端闭环尚未具备。

| 任务                    | 本轮结果                                                    | 验证                                                                |
| ----------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| M1-T01 schema 与迁移    | 保留 001；新增 002，持久化 artifact、转换证据和事务审计链头 | 真实空库迁移、重复迁移、checksum 漂移、DDL 部分失败与清理后重跑     |
| M1-T02 版本与幂等       | SQL 条件 CAS、Decision 唯一键、Evidence/Notification 去重   | 两个独立连接池竞争，CAS 一个成功；同键只保存一条；异内容拒绝        |
| M1-T03 reducer 与状态机 | 复用既有 reducer；Decision 与 WorkItem 同事务应用           | 非法状态、旧版本/制品、重复应用、取消语义回归                       |
| M1-T04 追加式审计       | 单例行锁、显式连续序号、链头和条目校验；损坏拒绝读取及追加  | 16 次并发追加、SQL 写入失败、内容篡改和尾部删除                     |
| M1-T05 保留期           | 项目版本 CAS；7/30/365/365 默认值；同事务清理与审计收据     | 项目隔离、删除失败全事务回滚、审计到期 fail closed                  |
| M1-T06 仓储接口         | 异步 MySQL adapter，复用独立纯契约；内存仓储继续可用        | 原内存回归、真实数据库集成、离线插件安装及驱动加载                  |
| M1-T07 迁移与恢复       | AES-256-GCM 加密逻辑备份，仅允许空库恢复                    | 错误密钥/标签拒绝且不写库；恢复所有表、版本、审计链；拒绝覆盖已有库 |

## 2. 设计和使用边界

实现文件：

- `src/codex/core/control/persistence/mysql-repository.js`
- `src/codex/core/control/persistence/mysql-backup.js`
- `src/codex/core/control/persistence/repository-contract.js`
- `src/codex/core/control/persistence/migrations/002-repository-contract.sql`

`createMysqlPool(options)` 接收本地配置对象，固定 UTC、日期字符串与单语句执行。
`migrateMysql({ pool })` 在独立连接持有数据库命名锁，逐条执行可信迁移；
运行时查询使用参数绑定，不开启 `multipleStatements`。
MySQL DDL 隐式提交，迁移失败仍需检查实际表结构及迁移账本；不会承诺 DDL 整体回滚。
迁移 checksum 只归一化 CRLF/LF，使 Windows/Linux checkout 不产生虚假漂移，其他内容变化仍拒绝。
001 的文件字节保持原样；已有按原始 CRLF 计算的迁移登记需要人工核对，不能静默改写 checksum。

`createMysqlRepository({ pool, clock })` 提供与内存仓储对应的异步方法：
Project 保存/查询/保留期更新、WorkItem 保存/查询/CAS、Decision 记录/查询/应用、
Evidence 追加/列表、Notification 入队/列表、Audit 追加/验证/列表与到期清理。
另提供显式 `saveAttention()`，不由 Decision 隐式制造审批上下文。
数据库外键与额外身份校验拒绝跨 WorkItem/Project 绑定。

所有 adapter 写事务先锁 `repository_head` 的单例行，再读取领域数据。
这是首版单 owner 控制面的单写者实现，跨进程共享锁；不承诺高并发吞吐量。
WorkItem 仍以 revision 条件更新，唯一索引仍在数据库层约束幂等。
审计使用显式序号，回滚不因 `AUTO_INCREMENT` 留下哈希链序号空洞；
验证时同时检查条目和链头，尾部删除也会失败。
失败只返回错误类别和数据库错误码，不回显 SQL、参数或连接凭证。

`createMysqlBackup({ pool, key })` 在迁移锁和写锁下验证审计链并采集一致快照，
返回加密 envelope；32 字节密钥由本地操作者单独保管，不写进 envelope。
当前备份上限为每表 100000 行、总行数据 32 MiB，超限显式失败。
`restoreMysqlBackup({ pool, key, backup })` 先认证并验证当前迁移 manifest，
只向独立空库运行当前代码中的迁移，再参数化导入数据，不执行备份携带的 DDL。
外键重新启用前逐项检查引用，提交前验证审计链。
恢复失败后数据事务回滚，但新建 schema 可能保留，需检查专用目标库再重试。

保留期保持既有 fail-closed 设计：审计超过保留期时报告
`AUDIT_RETENTION_REQUIRES_ARCHIVE`；本阶段不实现审计归档和可验证销毁。
本仓储只接收经过服务层处理的领域对象，尚未替代当前本地文件运行时，
也没有开放任何新公网入口。认证、授权、脱敏入库和 Worker 接入由 M2-M6 实现。

驱动 `mysql2` 随 npm 包打包，保持无网络环境中的插件安装能力；新增回归实际
在空缓存离线安装后加载打包内的 adapter，并启动真实 MCP smoke。

## 3. 真实环境与执行证据

| 项目         | 实际值                                                                              |
| ------------ | ----------------------------------------------------------------------------------- |
| 操作系统     | Windows / PowerShell                                                                |
| Node / npm   | `v24.14.0` / `11.9.0`                                                               |
| MySQL        | Community Server `8.4.13`，InnoDB，UTC                                              |
| 官方下载     | `https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.13-winx64.zip`                 |
| 下载文件 MD5 | `7b94489d5524dea9b27097068bea25a8`，与官方下载页一致                                |
| 下载文件大小 | 281154912 字节                                                                      |
| 实例边界     | 项目内 `.runtime/mysql-test/`；回环 `127.0.0.1:34367`；不安装系统服务；MySQL X 关闭 |
| 凭证         | 启动后设置随机密码，配置只保存在本地忽略目录；未输出密码                            |
| 测试隔离     | 随机 `sg_m1_*` 数据库；测试自动删除自建数据库                                       |
| 并发         | 两个独立连接池，合计九个连接槽位                                                    |

Windows 受限环境中直接运行 mysqld 曾出现 DLL 初始化失败；在授权宿主执行后，
默认 TEMP 路径又出现写权限错误，改为项目内 tmpdir 后实际初始化和启动成功。
这些失败不是 MySQL 验收通过证据；下列结果来自成功运行的隔离实例。

聚焦命令：

```powershell
$env:SPECGATE_MYSQL_TEST_CONFIG = '<本地连接配置 JSON 绝对路径>'
node --import ./test/setup-temp.mjs --test test/codex-control-persistence-migrations.test.js test/codex-control-persistence-state-machine.test.js test/codex-control-persistence-schema.test.js test/codex-control-persistence-repository.test.js test/codex-control-persistence-audit-retention.test.js test/codex-control-persistence-mysql.test.js test/codex-plugin-package.test.js
```

结果：`tests 52 / pass 52 / fail 0 / cancelled 0 / skipped 0 / todo 0`，退出码 0。
其中真实 MySQL 文件为 12 个测试（含父测试），不是模拟 SQL 或内存数据库。

故障注入由数据库触发器实际拒绝 INSERT/DELETE，证明审计写入失败不前移链头，
保留期删除失败同时回滚审计收据和业务删除。
恢复演练实际把加密 envelope 写入临时文件、读回、恢复到另一空库，逐表比较所有行。

最终全仓检查：

| 命令                         | 真实结果                                     | 退出码 |
| ---------------------------- | -------------------------------------------- | ------ |
| 上述聚焦命令                 | 52 tests，52 pass，0 fail，0 skipped         | 0      |
| `npm test`（配置真实 MySQL） | 545 tests，544 pass，0 fail，1 skipped       | 0      |
| `npm run lint`               | 无 ESLint finding                            | 0      |
| `npm run format:check`       | `All matched files use Prettier code style!` | 0      |
| `npm run pack:check`         | tarball 内容检查通过，包含打包驱动           | 0      |
| `git diff --check`           | 无空白错误                                   | 0      |

打包使用本地忽略缓存：`$env:npm_config_cache = (Join-Path $PWD '.npm-cache')`。
唯一跳过项为 `requesting the react frontend without its template tree fails closed`，
原因是 `react template tree is already on disk`；该项没有执行，不计为通过。
仓库已有 lint/格式缺陷已由起始提交以前的修复消除，本轮不再沿用历史 FAIL 状态。

首次全仓检查曾在新增依赖尚未配置离线打包时出现 `ENOTCACHED`，
已通过 bundledDependencies 修复，并以空缓存离线安装回归和最终全仓测试证明。
格式检查曾报告本轮迁移器排版问题，已格式化并重跑通过。

最终代码还验证 64 字符合法数据库名：迁移/备份锁使用固定长度数据库名哈希，
避免 MySQL 命名锁长度限制导致长数据库名无法使用。
完整测试与校验结果绑定本次提交内的
`docs/verification/codex-control-plane-product/m1-2026-10-24.json` 源码摘要。

## 4. 阶段退出与后续

- M1 的实现、聚焦契约、真实 MySQL 迁移/并发/审计/加密恢复证据已具备。
- 最终全仓测试、lint、格式、打包检查见本报告的最终记录。
- 已进行本轮代码自查与机械检查；未运行独立 Reviewer Agent。
- 用户对当前阶段的人工接受尚未发生，不将其伪造成验收回执。
- 本阶段结束并提交后停止；下一阶段为 M2 认证、设备与会话。

以下仍为 `NOT_RUN`，不因 M1 测试通过而改变：

- Linux 上真实 MySQL 运行与跨平台完整矩阵；
- MySQL 8.0.x 的单独实机矩阵（本轮使用满足 8.0+ 基线的 8.4.13）；
- 生产 binlog、异地密钥管理、RPO/RTO、在线大库恢复和灾备演练；
- 真实云服务器、HTTPS 代理、公网浏览器；
- 云端账号密码 + TOTP + 设备绑定及撤销；
- 本地主动出站 Worker、真实 Codex session 恢复；
- 飞书/钉钉真实通知、多项目再交付试点；
- 审计归档及超过保留期后的可验证删除。
