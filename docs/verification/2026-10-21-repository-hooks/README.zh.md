# sg-java 仓库钩子修复验收

日期：2026-10-21。分支：`sg-java`。源仓库 HEAD 保持 `5b95e38811d14cf98b64a8ee9b72ef7f65e1264b`，本次没有暂存、提交、推送或修改服务端分支保护。用户批准修改、验证和更新本地钩子，提交推送须再审批。

## 已实施

- 提交读取 Git index blobs，推送逐个读取真实 ref blobs；不调用格式化或 git add，隔离检查不会把未暂存修改夹入提交。
- NUL 文件列表包含删除/重命名；不支持的代码、冲突 index、符号链接/submodule、依赖锁不匹配、工具缺失、失败检查与检查期间快照漂移均阻断。
- JS/TS/Vue 静态与格式、Python Ruff、Shell 语法与格式、完整插件测试；受影响模板提交追加 JDK8 验收，推送追加 Windows 四档。
- Note 参考资源保持候选输入直接物化：实际后端 verify、前端 type/build/test/lint/format、覆盖率与 HTTP smoke。没有使用完整 sg-change 代理/浏览器工作流来代替批准的基础门禁。
- 旧 Java 资产实际执行 8 个 JUnit、Checkstyle、Spotless；模板启动 JS 单独执行语法/静态/格式检查。第三方 Maven Wrapper 内容固定，修改/删除阻断直到加入已审查的检查器。
- 格式化为独立命令，由用户检查后重新暂存；安装器尊重实际 hooksPath，预检两个钩子且保留用户自定义内容。
- sg-java 推送触发 CI 和 Windows 模板矩阵；Linux 模板只保留手动选项。

## 真实验证结果

| 检查 | 结果 |
| --- | --- |
| 聚焦钩子/环境/Java 验证/模板回归 | 26/26 通过 |
| 最终 `npm test` | 415/415 通过，0 失败，0 跳过 |
| `npm run lint` / `npm run format:check` | 通过 |
| `npm run hooks:check` | pre-commit / pre-push 当前版本已安装 |
| `npm run pack:check` | dry-run 通过，未发布 |
| 五个 Python 文件 Ruff static/format | 通过 |
| 三个 Shell 文件语法/格式 | 通过 |
| 隔离真实提交候选快照门禁 | 通过；JDK8 8/8 阶段，0 未运行 |
| 隔离真实推送候选快照门禁 | 通过；Windows 四档各 8/8 阶段，0 未运行 |
| 标准模板各档后端/前端测试 | 12/12 与 11/11，0 跳过 |
| Note 参考资源后端/前端测试 | 13/13 与 13/13，0 跳过，覆盖率通过 |
| 旧 Java 资产 | 8/8，Checkstyle 0，Spotless 通过 |

完整门禁于本机 `.specgate/hq-JiZ8JG/repo` 执行，只有该生成 fixture 有自己的 Git 基线提交；源仓库 index/HEAD 未变。提交快照于 06:09:14 UTC 通过，推送快照于 06:13:48 UTC 通过。之后仅收紧未物化参考文件的拒绝匹配并调整跨平台单测样例；聚焦 26/26、完整 415/415 和 lint/format 已重新验证。模板与验收命令没有再变化。

证据：本目录 `commit/summary.json`、`push/summary.json`、各自 `commands/` 和 `reference-report.json`；最终插件日志 `npm-test.log`、`focused-test.log`。四档模板原始报告/日志归档于同级 `2026-10-21-hooks-template/win32/`。全部 verify-runs 保留在本机 hooks-runs 成功证据目录，失败样例也保留并明确为失败。

模板启动脚本格式修复改变了模板哈希，Golden 只在真实四档验收成功、哈希一致后更新；不是直接修改哈希跳过测试。

## 明确未验证/不在范围

- Linux 模板：`not-run`，`matrixComplete=false`；暂缓而非通过。
- GitHub Actions 修改后没有推送，因此尚无本次远仓 CI 执行结果。
- 服务端分支保护没有修改或验证，本地钩子可被 `--no-verify` 绕过。
- Python/Shell/外部 TS 参考代码没有独立外部框架运行验收，仅声明静态/语法/格式及插件回归。
- 先前额外完整 sg-change 参考验收曾因浏览器 `Confirm delete` 未找到而失败；该完整流程本次不声明通过、不掩盖失败，也不作为已批准基础门禁的要求。

结论：本次批准的本地钩子修复范围可交付，等待用户审批后才允许提交/推送到 `origin/sg-java`。不能宣称 Linux/远仓 CI/服务端保护已完成。
