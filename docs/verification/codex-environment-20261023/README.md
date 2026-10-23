# 会话内环境准备与用户入口验收记录

日期：2026-10-23。状态：核心实现、双平台全量回归与十二组命令级矩阵通过；完整发布验收仍为 **pending**。

## 用户确认的运行模式

2026-10-23 用户选择“宿主 Codex 调度 Ubuntu 执行命令”。认证与会话留在 Windows 宿主，
通过现有 VMware Guest Tools 在 Ubuntu 内运行 SG/MCP、构建、测试及运行检查。
不迁移账号密码、`auth.json`、令牌或系统凭据，不配置新的 SSH 服务、WebSocket 监听或代理。
这不是把虚拟机 CLI 连接到宿主 app-server，也不是已启用 Codex Desktop 的 SSH 远程项目功能。

宿主登录状态复核退出码为 0；实际 Ubuntu 复核返回 `linux/x64`、Node `v22.22.1`，
SG stdio 的 health/version/status 调用通过，临时项目清理通过。
执行时间为 2026-10-23T06:38:56.392Z 至 06:38:56.551Z，exit 0；
原始证据见 [宿主调度 Ubuntu 的 MCP 复核](ubuntu-host-driven-smoke.json)。
此模式不要求 Ubuntu CLI 独立登录，因此不再等待用户在虚拟机登录。
Ubuntu 原生 Codex 会话、原生子代理和审批仍为未验证，不因模式选择自动变成通过。

## 实现范围

提供环境、项目、需求开发、只读状态四个 Skill，`$sg-codex` 负责导航，旧 setup 只转接。
共享环境核心先读取项目技术栈，再进行有界发现、复用、缺项计划、可信安装确认、隔离安装及真实复测。
初始化、实现、质量检查和交付使用同一环境门禁。状态查询不构造会写文件的控制面运行时。

工具缓存位于用户 `.specgate/toolchains`；固定归档版本并校验官方 checksum，国内镜像配置仅限当前进程和临时文件。
成功、失败及受控取消清理本次暂存；后续运行只回收有所有者标记且原进程已退出的暂存目录。
已有外部安装器原型保留为原有未提交工作，但不出现在 npm 发布文件或用户命令入口中。
维护用验收程序不是用户安装入口，也不发布到插件包。

## 验收代码身份

工作区在验收期间存在其他任务的并行修改，因此建立一次冻结源码副本，并把完全相同的归档复制到 VMware。
两端核心源码摘要均应为：

```text
693256f240cc75180c2010dd6e46576576ddda82f158a604e5767f0b1b587d15
```

摘要算法在 `scripts/verify-codex-environment.mjs`：按稳定顺序摘要 src、skills、Codex/Java 模板、scripts 和入口/package 文件，文本统一 LF。
归档 SHA-256 为 `D8E7D14F219EB587F08CA19BBC9C7FE714501618DD38EB6F647E51655C59F909`。
冻结 Windows 路径为 `.specgate/environment-frozen-20261023`，Ubuntu 路径为 `/home/sc/specgate-env-frozen-20261023`。
Windows 报告中的 baseCommit 只是祖先仓库 HEAD，不表示未提交变更已包含在该提交中；Ubuntu 复制目录没有 `.git`，如实记录 null。
以上原始报告生成时变更尚未提交；用户随后授权提交和推送。需求中的“同一 Git 提交发布验收”仍待提交后的复核，不能用源码摘要冒充发布提交。

冻结后仅调整五份 `agents/openai.yaml` 的 UI 简介长度，运行时代码、Skill 工作流正文、模板和组件目录未变；
最终工作区摘要为 `45ac5874ac062b41078e81ae33098464b5b20a54349e216eab66869ca74bac18`。
这部分另外通过六个 Skill 的 `quick_validate.py` 校验及 30 项入口聚焦回归，并重跑当前工作区 lint、format、pack（均 exit 0）。
两个完整矩阵报告仍保留原冻结摘要，未被改写成最终文案版本的完整重验。

提交前另从实际 Git 暂存树导出独立副本，排除未纳入本次提交的旧外部安装器原型及其 13 项测试。
该提交范围的聚焦回归为 47 passed；`npm test` 为 460 passed / 0 failed / 1 skipped（共 461 项），
lint、format、pack 均 exit 0。此结果与下表包含原型测试的早期冻结快照计数不同，不能混淆。
命令日志保留在 `.specgate/commit-focused.log`、`commit-tests.log`、`commit-lint.log`、`commit-format.log`、`commit-pack.log`。

## 平台与实际执行

| 项目                                 | Windows                           | Linux                                       |
| ------------------------------------ | --------------------------------- | ------------------------------------------- |
| 实际系统                             | Windows 10 专业版 10.0.19045 x64  | VMware Workstation / Ubuntu 26.04.1 LTS x64 |
| 聚焦回归                             | 47 passed                         | 覆盖于全量回归                              |
| `npm test`                           | 473 passed / 0 failed / 1 skipped | 473 passed / 0 failed / 1 skipped           |
| `npm run lint`                       | exit 0                            | exit 0                                      |
| `npm run format:check`               | exit 0                            | exit 0                                      |
| `npm run pack:check`                 | exit 0                            | exit 0                                      |
| 固定工具归档下载与校验               | Node、Maven、JDK 8/17/21 已通过   | Node、Maven、JDK 8/17/21 已通过             |
| 冻结快照 Java × Vue/React 六组       | 6/6 passed                        | 6/6 passed                                  |
| Codex 启动                           | 实际启动通过                      | 实际启动通过                                |
| Codex 登录                           | 现有 Windows CLI 报告已登录       | 本次模式不要求独立登录；原生会话未验证      |
| 宿主内新 Skill、原生审批、子代理交付 | not-run                           | not-run                                     |

