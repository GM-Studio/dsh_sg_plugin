# M5 产品面与发行隔离验收

- 日期：2026-10-26；依据：v2.0-approved，CORE2-0501…0504；结果：通过。
- 本轮使用当前未提交工作树；未提交、未推送。此处通过不等于 M6 或 MVP 发布通过。

默认 MCP 43 个工具由完整有序清单断言锁定。可选入口仅在显式 optionalModules 模式出现；静态加载图不含 control、management、channels、MySQL repository 和安装器。源码中的历史模块继续保留，Core 包不含这些模块或 mysql2；离线安装后的 MCP handshake、诊断和 sg_project_status 均实际运行。

本轮先新增失败回归，修复默认 setup 仍安装六个历史角色、未绑定 Core 状态推荐不可用新建工具，以及安装包 sg_project_status 动态导入已排除 verify.js 的问题。默认 setup 安装 Test Designer、Implementer、Reviewer；显式历史初始化保留原六角色。只读验证快照提取到核心模块，旧验证入口复用相同实现。

| 检查                                     | 当前实测结果                                    | 证据（execution-20261026）                               |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| M0–M4 聚焦复验                           | 149/149，0 fail/skip/cancel                     | m0-m4-focused.txt                                        |
| M5 聚焦回归                              | 49/49，0 fail/skip/cancel                       | m5-focused-short-temp.txt                                |
| 全量回归（覆盖之前所有阶段）             | 723/723，0 fail/skip/cancel                     | m5-full.txt                                              |
| lint / format check / pack check / smoke | 全部退出 0                                      | m5-lint.txt / m5-format.txt / m5-pack.txt / m5-smoke.txt |
| 离线安装真实包                           | 无 MySQL 安装，非插件目录启动及只读项目状态通过 | m5-focused-short-temp.txt 中 offline tarball 用例        |

证据目录：[execution-20261026](../../verification/specgate-core-mvp/execution-20261026)。红色证据为 m5-red.txt、m5-red-pack-status.txt。首轮 baseline-full.txt 为 699 pass / 22 fail，原因是系统 TEMP 中残留 .git，触发祖先仓库保护；长路径临时目录另触发 Windows 路径限制。后续使用独立短 TEMP C:\sg-core-test-temp，未删除残留文件、未放宽路径保护或原断言。

临时调试目录 .task-evidence 和 .npm-cache 不作为代码格式化目标，保留原内容。获批计划正文保留原字节并从 Prettier 重排中排除；只更新验收附录。两份冻结需求未修改。

可选 MySQL 套件不属于 Core，未在本轮连接数据库验收；不能据此声称历史可选能力全部通过。真实 GitHub 项目金丝雀、原生 AI 角色及 H1/H3 人工审批归 M6，尚未完成。
