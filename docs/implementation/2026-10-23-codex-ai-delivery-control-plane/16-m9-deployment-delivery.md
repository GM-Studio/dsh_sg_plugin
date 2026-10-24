# M9 单机云部署、安全加固与试点阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`31aeeb6`（complete M8 bounded repair and redelivery）
- 制品标识：`WORKTREE-2026-10-24-M9`
- 状态：**部署资产、发布门禁和运维契约完成；真实云试点 NOT_RUN，发布结论最多 PARTIAL**

## 1. 交付范围

| 任务                  | 交付结果                                                             | 验证                 |
| --------------------- | -------------------------------------------------------------------- | -------------------- |
| M9-T01 云服务器部署   | systemd 单机服务、专用用户、重启策略和回环管理端口                   | 模板安全检查         |
| M9-T02 HTTPS/反向代理 | Caddy HTTPS、Host/Origin、可信代理和 secure cookie 约束              | manifest 与模板测试  |
| M9-T03 MySQL 备份恢复 | 全量+binlog 坐标、SHA-256 清单、保留策略、空目标恢复保护             | shell 语法和契约测试 |
| M9-T04 监控告警       | 认证 `/api/metrics`、有界健康快照、Worker/Attention/通知/DB/备份指标 | metrics 与 Web 测试  |
| M9-T05 安全演练       | 链接转发、令牌泄露、重放、断线演练门禁                               | release-check 测试   |
| M9-T06 真实试点       | 云主机、双项目、单 Worker、飞书/钉钉、决策/resume/再交付             | `NOT_RUN`            |
| M9-T07 发布检查       | 只读 CLI、PASS/PARTIAL/BLOCKED、未执行检查显式输出                   | CLI 测试             |

新增文件：

- `src/codex/control/deployment-assurance.js`
- `scripts/specgate-release-check.mjs`
- `deploy/systemd/specgate-control.service`
- `deploy/caddy/Caddyfile.example`
- `deploy/mysql/backup.sh`
- `deploy/mysql/restore.sh`

`package.json` 已加入这些发布资产和 `npm run codex:release-check`。

## 2. 发布门禁

`PASS` 必须同时满足：

- 远程 HTTPS、Host/Origin、可信代理和回环绑定；
- MySQL、认证加密密钥、设备确认和设备安全 Cookie；
- 新鲜且绑定 artifact/commit 的验证证据；
- 备份恢复实测 RPO/RTO 在目标内；
- 四类真实安全演练通过；
- 真实双项目单 Worker 试点完成飞书、钉钉、Decision、session resume 和再交付；
- 所有未执行检查明确登记。

缺失真实云、HTTPS 代理、生产 binlog 或试点时，结果只能为 `PARTIAL`；
证据矛盾、伪造、陈旧或失败时为 `BLOCKED`。

## 3. 运维边界

- systemd 服务使用专用非特权用户，不内嵌密钥；
- Caddy 只转发到回环管理端口并强制 HTTPS；
- 备份脚本使用 MySQL option file，不使用 password argv，采用严格模式和 0700 目录；
- restore 脚本要求显式空目标确认、校验 SHA-256，并拒绝覆盖已有数据；
- metrics 只输出白名单字段，不含项目路径、用户/客户名称、token 或原始异常。

## 4. 验证

| 命令                                 | 结果                               | 退出码 |
| ------------------------------------ | ---------------------------------- | ------ |
| M9 deployment + metrics Web 聚焦套件 | 15 项，15 通过，0 失败，0 跳过     | 0      |
| `npm test`（阶段性）                 | 705 项，699 通过，0 失败，6 跳过   | 0      |
| `npm run lint`                       | 通过                               | 0      |
| `npm run format:check`               | 通过                               | 0      |
| `bash -n`（backup/restore）          | 通过                               | 0      |
| `npm run pack:check`                 | 通过，包含 deploy 与 release-check | 0      |
| `git diff --check`                   | 无空白错误                         | 0      |

## 5. 未执行与阶段结论

- 真实云服务器、域名、证书和 Caddy/Nginx HTTPS；
- 生产 MySQL binlog、异地备份、实测 RPO/RTO；
- 真实飞书/钉钉故障演练和移动端；
- 真实双项目单 Worker 试点；
- 用户对 M9 发布范围的人工接受。

代码和发布门禁已完成，但不能把本地模板和受控测试当作真实云试点通过。
本阶段发布状态保持 `PARTIAL`，等待外部环境后再执行 M9-T06/T07 的真实发布检查。
