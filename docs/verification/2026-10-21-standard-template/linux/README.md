# Linux 验收待办

2026-10-21：用户要求暂时标记 Linux 验收，并提交、推送当前 `sg-java` 分支。Linux 验收因此暂缓，不阻止本次分支提交；四档平台验收仍未完成。

| 版本档 | Linux 实测结果 | 当前处理 |
| --- | --- | --- |
| `jdk8-boot2.7` | `not-run` | 暂缓，待 Linux runner |
| `jdk17-boot3.5` | `not-run` | 暂缓，待 Linux runner |
| `jdk21-boot3.5` | `not-run` | 暂缓，待 Linux runner |
| `jdk21-boot4.0` | `not-run` | 暂缓，待 Linux runner |

当前执行环境没有可用 Linux runner、WSL 发行版或容器运行时。本次不安装机器级虚拟化组件。Windows 证据仅证明其记录的 Windows 场景，Golden 中 Linux 的 `result: not-run` 和各版本档的 `matrixComplete: false` 保持不变。

后续在现有 Linux 主机执行，或手动运行仓库的 `.github/workflows/java-template.yml`，选择 `sg-java` 分支。工作流已定义 Windows/Linux 四档矩阵；推送分支本身不会触发该工作流，本次也没有运行它。

- [ ] 对待验收提交使用 Node 24 和各版本档对应的 JDK，运行 `npm ci --ignore-scripts --no-audit --no-fund`。
- [ ] 逐档执行 `node scripts/verify-java-template.mjs <preset>`，保存原始报告、命令日志、后端测试和前端覆盖率证据。
- [ ] 核对报告中的模板 hash 与待验收提交的实际模板一致；所有必要阶段须有真实成功证据。
- [ ] 按原始结果补充 Linux 平台记录；仅在两个平台均实际通过时标记矩阵完成。
- [ ] 另行执行并记录 Linux `--full` 浏览器验收；四档脚本的基础验收不等同于完整浏览器验收。
