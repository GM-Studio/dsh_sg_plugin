# M1 持久化设计与验证边界

- 日期：2026-10-23
- 分支：`feat_web`
- 状态：**2026-10-23 历史记录；真实 MySQL 后续证据见 08-m1-mysql-delivery.md**
- 适用需求：`docs/requirements/2026-10-23-codex-ai-delivery-control-plane-product.zh.md`
- 适用计划：`docs/plans/2026-10-23-codex-ai-delivery-control-plane-product-plan.zh.md`
- 工作树证据：`WORKTREE-2026-10-23-02`

本文件记录 M1 的实现边界、不变量、已执行证据和未执行风险。它不是生产验收报告，也不能替代真实 MySQL、备份恢复或并发演练。

2026-10-24 已补齐 MySQL adapter 和加密恢复演练。以下未执行项描述本文件原始记录时点；
当前阶段状态以 [M1 MySQL 交付报告](08-m1-mysql-delivery.md) 为准。

## 1. 目标与边界

M1 为后续云端认证、远程决策和本地 Worker 提供稳定的数据契约：

- 用 MySQL schema 表达项目、身份、WorkItem、Run、Attention、Decision、Evidence、Notification、Delivery 和 Audit；
- 用唯一键、版本 CAS 和幂等键约束关键写入；
- 用显式状态机拒绝非法状态转换；
- 用追加式审计和哈希链暴露篡改；
- 用项目级保留策略约束证据、通知、决策和审计；
- 用仓储接口隔离领域服务与 MySQL adapter。

当前实现包含：

- `src/codex/core/control/persistence/migrations/001-initial.sql`：MySQL 8.0+ 基线 schema；
- `src/codex/core/control/persistence/migrations.js`：迁移 manifest、校验和、顺序执行和失败语义；
- `src/codex/core/control/persistence/state-machine.js`：WorkItem、Attention、Decision 状态转换与 Decision 应用；
- `src/codex/core/control/persistence/memory-repository.js`：用于契约验证的受控内存仓储。

**边界：** 内存仓储不是 MySQL adapter。它证明接口语义和失败路径，不证明数据库约束、事务隔离、锁、DDL 原子性或生产并发行为。

## 2. 数据契约

### 2.1 Project 响应

Project 配置与乐观锁版本必须分开返回，避免调用方把版本混入业务配置：

```js
{
  ok: true,
  project: {
    projectId,
    name,
    evidenceRetentionDays,
    notificationRetentionDays,
    decisionRetentionDays,
    auditRetentionDays
  },
  version
}
```

`saveProject()`、`updateProjectRetention()` 和 `getProject()` 使用同一契约。更新时调用方必须提供当前 `expectedVersion`，成功后版本严格递增。

### 2.2 WorkItem

- `workItemId` 与 `projectId` 创建后不可变；
- `revision` 必须为正整数；
- 更新必须提供 `expectedRevision`；
- 新 revision 必须严格等于旧 revision 加一；
- 已存在 WorkItem 不得被 `saveWorkItem()` 覆盖。

### 2.3 Decision

- `idempotencyKey` 唯一；
- 相同幂等键、相同指纹重放返回原 Decision，并标记 `replayed`；
- 相同幂等键、不同指纹返回 `IDEMPOTENCY_CONFLICT`；
- Decision 必须绑定存在的 WorkItem；
- 应用时同时校验 WorkItem ID、revision、artifactHash 和 Decision 状态；
- 校验失败不得产生部分状态变更。

### 2.4 Evidence 与 Notification

- 相同 Evidence ID 和相同内容重放幂等；
- 相同 ID、不同内容返回 `EVIDENCE_CONFLICT`；
- 通知只持久化 `recipientHash`，不保存接收方明文；
- 通知按 `attentionId + channel + recipientHash + kind + version` 去重；
- 通知的 WorkItem 与 Project 必须一致。

### 2.5 Audit

- 只接受白名单 actor、action 和合法时间；
- 追加时计算前序哈希与条目哈希；
- 查询返回防御性副本；
- 校验链时检查 sequence、previousHash 和 entryHash；
- 损坏时显式返回 `AUDIT_CORRUPT`，不得静默跳过。

## 3. 保留期与删除

默认保留期：

| 数据         | 默认值 | 可配置 |
| ------------ | ------ | ------ |
| Evidence     | 7 天   | 是     |
| Notification | 30 天  | 是     |
| Decision     | 365 天 | 是     |
| Audit        | 365 天 | 是     |

`purgeExpired()` 的约束：

1. 先写 `RETENTION_PURGE` 审计，再删除业务记录；
2. Decision 的项目归属通过 WorkItem 推导，不信任 Decision 输入中的项目字段；
3. Audit 到期时返回 `AUDIT_RETENTION_REQUIRES_ARCHIVE` 并 fail closed；
4. 删除数量写入审计明细，审计条目本身不删除。