一个跳过项为“缺少 React 模板树时拒绝”的反向夹具：实际模板树已存在，测试显式 skip，不冒充通过。
未在 Windows 11、Server 2022、Ubuntu 22.04/24.04、Debian 12 或非 x64 上执行验收。

实际使用的命令：

```text
node --import ./test/setup-temp.mjs --test test/codex-environment.test.js test/codex-tools-workflow.test.js test/codex-plugin-protocol.test.js test/codex-source-setup.test.js test/codex-baseline-job.test.js test/codex-control-web-integration.test.js test/codex-init-publication.test.js
npm ci --registry=https://registry.npmmirror.com
npm test
npm run lint
npm run format:check
npm run pack:check
node scripts/verify-codex-environment.mjs --output .specgate/acceptance-final --install-fixtures --matrix
node scripts/specgate-control.mjs doctor
codex --version
codex login status
```

矩阵逐一运行 JDK 8 / Boot 2.7、JDK 17 / Boot 3.5、JDK 21 / Boot 3.5 的 Vue 与 React 项目，
包括 Maven clean verify、前端锁文件安装、构建、测试、lint、格式、覆盖率、HTTP CRUD、重启持久化及前端运行检查。
这不包含浏览器自动化验收，也不证明原生 Agent/H1/H3 完整交付成功。

原始报告记录组件 URL、checksum、实际路径、命令参数、退出码、开始/结束时间、每组证据及临时目录清理结果。
仓库级测试日志记录退出码和执行耗时；未单独记录每条静态检查的起止时间，不补造时间戳。

- Windows 完整运行：2026-10-23T05:32:11.062Z 至 05:39:46.249Z，exit 0；[工具链与矩阵报告](windows-environment.json)、[MCP smoke](windows-smoke.json)、[帮助面能力诊断](windows-doctor.json)。
- Ubuntu 完整运行：2026-10-23T05:32:38.631Z 至 05:40:49.820Z，exit 0；[工具链与矩阵报告](ubuntu-environment.json)、[MCP smoke](ubuntu-smoke.json)、[帮助面能力诊断](ubuntu-doctor.json)。
- 两端报告的 `cleanup=completed`、各矩阵 `workspaceCleanup.status=removed`；额外对本次已知临时工具链与项目路径检查均不存在，没有遍历整个系统 Temp。
- Windows 完整逐阶段日志保留在 `.specgate/environment-frozen-20261023/.specgate/acceptance-final`；Ubuntu 完整证据取回至 `.specgate/env-evidence/ubuntu-final`，压缩归档保留在 `.specgate/vm-acceptance/linux-acceptance-final.tgz`。

## 已发现并修复的问题

- 真实模板矩阵暴露 Java 测试与 Vue/React 中文文案的格式偏差，已按各生成项目的格式规则修复并重跑。
- Ubuntu 真实负载下原基线测试的五秒等待不足，改为有界三十秒轮询，不改变基线通过条件。
- Windows 测试曾随机取得 Fetch 禁用端口；仅集成测试改用安全高位随机端口并有界重试，不改变生产监听策略。
- 验收期间并行写入曾短暂移除只读状态导出；恢复后添加状态审计快照一致性与初始化门禁回归，并冻结源码复验。
- 国内 JDK 候选镜像真实 GET 返回 403；未把 HEAD 成功当下载成功，最终改用真实下载并校验通过的南京大学镜像。
- 沙箱内 Maven 网络和 npm 缓存权限失败保留为失败记录；后续在正常获准的本机执行范围内重跑，不关闭 TLS 或安全策略。

## 剩余条件与结论边界

1. 用户已确认采用宿主调度 Linux 执行器模式，不再将 Ubuntu 独立登录作为本轮前置条件；Linux 原生 CLI 登录验收暂不执行，不能标为通过。不得复制 Windows 认证文件或保存登录凭据。
2. 真实宿主中调用五个新入口、兼容别名、缺 Node 时 Skill 自恢复与 MCP 重连、安装人工确认、H1/H3 与任务控制的交互验收仍未执行。
3. 现有 doctor 只读 help-surface 探测显示 plugin / execJson / nativeAgents 可被 CLI 帮助面识别，elicitation 未被识别；这不是实际原生调度或审批演练。
4. Codex/认证/插件层仍需单独报告，不能把 `environmentReady` 的工具链结论当作完整宿主就绪证明。相应 OpenSpec 任务 7、13–15 保留未完成。
5. 失败与清理已有校验损坏、下载失败历史及回归覆盖；权限不足、缺 Node 的双平台端到端场景仍需补验，不能宣称所有 AC 已完成。

登录状态检查采用官方 `codex login status`；认证存在不等于一次模型请求或子代理执行成功。
依据：[OpenAI CLI 参考](https://learn.chatgpt.com/docs/cli/reference)、[认证说明](https://learn.chatgpt.com/docs/auth)。

使用说明见 [会话内入口指南](../../environment-codex.zh.md)。本记录不改变已批准需求，也不降低发布验收门槛。
