# 2026-10-21 标准模板验收

本目录只保存实际执行的模板验收证据。模板 hash 必须与当前 `src/v4/java-versions.js` 中的 Golden 记录一致。

## Windows 四档

以下四档均执行了 `mvn clean verify`、前端 `npm ci/build/test/lint/format:check`、JaCoCo/V8 覆盖率对账、后端 HTTP CRUD 与正常重启持久化：

| 版本档 | 结果 | 阶段 | 测试 |
|---|---|---|---|
| `jdk8-boot2.7` | `SMOKE_PASSED` | 8/8 | 12 backend + 11 frontend |
| `jdk17-boot3.5` | `SMOKE_PASSED` | 8/8 | 12 backend + 11 frontend |
| `jdk21-boot3.5` | `SMOKE_PASSED` | 8/8 | 12 backend + 11 frontend |
| `jdk21-boot4.0` | `SMOKE_PASSED` | 8/8 | 12 backend + 11 frontend |

原始证据位于 `win32/<preset>/report.json`、`frontend-tests.json`、JaCoCo XML、覆盖率摘要和对应日志。

## 完整浏览器验收

`win32/jdk8-boot2.7-full/` 是对当前模板执行的 `--full` 验收：

- 9/9 阶段通过，最终状态 `VERIFIED`；
- 真实 Chrome/Edge 完成 admin 登录、任务创建/修改/删除、后端重启后持久化和 viewer 只读权限检查；
- 原始报告为 [report.json](win32/jdk8-boot2.7-full/report.json)，浏览器日志为 [browser.log](win32/jdk8-boot2.7-full/browser.log)。

## 独立 sg-change 验收

`change-acceptance/` 保存 `add-reference-notes` 独立资源变更的最终摘要与验收报告。该流程读取项目内 `.specgate/examples/java-vue-admin-1`，执行 Maven/Vitest、代码走查、full 浏览器验证和集成归档；完整验证原始报告、浏览器日志与覆盖率证据位于 `change-acceptance/verify-full/`。

## 平台状态

- Windows：已完成四档构建与运行验收；JDK8 完成真实浏览器 full 验收。
- Linux：`not-run`，按用户 2026-10-21 的要求暂缓验收并提交当前 `sg-java` 分支。四个版本档均未执行 Linux 验收，Golden 保留 `matrixComplete: false`；此标记不代表跨平台验收通过。后续执行与补证要求见 [Linux 验收待办](linux/README.md)。

## 本次分支提交检查

2026-10-21 在 `sg-java` 分支重新执行：

- sg-java 相关聚焦回归：43 项通过，0 失败。
- `npm test`：404 项，403 通过，0 失败，1 跳过（本机缺少 Python 3.12）。
- `npm run lint`、`npm run format:check`、`git diff --check`：通过。
- `npm run pack:check -- --cache .specgate/npm-pack-cache`：通过，仅打包预检，没有发布 npm 包。

这些检查与上述原始验收报告共同描述当前证据范围；本次分支提交不新增 Linux 实测结果。验收目录中的原始 `.log` 文件随代码入库，便于远仓读取报告引用的命令日志。

原始 `.log` / `.txt` 输出通过 `.gitattributes` 保留字节及工具产生的空白，不对日志进行源码式空白修正；源码仍接受正常的差异空白检查。
