# SpecGate for DSH

**中文** | [English](README.en.md)

![version](https://img.shields.io/badge/version-4.3.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![node](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)
![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.1--rc.2-purple)

> **sg-java 分支（v4.3 默认）**：`sg-init` 仅接受完全空目标目录（`.git`、空文件、空子目录也拒绝）；已初始化的 Java/Vue workspace 幂等跳过。确认后按版本档生成 Java + Spring Boot + Maven + Vue3 / TypeScript / Vite / npm 全栈任务 CRUD 与 H2 文件持久化，写入 req v1.0、单仓 Git 基线；**只生成**，不安装依赖、不执行质量命令。
>
> 版本档：`--version jdk8-boot2.7`（默认）、`jdk17-boot3.5`、`jdk21-boot3.5`、`jdk21-boot4.0`（preview）。每个版本档的模板 hash 在 `src/v4/java-versions.js` 的 Golden 清单中登记；只有匹配的已验证模板才允许 `sg-change`。未验证/自定义模板执行 `/sg-verify`。
>
> 质量：初始化不启动 agent；需要本地验证时执行 `/sg-verify`（或 `sg_verify({ path, install })`）：先跨平台扫描 JDK/Maven/Node（环境变量、PATH、常见安装目录），缺少 JDK 17/21 或 Maven 时自动装到项目 `.specgate/toolchains`（`--no-install` 可关闭），再执行后端 `mvn verify`、前端 install/build/test/lint/format:check，并启动后端执行 HTTP CRUD 与正常重启持久化，通过后状态为 `SMOKE_PASSED`；`--full` 追加真实浏览器 CRUD、重启持久化和只读权限检查，通过后为 `VERIFIED`。确认页只展示操作目录与技术栈。旧初始化/接入必须显式 `--v3` / `--adopt`。
>
> 需求与设计：[v4.3 需求](docs/requirements/2026-10-21-v4.3-sg-init-closed-loop-requirements.md)、[sg-java 需求](docs/requirements/2026-10-20-sg-java-init-requirements.zh.md)、[详细设计](docs/design/sg-java-init.zh.md)。Java8/Boot2 已老旧，本示例无认证，不是生产安全承诺。
>
> **v4.1（历史基线）**：sg-init 技术栈向导 —— Java JDK 8/11/13/17/21 × Spring Boot 2.7/3.x/4.x；Python 3.10–3.13 与 2.7（EOL）、FastAPI/Flask/Django；Node 20/22/24、Express/Fastify/NestJS；Vue/React + Vite；必选/可选依赖与最小/推荐/全量预设；不再做四维需求盘问，最终审批页紧凑确认技术栈与依赖；先全环境扫描并复用运行时，缺失的 Maven/Gradle/JDK/uv 走国内镜像装到项目 toolchains；未批准跳过安装/质量，失败降级提交。
>
> - 需求：[docs/requirements/2026-10-20-v4.1-stack-dependency-selection-requirements.md](docs/requirements/2026-10-20-v4.1-stack-dependency-selection-requirements.md)
>
> **v3.6**：Java 后端支持 —— JDK 8/11/17/21（LTS）、Spring Boot 2.7.x/3.x、Maven/Gradle、JUnit XML 适配器、Spotless/Checkstyle/SpotBugs 门禁，并与既有的 Node/Vue/React/Python 技术栈并存。
>
> - Java 细节：[`docs/requirements/2026-10-19-v3.6-java-stack-requirements.md`](docs/requirements/2026-10-19-v3.6-java-stack-requirements.md)
> - 设计与矩阵：[`docs/design/java-support-review.md`](docs/design/java-support-review.md)、[`docs/design/java-version-matrix.md`](docs/design/java-version-matrix.md)
> - v3.5 环境预检：[`docs/requirements/2026-10-19-v3.5-env-preflight-quality-requirements.md`](docs/requirements/2026-10-19-v3.5-env-preflight-quality-requirements.md)
> - v3.4 审查与可观测：[`docs/requirements/2026-10-19-v3.4-review-observability-requirements.md`](docs/requirements/2026-10-19-v3.4-review-observability-requirements.md)
>
> **v3.0 MVP**：AI 执行，机器证据裁决，人只批准需要自己批准的关口。
>
> - 命令：`/sg-init`、`/sg-change`、`/sg-status`、`/sg-context`、`/sg-skill`
> - 工具：`sg_init`、`sg_change`、`sg_status`、`sg_skill`、`sg_run`、`sg_approve`
> - 证据：编排器执行被冻结的测试套件；任务只有在合并之后才会被勾选
> - 文档：[`docs/demos/v3-mvp.md`](docs/demos/v3-mvp.md)

把 AgentKit47 的门控式开发工作流迁移到 DeepSeek Harness（DSH）的 Host 插件。

| 属性 | 值 |
|------|-----|
| 来源 | `AgentKit47-Qoder` 的 `templates/qoder/`（MIT） |
| 目标 | DSH `0.2.1-rc.2` 及以上 |
| 形态 | workspace bundle，安装到当前 DSH profile |
| 版本 | `4.3.1` |

---

## 目录

- [概述](#概述)
- [核心特性](#核心特性)
- [技能体系](#技能体系)
- [工作流与阶段机](#工作流与阶段机)
- [命令参考](#命令参考)
- [工具参考](#工具参考)
- [Java 后端（v3.6）](#java-后端v36)
- [安装](#安装)
  - [方式 A：GitHub 依赖（推荐）](#方式-a-github-依赖推荐)
  - [方式 B：plugin_manager 从 GitHub 安装](#方式-b-plugin_manager-从-github-安装)
  - [方式 C：本地目录](#方式-c-本地目录)
  - [方式 D：npm registry（仅当已发布）](#方式-d-npm-registry-仅当已发布)
  - [方式 E：离线 tgz 包](#方式-e-离线-tgz-包)
  - [发布产物（v3.6.0）](#发布产物v360)
  - [验证安装](#验证安装)
  - [启动与关闭](#启动与关闭)
- [配置](#配置)
- [多语言](#多语言)
- [快速开始](#快速开始)
- [写入与守卫](#写入与守卫)
- [输出显示](#输出显示)
- [文件布局](#文件布局)
- [验证](#验证)
- [已知限制](#已知限制)
- [代码审查与格式化门禁](#代码审查与格式化门禁)
- [开发](#开发)
- [许可证](#许可证)

---

## 当前默认入口（2026-10-21 修复）

默认 `sg-init` 生成 Java/Vue + Element Plus 最小管理界面，**只生成、未验证**，不会声称已运行测试。执行 `/sg-verify` 才实际运行 Maven clean verify、前端构建/测试/静态与格式检查、HTTP CRUD 和重启持久化。

生成 API 统一使用 **GET 查询、POST 写入、JSON 请求和响应**：修改为 `/api/tasks/update`，删除为 `/api/tasks/delete`，id 位于 JSON body；删除返回 200 JSON 回执。[接口约定](docs/design/http-api-convention.zh.md)同样适用于旧版 Java/Node/Python 和前端 CRUD 示例。

环境发现顺序为持久/进程变量、PATH、常见安装目录和项目 toolchains；缺少 JDK/Maven 时先弹出自定义路径对话框，空输入继续项目内下载安装，`--no-install` 禁止安装。也支持 `sg_verify({ path, javaHome, mavenHome, install })`。

每次验证的完整日志与 JUnit/Vitest 原始报告保存在 `.specgate/verify-runs/<runId>/`，最新摘要在 `.specgate/verify-report.json`；标准验证 8 个阶段全部通过才写 `SMOKE_PASSED`，`--full` 的第 9 个 browser 阶段通过才写 `VERIFIED`。失败、阻塞与取消均使旧成功状态失效，`sg-status` 同时显示初始化验证状态。

全面扫描与工作流说明见 [SG 工作流审计](docs/design/sg-workflow-audit-2026-10-21.zh.md)。下文 v3 初始化自动构建与四维澄清说明属于显式旧流程，不代表当前默认 `sg-init` 行为。

## 概述

SpecGate 是一套**规格驱动 + 人工门控**的开发工作流。它把"AI 写代码"拆成一条可审计的流水线：

```text
规格（proposal / specs）
   ↓  M1 机器校验 + H1 人工批准
计划（design / tasks / tests）
   ↓  M2 机器校验 + H2 人工批准
执行（worktree 并行 / 串行降级）
   ↓  合并后勾选任务
集成（冻结套件回归）
   ↓  H3 人工验收
归档（spec 增量落到 openspec/specs/）
```

设计上的三条硬约束：

1. **只有显式入口** —— 6 个命令、7 个工具，没有隐式触发。
2. **机器先裁决，人再批准** —— `M1`/`M2` 不通过，`sg_run` 直接拒绝推进，人工门根本不会出现。
3. **批准即冻结** —— 人工批准会给产物生成哈希，之后任何修改都会使批准失效。

## 核心特性

- **只有显式入口**：插件对外暴露的一切都必须主动调用 —— 当前 6 个 `/sg-*` 命令与 7 个 `sg_*` 工具。没有任何命令会自动运行，也没有任何 Skill 会被注册进会话技能目录。
- **唯一的自动面 —— 写入守卫**：`src/v3/guards.js` 拦截 `write` / `edit` 工具，拒绝对编排器专属路径的写入。这是唯一无需请求就会生效的行为（见[写入与守卫](#写入与守卫)）。
- **项目初始化（三种入口 + 确认前零写）**：`/sg-init` 支持 `-req <需求文档>`、自由描述、无参纯对话三种入口；Agent 按模板逐维澄清功能/非功能/约束/验收，**确认前不写任何文件**。确认页同时展示需求文档与技术栈，确认即 H0：写入 `docs/requirements/REQ.md`、派生 `openspec/REQ.md` 与只读快照，并一次性生成脚手架与首个 change：后端栈（java/node/python）的 change 固定为 `mvp-scaffold`（MVP框架搭建），随后自动生成 Item CRUD 代码与测试、跑格式化/静态检查/测试/reviewer，成功后归档并回到 `IDLE`；失败则停 `H1_PENDING` 并保留报告。问答不可用时 fail-closed（禁止自动确认）。幂等 —— 重复执行报告“幂等跳过”，不覆盖既有基线。
- **老项目接入**：在已有代码的仓库里执行 `/sg-init` 会扫描项目、反推需求草稿并生成 `docs/requirements-scan.md`，**不生成任何脚手架**；只在缺少仓库时补 `git init`，已有仓库保持原状，且只提交 SpecGate 自己生成的资产。
- **变更包**：`/sg-change <name>` 生成 `openspec/changes/<name>/` 骨架，并把项目推进到 `H1_PENDING`。
- **机器校验的质量门**：`M1` 校验 proposal 与 spec 增量；`M2` 校验 design、任务图、验收标准到用例的映射以及测试套件发现。任一不通过，`sg_run` 拒绝推进。
- **人工门**：`H0`（上下文）、`H1`（需求）、`H2`（计划）、`H3`（验收）。批准会对已批准产物生成哈希冻结，之后的任何修改都会被检出并要求重新批准。
- **冻结的测试证据**：测试套件由 `.specgate/config.yaml` 发现、哈希进计划，并由编排器重新执行。任务只有在其工作被合并后才会被勾选。
- **并行执行**：标记 `[P]`/`depends` 的任务在隔离的 Git worktree 中运行，配有单仓库 Agent 池、合并锁与熔断；非 Git 或工作区 dirty 时降级为串行单写者。
- **双语资产**：英文 `*.md` 与中文 `*.zh.md` 成对，由 `language` 配置项选择。
- **DSH 输出适配**：命令结果显示为持久命令卡片；工具结果显示为工具卡片。

## 技能体系

Skill 正文位于 `assets/` 下，**不会**被注册进 DSH 会话技能目录。`src/v3/skills.js` 把角色、阶段与条件映射到 Skill id，然后在派发时把匹配的正文注入**子 Agent 的提示词**。若你想自己读一份，使用 `sg-skill` 工具或 `/sg-skill <name>`。

当前共 **22 个** Skill：

| 分类 | Skill |
|------|-------|
| `sg-core/` | `sg-skill-anti-patterns` |
| `engineering/` | `sg-skill-architecture-design`、`sg-skill-code-review`、`sg-skill-critical-review`、`sg-skill-domain-modeling`、`sg-skill-requirements-definition`、`sg-skill-systematic-debugging`、`sg-skill-test-driven-development`、`sg-skill-triage-brief`、`sg-skill-vertical-slicing`、`sg-skill-writing-skills` |
| `productivity/` | `sg-skill-executing-plans`、`sg-skill-finishing-a-development-branch`、`sg-skill-using-git-worktrees`、`sg-skill-writing-plans` |
| `misc/` | `sg-skill-prototype`、`sg-skill-zoom-out` |
| `sp/`（移植自 superpowers） | `sp-skill-brainstorming`、`sp-skill-dispatching-parallel-agents`、`sp-skill-requesting-and-receiving-code-review`、`sp-skill-subagent-driven-development`、`sp-skill-verification-before-completion` |

**角色映射**（`ROLE_SKILLS`，见 `src/v3/skills.js`）：

| 角色 | 注入的 Skill |
|------|--------------|
| `planner` | `sg-skill-requirements-definition`、`sg-skill-vertical-slicing` |
| `implementer` | `sg-skill-test-driven-development`、`sp-skill-subagent-driven-development` |
| `tester` | `sg-skill-test-driven-development` |
| `reviewer` | `sg-skill-code-review`、`sp-skill-requesting-and-receiving-code-review` |
| `integrating` | `sp-skill-verification-before-completion` |
| `archive` | `sg-skill-finishing-a-development-branch` |

**条件选择**：并行派发追加 `sp-skill-dispatching-parallel-agents`；重试追加 `sg-skill-systematic-debugging`；多能力变更追加 `sp-skill-brainstorming`；验收标准超过 5 条追加 `sg-skill-triage-brief`。

## 工作流与阶段机

阶段只在显式调用 `sg_run` 时推进：

```text
IDLE
 ├─ /sg-init（-req / 描述 / 对话）──► 单页确认 = H0 ──► H1_PENDING   # 同时生成脚手架与首个 change
 ├─ /sg-init（老项目）──────────────► 单页确认 = H0 ──► H1_PENDING   # 只写需求资产，不生成脚手架
 └─ /sg-change ─────────────────────────────────────────────────► H1_PENDING
                                                │
        H1_PENDING ──(M1 + H1)──► PLAN ──(M2 + H2)──► EXECUTING
                                                        │
              DONE ◄── ARCHIVING ◄──(H3)── H3_PENDING ◄── INTEGRATING
```

| 阶段 | 发生什么 | 出口 |
|------|----------|------|
| `IDLE` | 没有进行中的 change | `/sg-change` |
| `H0_PENDING` | 兼容阶段：需求 + 技术栈待确认（此时 `state.change` 仍为 `null`）；确认前不写任何文件 | `/sg-init` 的单页确认（确认即 H0）；旧项目也可用 `sg_approve gate="H0"` |
| `H1_PENDING` | 编写 `proposal.md` 与 `specs/**/spec.md` | `sg_run` 执行 `M1`，随后 `H1` |
| `PLAN` | 编写 `design.md`、`tasks.md`、`tests/cases.md`、`tests/mapping.json` | `sg_run` 执行 `M2`，随后 `H2` |
| `EXECUTING` | 任务在 worktree 中运行；完成的合并并勾选 | 反复 `sg_run` 直到全部合并 |
| `INTEGRATING` | 重新执行冻结套件；生成 `acceptance.md` | `sg_run`，随后 `H3` |
| `H3_PENDING` | 等待人工验收 | `H3` 批准 |
| `ARCHIVING` | 把 spec 增量应用到 `openspec/specs/` | `sg_run` |
| `DONE` / `BLOCKED` / `ABORTED` | 终态或暂停 | `sg_run --retry` 从阻塞恢复 |

完整阶段集合（`src/v3/state.js`）：`IDLE`、`H0_PENDING`、`H1_PENDING`、`PLAN`、`H2_PENDING`、`EXECUTING`、`INTEGRATING`、`H3_PENDING`、`ARCHIVING`、`DONE`、`BLOCKED`、`ABORTED`。

`M1` 与 `M2` 是**质量门**而非人工门 —— 它们由 `sg_run` 自身强制执行，失败时以错误形式报出。

## 需求基线

确认后先写人类可读的 `docs/requirements/REQ.md`（模板格式 FR/NFR/AC），再由它派生 `openspec/REQ.md` 需求基线：

- 四类需求按盘问顺序连续编号 `REQ-001`、`REQ-002`…：功能（MVP）、非功能、约束与依赖。
- 验收标准连续编号 `AC-001`、`AC-002`…，每条声明 `- covers: REQ-xxx`，必须引用真实存在的需求编号。
- 同时写入只读快照 `openspec/history/v1.0/REQ.md`；两者必须逐字一致，不一致时 `M1` 报 `REQ_BASELINE_DRIFT`。
- 需求只在 `openspec/changes/<change>/` 的 delta 中演进，不直接改 `REQ.md`。

`.specgate/config.yaml` 的 `requirements.enabled` 控制是否强制校验：交互式 `/sg-init` 确认后自动置为 `true`；未接入需求基线的老项目保持 `false`，行为与旧版本一致。启用后：

- `/sg-change` 要求 `openspec/REQ.md` 与快照都存在且一致，否则拒绝创建；
- `M1` 要求 `proposal.md` 至少引用一个真实存在的 `REQ-xxx`，引用不存在的编号直接失败。

## 初始化与 MVP 自动构建（v3.10）

新项目确认后，`sg-init` 会：

1. 写入需求文档与基线；后端栈（java/node/python）第一变更固定为 `mvp-scaffold`（proposal「MVP框架搭建」）。
2. 生成通用 Item CRUD 代码与测试：`GET/POST/PUT/DELETE /api/items`（含 `/{id}`），内存存储，201/204/400/404 全覆盖。
3. 自动执行质量流水线：
   - Java：`mvnw spotless:apply` → `checkstyle:check` → `verify`
   - Node：`scripts.format` / `scripts.lint`（若配置）→ `node --test test/items.test.mjs`
   - Python：`python -m pytest -q tests`
   - reviewer 子 Agent 只读审查
4. 全部通过：勾选任务、把规格写入 `openspec/specs/mvp/spec.md`、归档 `openspec/changes/archive/<date>-mvp-scaffold`，状态回到 `IDLE`。
5. 任一失败：停在 `H1_PENDING`，保留代码与 `docs/mvp-scaffold-report.md`，不归档。

> 自动构建依赖 `subagents` 服务；不可用时停在 `H1_PENDING` 并提示“自动构建：跳过”，由 `/sg-run` 继续。
> Java 需 Maven/JDK，Python 需 pytest；工具链缺失会按失败处理并给出报告。

## 命令参考
| 命令 | 参数 | 用途 |
|------|------|------|
| `/sg-init` | `[-req <doc>] [自由描述]` | 三种入口：导入需求文档 / 描述后由 Agent 澄清 / 无参纯对话。确认页 = H0；后端栈确认后写入需求文档、`REQ.md`、脚手架与 `mvp-scaffold`，随后自动生成 CRUD 代码/测试并归档；确认前零写 |
| `/sg-change` | `<name> [--type feature\|modify\|fix\|remove] [--link <changeKey>]` | 创建变更包；进入 `H1_PENDING` |
| `/sg-status` | `[--path <repo>] [--json] [--verbose]` | 显示阶段、change、门控与计划状态 |
| `/sg-context` | `--reset` | 回到 `H0_PENDING` 并重新采集上下文（仅限 `H0_PENDING`/`H1_PENDING`） |
| `/sg-skill` | `<name>` | 打印一份 Skill 正文 |

`-req` 接受本地 Markdown/文本路径（相对项目根或绝对路径）；自由描述会进入 Agent 逐维澄清。确认前不创建或修改任何项目文件；已初始化项目重复执行返回“幂等跳过”，不覆盖需求基线。

## 工具参考

| 工具 | 参数 | 用途 |
|------|------|------|
| `sg_init` | 无 | 等价于 `/sg-init` |
| `sg_change` | `name`（必填）、`type`、`link` | 等价于 `/sg-change` |
| `sg_status` | `path`、`json`、`verbose` | 等价于 `/sg-status` |
| `sg_skill` | `name` | 等价于 `/sg-skill` |
| `sg_run` | `retry`、`force` | 恰好推进一个阶段。不接受命令、分支等覆盖参数 |
| `sg_approve` | `gate`（`H0`\|`H1`\|`H2`\|`H3`） | 请求人工批准某个门；模型无法自签。`H0` 在首个 change 产生之前执行 |

`sg_run` 是引擎：它校验 `M1`/`M2`、执行或重试任务、运行集成套件并写出验收报告 —— 但每次调用只推进一个阶段。

> `/sg-run` 与 `/sg-approve` **不是**斜杠命令，只有对应工具 `sg_run` / `sg_approve`。工具返回文本与本文档中的 `/sg-approve H1` 只是给人看的提示语。

## Java 后端（v3.6）

- **JDK**：8 / 11 / 17 / 21（仅 LTS）；JDK 13 会被拒绝。
- **Spring Boot**：2.7.x 与 3.x；严格矩阵：

  | Spring Boot | 允许的 JDK |
  |-------------|-----------|
  | 2.7.x | 8 / 11 / 17 |
  | 3.x | 17 / 21 |

- **默认新项目**：JDK 8 + Maven + Boot 2.7.18。
- **可选**：Gradle 8.x + Boot 3.x、JDK 17/21。
- **脚手架**：Web + Validation + Actuator、`/health`、JUnit 5 + MockMvc、Spotless（google-java-format）、Checkstyle、SpotBugs、JaCoCo。
- **执行器**：Maven（`mvnw verify`）与 Gradle（`gradlew check`）；Surefire/Failsafe/Gradle JUnit XML → SpecGate 报告。
- **质量阶段**：Spotless/Checkstyle/compile/SpotBugs；失败即阻断。
- **JDK 查找**：JAVA_HOME / PATH / SDKMAN / `.java-version` / `.sdkmanrc`；缺失 JDK 会报告，绝不自动安装。

`.specgate/config.yaml` 示例：

```yaml
stack: java
java:
  jdk: 8
  buildTool: maven
  bootVersion: "2.7.x"
quality:
  profile: strict
suites:
  - id: backend
    kind: maven
    cwd: "."
    jdk: "8"
    goals: ["-B", "-ntp", "verify"]
```

Gradle 项目使用 `kind: gradle`、`goals: ["check"]` 与 `reportGlob: "build/test-results/test/TEST-*.xml"`。

初始化会询问 `buildTool`、`jdk`、`bootVersion` 与 modules；非法组合在生成脚手架前即被拒绝（`JAVA_MATRIX_INVALID`）。

真实样例验证：JDK 8 + Maven + Boot 2.7（`mvn -B -ntp verify`）与 JDK 17 + Gradle + Boot 3（`gradle spotlessApply check`）均可构建成功；详见 v3.6 需求文档。

## 安装

SpecGate 以公开 Git 仓库分发；发布到 npm 是可选项。仓库本身就是完整插件，没有构建步骤。

### 方式 A GitHub 依赖（推荐）

在当前 profile 的 `package.json` 中加入：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-plugin-specgate"]
    }
  },
  "dependencies": {
    "dsh-plugin-specgate": "github:GM-Studio/dsh_sg_plugin#v3.6.0"
  }
}
```

然后在 profile 目录安装并重启 DSH：

```powershell
cd C:\Users\<用户名>\.dsh\profiles\desktop
pnpm install
```

`#main` 表示最新提交；`#<commit-sha>` 可固定构建。使用 npm 的 profile 可执行 `npm install`。

### 方式 B plugin_manager 从 GitHub 安装

调用 DSH 的 `plugin_manager` 工具：

```json
{
  "action": "install_bundle",
  "target": "github:GM-Studio/dsh_sg_plugin#v3.6.0"
}
```

等价简写：

```text
plugin_manager install_bundle target=github:GM-Studio/dsh_sg_plugin#v3.6.0
```

管理器接受 `github:`、`git+https://...`、Git 仓库 URL、`.tgz` URL，或**绝对路径**的本地目录。它会执行 `pnpm add`、选中 bundle 并重载 profile。由于改动会跨会话持久化并安装 Host 代码，DSH 可能要求 `danger-full-access` 授权。

如果提示 `already-installed`，先移除旧 bundle，或改用方式 A。

### 方式 C 本地目录

```text
plugin_manager action=install_bundle target=D:\plugins\specgate
```

本地路径必须是绝对路径。也可以在 profile 中使用 `link:`：

```json
"dependencies": {
  "dsh-plugin-specgate": "link:D:/plugins/specgate"
}
```

### 方式 D npm registry 仅当已发布

```text
plugin_manager action=install_bundle target=dsh-plugin-specgate@3.6.0
```

### 方式 E 离线 tgz 包

适用于内网 / 跨操作系统。在联网机器上构建一次：

```bash
npm pack
# dsh-plugin-specgate-3.6.0.tgz
sha256sum dsh-plugin-specgate-3.6.0.tgz
```

把 `.tgz` 拷到目标机器，用**绝对路径**安装：

```json
{
  "action": "install_bundle",
  "target": "/opt/packages/dsh-plugin-specgate-3.6.0.tgz"
}
```

Windows：

```json
{
  "action": "install_bundle",
  "target": "D:\\packages\\dsh-plugin-specgate-3.6.0.tgz"
}
```

或直接写进 profile：

```json
"dependencies": {
  "dsh-plugin-specgate": "file:/opt/packages/dsh-plugin-specgate-3.6.0.tgz"
}
```

然后在 profile 执行 `pnpm install`（或 `npm install`）并重启 DSH。离线包包含全部 Skill 与模板，但不包含 JDK/Maven/Gradle/Python，需要目标机器自行具备。

### 发布产物（v3.6.0）

- GitHub Release：`https://github.com/GM-Studio/dsh_sg_plugin/releases/tag/v3.6.0`
- 资产：
  - `dsh-plugin-specgate-3.6.0.tgz` —— 离线包（243 个文件，约 532 KB）
  - `dsh-plugin-specgate-3.6.0.tgz.sha256` —— SHA256 校验和
- 建议安装路径：
  - GitHub tag：方式 A / B（`github:GM-Studio/dsh_sg_plugin#v3.6.0`）
  - 离线包：方式 E（`.tgz` 绝对路径）
  - 本地目录：方式 C（绝对目录）

离线包包含 `index.js`、`src/`、`assets/`、`cordis.patch.yml`、`locale/` 与文档。它**不**打包 JDK、Maven、Gradle、Python 或 Node；需要时在目标机器上安装。

### 验证安装

重启 DSH，新开会话执行：

```text
/sg-status
```

如果命令不存在：

1. 确认 profile 的 `dsh.profile.bundles` 包含 `dsh-plugin-specgate`
2. 确认依赖能解析（在 profile 目录执行 `pnpm install`）
3. 重启 DSH
4. 查看 `~/.dsh/logs` 的加载错误
5. 确认 DSH `>= 0.2.1-rc.2`、Node `>= 20.19.0`

### 启动与关闭

SpecGate 是 Host 插件，没有独立后台进程，也没有启用/禁用开关。只要项目根存在 `.specgate/state.json`（由 `/sg-init` 创建），它就在该项目生效。若要在某个项目停用，删除 `.specgate/`（可选连同 `openspec/`）；仓库中其他内容都不依赖它。

## 配置

项目配置位于 `.specgate/config.yaml`，由 `/sg-init` 写入：

```yaml
# SpecGate v3 项目配置
workflowVersion: 3
schemaVersion: 3
language: zh
# 测试命令（argv 数组）。留空时回退到 package.json 的 scripts["test:json"]。
testing:
  command: []
  cwd: "."
# 同一波内并行任务上限（1-4）
maxParallel: 2
coverage:
  blocking: false
```

Java 项目在其上扩展 `stack: java`、`java:` 块、`quality:`、`coverage:` 阈值与 `suites:` 列表（见 [Java 后端](#java-后端v36)）。

| 键 | 说明 |
|----|------|
| `language` | `zh` 或 `en`。选择 `.zh.md` / `.md` 资产变体与命令输出语言 |
| `testing.command` | 项目测试套件的 argv 数组。留空时回退到 `package.json` 的 `scripts["test:json"]` |
| `maxParallel` | 同一波内最多并行任务数（1–4） |
| `coverage.blocking` | 覆盖率不达标是否让集成阶段失败 |
| `suites` | `sg_run` 执行并哈希进计划的具名测试套件 |
| `enabled` | 池中某个 Skill / 角色是否参与派发 |

`workflowVersion` 低于 3 的项目会被拒绝，而不是被静默接管（`WORKFLOW_VERSION_MISMATCH`）。

并行工作池默认值（`src/v3/pool.js`）：

| 参数 | 默认值 |
|------|--------|
| `poolSize` | `2` |
| `maxLeasedPerChange` | `6` |
| `reuseTasks` | `3` |
| `contextThreshold` | `0.7` |
| `contextTokens` | `128000` |
| `ttlMinutes` | `10` |
| `breakerFailures` | `2` |

某角色连续失败两次后熔断打开，其 Agent 被回收。

## 多语言

SpecGate 资产为双语：

- **中文为权威源**，英文为完整翻译。
- 资产命名：英文 `*.md`，中文 `*.zh.md`。
- 运行时与 `sg_skill` 按 `.specgate/config.yaml` 的 `language` 选择变体。
- 本仓库 README 同样双语：`README.md`（中文，默认显示）与 [`README.en.md`](README.en.md)（英文）。

## 快速开始

```text
/sg-init                              # 初始化当前目录
/sg-change add-login --type feature   # 创建变更包；阶段 H1_PENDING
#   ... 编写 proposal.md 与 specs/<capability>/spec.md ...
sg_run                                # 执行 M1；通过后批准 H1
sg_approve H1                         # 人工批准；阶段变为 PLAN
#   ... 编写 design.md、tasks.md、tests/cases.md、tests/mapping.json ...
sg_run                                # 执行 M2；通过后批准 H2
sg_approve H2                         # 阶段变为 EXECUTING
sg_run                                # 逐波执行，直到全部任务合并
sg_run                                # INTEGRATING：全量回归 + acceptance.md
sg_approve H3                         # 人工验收
sg_run                                # ARCHIVING → DONE
```

空项目首次初始化：

```text
/sg-init                    # 无参：Agent 逐维澄清 → 技术栈 → 一次确认
/sg-init 我想做登录和健康检查   # 描述入口：以描述为种子继续澄清
/sg-init -req docs/req.md    # 导入入口：宽松解析已有需求文档
# 确认页点“确认”后：写需求文档/基线 + 脚手架 + mvp-scaffold；随后自动生成 Item CRUD 代码与测试 → 质量/审查 → 归档 → IDLE
```

老项目（已有代码）接入：

```text
/sg-init                    # 扫描仓库、反推需求草稿；只写 docs/requirements-scan.md，不生成脚手架
sg_approve H0               # 写入 openspec/REQ.md 与只读快照 → H1_PENDING
```

任意时刻 `/sg-status` 都会报告当前阶段与下一步。

`tasks.md` 的并行写法：

```markdown
- [ ] T1 实现登录接口 [P]
- [ ] T2 实现登录页面 [P]
- [ ] T3 集成登录流程 depends: T1,T2 role: reviewer
```

没有 `[P]` 或 `depends` 时默认串行。`role:` 选择工作 Agent 提示词（`implementer` 或 `tester`）；其他取值按只读审查角色处理。

## 写入与守卫

`guards.js` 拦截 `write` 与 `edit` 工具，拒绝：

| 写入目标 | 原因 |
|----------|------|
| `.specgate/**` | 编排器专属状态 |
| `openspec/specs/**` | 只能由归档事务修改 |
| `acceptance.md` | 由编排器生成 |
| `<change>/design.md`、`<change>/tasks.md`、`<change>/tests/**`、`src/**`、`tests/**`，且**处于 `H1_PENDING`** | H1 尚未批准 |

其余写入一律放行。对 `workflowVersion` 低于 3 的项目守卫不生效，且它看不到通过 shell 命令完成的写入。

## 输出显示

| 入口 | 显示方式 | 历史 |
|------|----------|------|
| `sg_*` 工具 | 工具结果卡片（成功/错误文本） | 会话日志持久化 |
| `/sg-*` 命令 | DSH 持久命令卡片，可展开完整文本 | `command/run` + `command/done` |
| 新会话中的第一条命令 | 额外写入一条 `notice` 上下文消息，确保离开欢迎页并显示结果 | `user/message`（source.kind=`specgate`） |

设计约束：

- 只在 agent 空闲且会话还没有任何消息时追加 `notice`；活跃会话只显示命令卡片，不重复写历史。
- 绝不在工具调用与工具结果之间追加消息。旧版本曾注入合成 `assistant/message`，会导致 `tool_use` 没有紧邻的 `tool_result`，使后续请求直接 400。
- 命令异常同样有输出：返回 `kind: 'error'`，空会话同样写入错误 `notice`。

## 文件布局

```text
.specgate/
├── config.yaml
├── state.json              # 阶段、change、批准、计划
├── run.lock
├── worktrees/              # 并行任务的 Git worktree
├── evidence/               # 每个任务的运行证据
├── backups/
└── gates/
openspec/
├── REQ.md                  # 需求基线：REQ-xxx + AC-xxx（covers: REQ-xxx）
├── history/v1.0/REQ.md     # 只读快照，必须与 REQ.md 逐字一致
├── changes/<change>/
│   ├── proposal.md         # 问题 / 目标 / 非目标 / 影响面
│   ├── design.md           # 目标与非目标 / 任务图 / AC 到用例 / 风险
│   ├── tasks.md            # 任务图，[P] / depends / role
│   ├── specs/<capability>/spec.md
│   └── tests/{cases.md,mapping.json,touched.json,automation/}
└── specs/<capability>/spec.md   # 只在归档时写入
```

旧版 v3 初始化会把 `.specgate/state.json` 等运行态文件追加进 `.gitignore`；Java/Vue v4.3 初始化则把 `.specgate/state.json` 与 `.specgate/init-report.json` 纳入 Git 基线，确保真实 clone 后 `sg-status`/`sg-change` 可用。

对全新项目，确认页确认后立即写入 `docs/requirements/REQ.md`、`openspec/REQ.md`、`openspec/history/v1.0/REQ.md`、`project-context.md`、`AGENTS.md`、`docs/glossary.md`、`docs/adr/0001-initial.md`、`.github/workflows/ci.yml`，以及首个 change：java/node/python 为 `mvp-scaffold`（proposal「MVP框架搭建」），随后自动生成 Item CRUD 代码与测试、跑格式化/静态检查/测试/reviewer；成功后归档并回到 `IDLE`，失败则保留 `H1_PENDING` 与 `docs/mvp-scaffold-report.md`。其他栈仍为 `add-version`。后端新项目的需求基线第一条固定为 `REQ-001 MVP 框架与 Item CRUD 示例（框架基线）`，业务需求从 `REQ-002` 开始。老项目只写需求文档、基线与只读快照，不生成脚手架。

## 验证

- **全量 `npm test` 当前通过**；具体用例数、跳过项和失败项以命令输出为准。模板验收同时记录 Maven、npm、覆盖率、HTTP 与浏览器阶段的真实证据。
- `M1` 拒绝缺少 问题 / 目标 / 非目标 / 影响面 任一段的 proposal，以及存在未解析验收标准引用的增量。
- `M2` 拒绝缺少四个段落任一的 design、存在环的任务图、没有用例覆盖的 AC，以及无法发现的测试套件。
- 批准哈希：`H1` 之后修改 `proposal.md`/`specs/**`，或 `H2` 之后修改计划，都会使批准失效并强制重新批准。
- 写入守卫：`H1_PENDING` 期间写 `design.md` 被拒绝；批准后放行。shell 写入不被拦截。
- H0 门控：新流程确认页即 H0，确认后直接进入 `H1_PENDING`；旧项目仍可用 `sg_approve gate="H0"` 兼容。
- 输出回归：新会话命令写入 `notice`；活跃会话不重复写历史；运行中的 agent 不写消息；失败命令同样有输出。

完整记录见 [verification.md](docs/design/verification.md)。

## 已知限制

- 写入拦截覆盖 `write` / `edit` 工具；通过 shell 命令直接写文件不会被拦截。
- 初始化要求 Git 仓库以实现 worktree 隔离与提交纪律；没有 Git 时并行执行降级为串行单写者。
- 并行 worktree 要求工作区 clean；dirty 项目自动降级串行，不隔离未提交改动。
- 合并冲突不会自动解决；worktree 与分支会保留，需人工合并后重新执行 `sg_run`。
- 幂等 `--force` 只对追加类操作开放；状态类转换通过推进阶段自然重跑。
- Agent 角色仅限 `implementer`、`tester` 与只读审查角色；插件不提供角色目录。
- 不替代 AgentKit47 CLI 的 `init/upgrade/doctor/validate`；SpecGate 是 DSH Host 插件，不是独立 CLI。
- 插件不提供 MCP server 或 MCP 工具；DSH 侧的 MCP 能力与本插件相互独立。
- **升级提示**：前身插件 0.2.0 早期构建中的 `ak47_selftest_append` 会污染会话日志；升级后请在新会话中继续，旧会话若已出现 `tool_use` / `tool_result` 400 错误不要复用。

## 代码审查与格式化门禁

推送到远程前，本次 push 涉及的所有代码文件必须通过审查与格式化：

- **本地钩子**：克隆后执行一次 `npm run hooks:install`，安装 `pre-commit` 与 `pre-push`。
  - `pre-commit`：从 Git 暂存区导出隔离快照，执行对应语言的静态/格式检查与插件全测；Java/Vue 模板相关变更追加 JDK8 实际构建、前端检查/测试、覆盖率与 HTTP 验收。
  - `pre-push`：逐个待推送 ref 检查真实快照；模板相关变更追加 Windows 四档实际验收。纯删除代码也触发测试，缺少工具或检查失败均阻止操作。
  - 钩子只检查，不格式化、不重新暂存。部分暂存文件的未暂存修改不进入检查；失败证据位于 `.specgate/hooks-runs/`。
  - JS/TS/Vue 使用 ESLint（含 TS/Vue 解析器）与 Prettier，Python 使用 Ruff，Shell 使用 Bash 语法检查和 Prettier shell 插件。Java/Vue `.tpl` 通过物化项目工具检查，旧 Java/独立资源样例有单独验收；未知代码类型阻断。TS 参考样例仅静态检查，不声称其外部项目可编译。
  - 克隆后手动安装钩子；`hooks:check` 诊断实际 hooksPath。安装器保留自定义钩子并提示冲突。Linux 模板验收继续暂缓，Windows 模板 CI 在 sg-java 推送时触发。
  - Apache Maven Wrapper 是第三方启动资产：只接受已审查的原始内容哈希；修改/删除会阻断，必须先增加对应检查器。模板启动 JS 脚本另行执行语法、ESLint 与格式检查。成功和失败的命令日志/验收证据均保留在 `.specgate/hooks-runs/`。Python/Shell 参考代码只声明 Ruff/语法/格式及插件回归，不声称外部框架项目的业务验收已通过。
- **CI 复核**：`.github/workflows/ci.yml` 的 `review-and-format` job 在 push / PR 时对变更文件执行审查与格式检查。主分支应开启分支保护，把 `review-and-format` 与 `test` 设为必需状态检查。
- **命令**：

  | 命令 | 作用 |
  |------|------|
  | `npm run lint` | ESLint 全量检查 |
  | `npm run format:check` | Prettier 全量检查 |
  | `npm run gate` | 按 HEAD 与当前分支 upstream 的差异执行推送检查 |
  | `npm run gate:fix` | 显式格式化本次修改（不暂存）；模板输出需人工审查回写 |
  | `npm run hooks:check` | 检查当前工作区钩子是否已安装并匹配版本 |

> GitHub Actions 在推送后运行；本地钩子可以被 `--no-verify` 绕过。服务端分支保护需要另行配置并审批，本次没有修改或验证远仓分支保护。Linux 模板矩阵仅在手动选择 include_linux 时执行，不产生未运行的通过记录。

## 开发

```bash
node --test        # 运行测试
npm run lint       # ESLint
npm run format     # Prettier 写入
npm run gate       # 完整质量门
```

提交信息遵循 Conventional Commits：`<type>(<scope>): <description>`，`type` 限 `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `build` / `ci` / `chore` / `revert`，描述使用中文且不超过 72 字符、不以句号结尾。

## 许可证

MIT，基于 AgentKit47-Qoder 的模板与工作流设计。
