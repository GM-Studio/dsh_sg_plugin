# GET 查询 / POST JSON 写入：验收记录

本次验收针对接口约定变更，和上一轮验收分开保存。当前 Golden 四版本档均执行后端 clean verify、前端安装/构建/测试/lint/format check、真实 HTTP CRUD 与正常重启持久化，七阶段全部通过。每档后端 4 个实际用例、前端 5 个实际用例；新增用例覆盖 JSON body id 校验和旧写入方法被拒绝。

| 模板 | 实际结果 | 原始报告 |
| --- | --- | --- |
| JDK 8 / Boot 2.7 | 7/7 通过 | [report.json](jdk8-boot2.7/report.json) |
| JDK 17 / Boot 3.5 | 7/7 通过 | [report.json](jdk17-boot3.5/report.json) |
| JDK 21 / Boot 3.5 | 7/7 通过 | [report.json](jdk21-boot3.5/report.json) |
| JDK 21 / Boot 4.0 preview | 7/7 通过 | [report.json](jdk21-boot4.0/report.json) |

每个目录保留 JUnit XML、Vitest JSON、完整日志文本和原始运行报告。`log-index.json` 对应报告中的原始日志路径。第三档验收完成后的汇总因运行中重命名测试资源中断；该档结果从完整落盘报告恢复，逐一核对七阶段、实际用例和当前模板哈希。第四档随后独立运行并通过，合并真实结果后才更新 Golden。

多语言真实验收还包括：

- Express / Fastify 各 JS、TS 版本与 NestJS：安装、构建和生成 CRUD 测试均通过，删除响应核对 JSON 回执。见 [Node 状态](node-results.json)及 `frameworks/` 下原始文本。
- FastAPI、Flask、Django：生成用例加额外契约用例分别 4、3、3 项通过，核对 JSON 响应、body id、GET 不执行删除、删除回执和缺失资源；标准库 Python 7 项通过。见 [Python 状态](python-results.json)及 `frameworks/` 下原始文本。
- 旧 Java Item 生成器：与默认服务装配后 Maven verify 共 12 项通过，Checkstyle 零违规；见 [完整输出](legacy-java/verify.txt)与原始 JUnit XML。
- 旧 Node 生成用例 7 项通过。仓库契约回归还将 Vue/React API 客户端接入真实 HTTP 服务，验证新增、修改和删除调用。

仓库总回归 397 项：396 通过、0 失败、1 项因本机缺少 `py -3.12` 跳过，见 [原始输出](plugin-tests.txt)。ESLint、变更源码 Prettier、Git whitespace 和打包预检通过。Python 实测使用隔离的 Python 3.13 环境；Python 2.7 兼容分支仅作代码约定检查，未声称运行 Python 2.7。FastAPI 测试依赖产生一项上游 TestClient 弃用提示，测试均通过。

本机为 Windows，Linux 端到端结果仍须由已有 CI 执行。已有业务项目没有被自动迁移；本次修改的是生成模板和验证流程。
