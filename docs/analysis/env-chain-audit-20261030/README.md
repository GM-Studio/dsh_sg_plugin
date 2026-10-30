# 本轮审查证据

对应报告：[环境链路审查](../../reviews/2026-10-30-environment-chain-audit.zh.md)。

这些文件是 2026-10-30 当前工作树上的实际命令输出与临时样例结果。`inventory.json` 是添加本轮材料之前的仓库快照；排除了 `.tmp`、忽略缓存、第三方依赖和 Git 内部数据。遍历读取/哈希不代表对全部行逐行人工走查。

| 文件                                   | 含义                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| inventory.json                         | 1065 个项目文件的大小、行数、SHA-256；无读取/JSON 解析错误                            |
| probes.json                            | 默认/可选工具面、不同栈环境入口、嵌套目录、版本范围和安装表单能力边界                 |
| actual-discovery.json                  | 当前 Windows 的真实工具版本/路径；环境就绪后，基线调用 Maven 仍失败                   |
| adoption-probe.json                    | 临时 Node 项目原树测试通过，隔离基线缺依赖却记 known-failures/ready，随后环境门禁阻断 |
| workflow-repros.json                   | 合成 provider 下复现已知问题遗漏、H3 决定分支、场景档案、根目录格式化和归档失败恢复   |
| focused.log                            | 7 个聚焦测试文件，76 项通过                                                           |
| npm-test.log                           | Core 126 文件，1141 项：1139 pass、1 fail、1 skip，退出1                              |
| lint.log / lint-final.log              | 初次/新增审计脚本完成后，lint 均退出0                                                 |
| format-baseline.log / format-final.log | 原有 5 个文件格式不合规，未修改它们；本轮交付材料格式检查通过                         |
| pack.log                               | 用工作区 npm 缓存重试 pack:check，退出0、150个文件                                    |
| smoke.log                              | stdio diagnostics 通过；真实宿主安装/审批/子代理明确 not-run                          |

从仓库根目录复现，使用现有 Node 与依赖，不触发下载安装：

```powershell
node --import ./test/setup-temp.mjs docs/analysis/env-chain-audit-20261030/probe.mjs
node --import ./test/setup-temp.mjs docs/analysis/env-chain-audit-20261030/actual-discovery.mjs
node --import ./test/setup-temp.mjs docs/analysis/env-chain-audit-20261030/adoption-probe.mjs
node --import ./test/setup-temp.mjs docs/analysis/env-chain-audit-20261030/workflow-repros.mjs
```

脚本从仓库根读取实现与现有测试 fixture，将复验结果写入 `.tmp/env-chain-audit-20261030`，不会覆盖这里保存的本轮证据。临时项目的 Git 提交只用于测试，合成批准仅用于服务契约隔离实验，不代表本仓库提交、真人批准或真实业务验收。脚本不运行 `codex exec`、下载、系统安装、推送或部署。

本轮未执行：MySQL 外部套件、真实用户安装审批、真实工具下载安装、独立 AI 角色执行、Linux/macOS/ARM 实机及生产部署。未声明这些事项通过。
