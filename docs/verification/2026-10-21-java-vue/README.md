# 本次验收结果

最终插件回归：395 项，394 通过、0 失败、1 跳过。本机缺少 `py -3.12`，因此跳过既有 Python venv 集成用例；没有将它记为通过。原始插件输出保存在 [plugin-tests.txt](plugin-tests.txt)。仓库 ESLint、变更源码 Prettier、Git whitespace check 和 npm 打包预检通过。

四个最终模板均在 Windows x64 上真实运行：Maven 3.9.11、Node 24.14.0，JDK 8u472 / 17.0.18 / JetBrains JBR 21.0.9（包含 javac）。每档实际执行 3 个后端用例与 5 个前端用例，七个阶段全部通过。后端还实际启动两次，核对 HTTP 创建、读取、更新、正常重启字段持久化、删除及删除后的 404。

| 版本档 | 对账 | 测试 | 原始报告 |
| --- | --- | --- | --- |
| JDK 8 / Boot 2.7 | 7/7 | 后端 3/3、前端 5/5 | [report.json](jdk8-boot2.7/report.json) |
| JDK 17 / Boot 3.5 | 7/7 | 后端 3/3、前端 5/5 | [report.json](jdk17-boot3.5/report.json) |
| JDK 21 / Boot 3.5 | 7/7 | 后端 3/3、前端 5/5 | [report.json](jdk21-boot3.5/report.json) |
| JDK 21 / Boot 4.0 preview | 7/7 | 后端 3/3、前端 5/5 | [report.json](jdk21-boot4.0/report.json) |

各目录保留原始 JUnit XML、Vitest JSON 及命令全文（`.txt`）；`log-index.json` 将运行报告中的原始日志路径映射到归档文本。报告中的 cwd 和原始日志路径属于隔离验收目录，不是用户项目。Golden 记录在核对最终模板哈希和全部实际用例后才更新。

JDK 8u504 与 Maven 3.9.11 还单独完成了真实下载、项目内解压、可执行探测和再次复用验收，见 [provision.json](provision.json)。浏览器验证了真实任务新增与完成切换；界面截图见 [预览](../../design/sg-admin-preview.png)。

本次没有可运行的 Linux 主机，因此 **Linux 未作本机端到端验收**。Linux 路径/变量分支有单元回归，并新增 Windows/Ubuntu × 四版本档的 GitHub Actions 验收；CI 文件已写入，尚未提交触发执行。
