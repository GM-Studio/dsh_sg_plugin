# M6 决策、审计与证据时间线阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`cd5f887`（complete M5 notification lifecycle）
- 制品标识：`WORKTREE-2026-10-24-M6`
- 状态：**实现与受控验收完成；人工阶段接受待确认**

## 1. 交付范围

| 任务                      | 交付结果                                                                    | 验证                         |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| M6-T01 统一 Decision 服务 | M4 的服务端认证、CAS、幂等和 APPLICATION 账本保持                           | M4 回归                      |
| M6-T02 artifact/版本绑定  | Decision 时间线保留 artifactHash、artifactVersion、action 和 STALE/REJECTED | 旧制品不被合并隐藏           |
| M6-T03 Decision 应用账本  | `CONSUMED → PENDING_APPLY → APPLIED/REJECTED`                               | M4+M6 测试                   |
| M6-T04 EvidenceEvent      | 14 类离散事件白名单、入库脱敏、截断、幂等与关联                             | timeline 模块测试            |
| M6-T05 审计查询与导出     | owner 项目范围、审计链先验证、JSON/JSONL 导出                               | audit-query 与 store adapter |
| M6-T06 时间线视图         | 管理 API + WorkItem 详情离散事件与导出入口                                  | Web 契约测试                 |
| M6-T07 安全脱敏           | 路径、密钥、客户名、CoT、token stream、原始日志和 diff fail closed          | 负向测试                     |

## 2. 设计

- `src/codex/control/evidence-timeline.js` 负责事件白名单、脱敏、持久化适配、查询和导出；
- `src/codex/control/audit-query.js` 在查询前验证追加式审计链；
- `src/codex/control/store-audit-adapter.js` 将现有 control event chain 映射为可查询审计记录；
- daemon 创建时间线和审计查询服务并注入管理面；
- Decision、Wait 和 Decision 应用操作追加离散时间线事件；
- 管理 API：
  - `GET /api/work-items/:id/timeline`；
  - `GET /api/work-items/:id/timeline/export`；
  - `GET /api/audit`；
  - `GET /api/audit/export`；
- WorkItem 详情展示类型、摘要、时间和截断 artifact hash，不渲染原始 payload、日志或思维链。

## 3. 安全边界

- 未知事件类型和缺失关联 ID 拒绝；
- 同一 eventId 只有内容一致才幂等；
- 绝对路径、凭证、客户名先脱敏；
- CoT、逐 token、原始日志、stdout/stderr、完整 diff 直接拒绝；
- 审计链缺失或损坏时查询失败，不静默跳过；
- 导出受角色和项目范围裁剪；
- 事件载荷有数量、深度、长度和总大小上限。

## 4. 验证

| 命令                        | 结果                           | 退出码 |
| --------------------------- | ------------------------------ | ------ |
| M6 timeline/web/UI 聚焦套件 | 21 项，21 通过，0 失败，0 跳过 | 0      |
| ESLint（M6 涉及文件）       | 通过                           | 0      |
| Prettier（M6 涉及文件）     | 通过                           | 0      |
| `git diff --check`          | 无空白错误                     | 0      |

真实云端审计导出、跨大库分页和人工时间线回放尚未执行；全仓组合验证将在 M5-M7
完成后统一执行。

## 5. 阶段结论

M6 的离散证据、决策 artifact 绑定、审计链查询/导出和脱敏时间线已完成受控验收。
时间线只提供事实回放，不把未执行检查显示为通过。
