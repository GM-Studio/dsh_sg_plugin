# 金丝雀冻结配置格式修正提案（尚未消费审批）

Test Designer 的真实诊断发现：冻结候选中的两份 TypeScript JSON 配置与获批 Prettier 3.9.10 规则不一致，`npm run format:check` 退出 1。原始输入、依赖哈希、测试和失败日志保持原样，不能将当前配置记为质量通过。

修正候选只对 `frontend/tsconfig.app.json` 和 `frontend/tsconfig.node.json` 应用既有 Prettier 规则。已使用 JSON 解析后逐值比较，语义完全相等；两份候选通过该版本的 Prettier API check。原始配置和修正副本均保留。

| 文件                        | 原始 SHA-256                                                     | 格式修正后的 SHA-256                                             |
| --------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| frontend/tsconfig.app.json  | 098669211126184af6fd9cb696d42fa61ed14a08f3a9a1c566168061a9c16007 | ba269ef2b7558d8168fe281e92b77a8e2408725654236189e196e2f0570a178d |
| frontend/tsconfig.node.json | 88290bb651162b2645f6e8ff1e45c724df362ec1c7232cd8f72762e8389444de | 28a84e81342a517a782b7772b21279260bfaf1075681c16c6f489b40dc8d4401 |

依赖文件 `backend/pom.xml`、`frontend/package.json` 和 `frontend/package-lock.json` 仍须精确匹配原 H1 的三个哈希。原后端 119 项、前端 49 项测试、生产功能范围、文件白名单、质量门及覆盖率阈值全部保持。修正不能省略真实全红基线、格式化后全量回归、独立 Review 或 H3。

计量证据：[canary-format-normalization.json](../../verification/specgate-core-mvp/execution-20261026/canary-format-normalization.json)。候选副本位于源码工作区 `.task-evidence/20261026-canary/normalized/frontend/`，尚未写入产品代码或覆盖任何冻结输入。

本提案不是审批回执，不代表测试或 M6 已验收。后续必须由当前状态机的原生 H1 重新审批路径消费真实用户决定，并由真实 Test Designer 形成新冻结测试，再执行新红色基线。
