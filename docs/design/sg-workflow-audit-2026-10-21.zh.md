# SG 工作流扫描与修复记录（2026-10-21）

## 实际入口与状态

当前实际注册 **6 个命令**（sg-init、sg-verify、sg-change、sg-status、sg-context、sg-skill）和 **7 个工具**（sg_init、sg_verify、sg_change、sg_status、sg_skill、sg_run、sg_approve）。README 历史段落中的“5 命令、6 工具”已不代表当前清单；推进与审批由工具完成。

`index.js` 使用 DSH 的 tools/agents 服务创建 runtime，注册 `src/v3/commands.js`、`tools.js` 与写入守卫。目录名 v3 不代表默认初始化仍使用旧实现：默认 `/sg-init` / `sg_init` 路由到 `src/v4/java-init.js`，生成一个 Java/Vue 单仓任务管理示例。显式 `--v3` 进入旧需求澄清流程，`--adopt` 用于已有项目；历史 workspace 流程分后端、前端和契约目录，不能与默认 monorepo 元数据混用。

默认初始化需要空目录和宿主确认，写源码、需求 v1.0 与历史快照、质量命令配置、Golden 元数据和 Git 基线。**它没有运行 Maven、npm、测试、静态检查或格式检查**，因此 `init-report.json` 为 `GENERATED_ONLY`、`initializationComplete: false`，execution 各项为 `not-run`。模板历史 Golden 记录只表示发布模板曾验收，不能作为当前项目运行成功的证明。

初始化报告与变更状态机分别负责两个问题：初始化验证是否完成，以及当前 change 推进到哪里。无 change 时 `.specgate/state.json` 的 `IDLE` 只表示空闲，不能据此宣称质量通过。`sg-status` 现在同时显示初始化验证状态，并引导未验收项目执行 `sg-verify`。

变更仍沿用 v3：`H1_PENDING → PLAN → EXECUTING → INTEGRATING → H3_PENDING → ARCHIVING → DONE`；M1/M2 是机器校验，H1/H2/H3 是人工门。批准冻结产物哈希，执行阶段的任务在合并后才勾选，集成重新运行冻结套件。工作树、调度、代理池和写入守卫仍在此链路内。默认初始化与本地验证不启动代理，不替用户推进人工审批。

## 修复内容

1. Vue 模板引入固定版本 Element Plus，采用侧栏、顶部导航、统计卡、任务表单、状态标签和响应式布局。保留真实 HTTP CRUD、输入校验、忙碌反馈和安全文本渲染，直接引入所用组件，保留可执行 UI/client 测试。
2. JDK/Maven 扫描从“文件存在”改为“可运行且版本匹配”。扫描环境变量、PATH、常用安装目录、SDKMAN/Scoop/Chocolatey/Maven wrapper 缓存与项目 toolchains。支持 Windows exe/cmd/bat 和 Linux 可执行文件、符号链接；目录层数、候选数、探测时间均有边界。
3. Windows 读取 Machine/User 持久变量并与进程变量合并，保留两类持久安装根目录候选，避免旧进程变量掩盖新安装。Linux 读取环境与简单 shell 赋值，不执行 profile 脚本；当前进程变量优先。不会将全部环境变量或凭据写入报告。
4. 缺失工具时先使用宿主 `userQuestions` 询问安装根目录、bin 目录、可执行文件或便携压缩包。校验有效路径后保存 `.specgate/toolchain-paths.json`；空输入继续安装，取消终止。无对话服务可通过 `sg_verify({path, javaHome, mavenHome, install})` 或环境变量提供路径。
5. 无可用路径时下载 JDK/Maven 到 `.specgate/toolchains`；JDK 8 使用 Temurin 官方 API，现代版本沿用可配置镜像。Windows 默认 ZIP，Linux Maven 默认 tar.gz；用户指定 ZIP 时按真实后缀解压。扫描 Downloads 与项目下载缓存中的 zip/tar.gz/tgz/msi/exe/deb/rpm 名称并列入报告，系统安装器仅列为发现项；不直接执行系统安装器。
6. 每次验证生成独立 runId，阶段执行前写 running 状态使旧成功失效，逐阶段保存报告和完整日志。失败、阻塞、取消均同步初始化状态。互斥锁防止同项目并发安装/构建互相覆盖，Windows 子进程隐藏运行并支持取消。
7. 后端 `clean verify` 后核对新 JUnit 报告且必须有真实全部通过用例；前端 `npm ci`（无锁文件才 install）后执行类型检查/构建、Vitest JSON 用例对账、ESLint 零警告和 Prettier check。格式检查不会偷偷改写源码；需要修复时由用户显式运行 format。
8. 运行时真实验证健康检查、创建、读取、更新、正常停止、重启后字段持久化、删除及 404。强制杀进程不能充当正常重启的成功证明。工具链和大体积运行证据加入生成项目 Git 忽略规则。

## 如何对账

- `.specgate/init-report.json`：初始化阶段、完成标志、各项执行状态及最近验证链接。
- `.specgate/verify-report.json`：最新验证摘要；`reconciliation` 给出 expected/executed/passed/failed/notRun，`checks` 列出全部七个必需阶段。
- `.specgate/verify-runs/<runId>/report.json`：该次不可混用的报告；每个阶段包含参数、cwd、时间、退出码与日志路径。
- 同目录的 `*.log`、`TEST-*.xml`、`frontend-tests.json`：完整命令输出和测试原始证据。

只有七个阶段全部通过，才写 `SMOKE_PASSED` 与 `initializationComplete: true`。没有执行的检查不会被称为通过。真实模板验收可运行 `node scripts/verify-java-template.mjs [版本档]`；生成验收项目和结果放在仓库 `.specgate/template-qa/`，不会改动用户的已有业务项目。

## 平台证据边界

本机为 Windows，四个 Java 版本档使用真实 Maven/npm 和本地 HTTP 服务验收，下载回退也在隔离目录实测。Linux 代码路径有回归测试；新增 `.github/workflows/java-template.yml`，在 Windows/Ubuntu × 四个版本档执行真实验收并上传报告。新增 CI 尚需提交后由 GitHub Actions 执行，不能视为本次已实测 Linux。

本次没有更新用户已经初始化的其他项目，也没有安装或发布 DSH 插件。生成器修复作用于此后生成的项目；已有项目需要单独迁移 UI，验证器可直接检查已有 Java/Vue monorepo。