Audit 的 append-only 要求与“审计也可配置保留期”存在真实冲突。当前采用“归档工作流未实现前不删除审计”的安全策略；这不是完整的长期保留方案。

## 4. 迁移安全

- manifest 按文件名排序并计算 SHA-256；
- 已应用迁移的 checksum 不一致时拒绝继续；
- 未知已应用迁移拒绝继续；
- 重复 migrationId 在开始事务前拒绝，且不产生数据库调用；
- 迁移器请求事务，但 **MySQL DDL 会隐式提交**；
- 失败结果明确返回 `rollbackAttempted`、`rollbackSucceeded`、`partialEffectsPossible` 和恢复建议；
- 失败后必须先检查 `schema_migration` 与实际表结构，再修复并重跑。

因此，迁移器不能承诺“DDL 失败后完整回滚”。生产发布应使用单写者迁移任务、数据库备份和发布前 schema 核对。

## 5. 已执行证据

### 5.1 聚焦回归

命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-control-persistence-migrations.test.js test/codex-control-persistence-state-machine.test.js test/codex-control-persistence-schema.test.js test/codex-control-persistence-repository.test.js test/codex-control-persistence-audit-retention.test.js
```

结果：

- `tests 36`
- `pass 36`
- `fail 0`
- `cancelled 0`
- `skipped 0`
- 退出码 `0`

覆盖：

- schema 状态枚举、唯一键与并发原语；
- WorkItem CAS、revision 连续性和身份不可变；
- Decision 幂等重放、冲突和旧版本/旧制品拒绝；
- Evidence 幂等与冲突；
- Notification 去重及接收方哈希；
- Audit 白名单、防御性复制、哈希链和保留期 fail closed；
- 迁移 checksum、重复 ID、事务失败诊断；
- Project 响应版本契约。

证据性质：**受控内存等价验证**。测试通过不代表 MySQL 8.0 已执行、数据库约束已生效或生产并发已成立。

### 5.2 未执行项

以下均为 `NOT_RUN`：

- 在真实 MySQL 8.0 执行 `001-initial.sql`；
- 真实 MySQL 上的重复迁移、checksum 漂移和失败恢复；
- 多连接并发 CAS、Decision 幂等和 Evidence 去重；
- 真实 MySQL 的审计链并发写入；
- 备份、加密、恢复和恢复后审计校验；
- 真实 Worker 应用前 artifactHash 与版本复验；
- 飞书/钉钉真实投递；
- 云端独立部署、HTTPS 反向代理和公网访问；
- 真实 TOTP、设备注册和会话撤销；
- 数据保留任务在真实数据库上的删除与归档演练。

## 6. 已知风险

### 6.1 MySQL DDL 非原子

MySQL DDL 隐式提交，事务回滚不能保证多表迁移原子完成。必须依赖备份、单写者迁移、失败诊断和人工核对。

### 6.2 审计链并发

当前 schema 使用 `AUTO_INCREMENT sequence` 与 `previous_hash`。真实多写者并发下，读取链头与插入新条目之间存在竞争，不能仅靠这两列原子保证唯一且连续的哈希链。

生产 adapter 必须选择以下之一：

- 按项目或全局使用数据库 advisory lock；
- 使用单写者审计队列；
- 使用按项目独立审计链；
- 使用数据库事务与专用链头行进行条件更新。

在方案落地并有真实并发测试前，不得宣称审计链并发安全。

### 6.3 Audit 保留期冲突

删除审计会破坏哈希链完整性。当前 fail closed 是可接受的安全默认值，但长期需要“归档 + 外部完整性证明 + 可验证删除收据”的流程。

### 6.4 内存仓储不等于数据库

内存实现不能证明：

- InnoDB 隔离级别；
- 唯一键和 CHECK 约束；
- 死锁与重试；
- 断线重连；
- 多进程行为；
- 数据持久性；
- 备份恢复。

### 6.5 数据边界

当前 Notification 只保存接收方哈希；后续渠道 adapter 仍需在发送前脱敏，并确保 webhook URL、会话令牌和 TOTP 种子不进入日志或数据库明文列。

## 7. M1 退出判定

- [x] schema、迁移器、状态机和受控仓储契约已实现；
- [x] 聚焦测试 36/36 通过，退出码 0；
- [x] 未执行检查已显式记录；
- [x] MySQL DDL 和审计并发风险已显式记录；
- [ ] 真实 MySQL 8.0 迁移执行通过；
- [ ] 真实 MySQL 并发与幂等测试通过；
- [ ] 审计链并发方案通过；
- [ ] 备份恢复演练通过。

**结论：** M1 达到“受控实现与契约验证”阶段，尚未达到“真实 MySQL 生产验收”阶段。可以继续 M2 的认证领域开发，但在公网开放前必须完成上述未执行项。
