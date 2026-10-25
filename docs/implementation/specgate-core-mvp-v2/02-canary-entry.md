# 金丝雀项目入口条件（CORE2-0003）

- 对应任务：**CORE2-0003 定义金丝雀项目入口条件**
- 关联需求：v1.0 RQ-022 / AC-022-02；AC-MVP-01；计划 §4.6、§10.3 CORE2-0603
- 调查时间：2026-10-25
- 调查方式：真实命令扫描本机候选项目

---

## 1. 金丝雀硬性条件（来自需求）

| 编号 | 条件                                                          | 来源                        |
| ---- | ------------------------------------------------------------- | --------------------------- |
| C1   | 真实已有的 Git 仓库，非本插件仓库、非缓存目录                 | RQ-001 / RQ-020 / AC-MVP-09 |
| C2   | 工作区干净（`git status --porcelain` 为空）                   | RQ-001 / AC-001-03          |
| C3   | 技术栈为 **JDK 17 + Spring Boot 3.5 + Vue 3**                 | AC-022-02                   |
| C4   | build / test / lint / format / runtime 命令可由 argv 数组表达 | AC-022-01 / 计划 §4.4       |
| C5   | 金丝雀需求不得用于修改 SpecGate 仓库自身                      | 计划 §4.4 CORE2-0003        |

---

## 2. 候选扫描结果

### 2.1 扫描范围

```text
$ ls -d /e/ai_workflow/*/
AgentKit47-Qoder  ak47_dsh  demo1  demo_java  java-poc  java_demo
modify_dsh_sg  pilot-is-odd  pilot-java-api  pilot-node-api  pilot-py-api
pilot-vue-e2e  release  reviews  specgate-pilots  specgate-plugin-scripts
specgate-private  specgate-sg-java-lenient-validation
specgate-sg-java-validation  specgate/
```

### 2.2 Git 状态与技术栈实测

| 候选                                  | 是 Git 仓库  | 脏文件数 | 主技术栈                        | 符合 C2 | 符合 C3 |
| ------------------------------------- | ------------ | -------- | ------------------------------- | ------- | ------- |
| `pilot-java-api`                      | 是（master） | **0**    | JDK 8 + Boot 2.7.18，无前端     | 是      | **否**  |
| `specgate-sg-java-validation`         | 是（master） | 2        | JDK 1.8 + Boot 2.7.18 + Vue 3.5 | 否      | 否      |
| `specgate-sg-java-lenient-validation` | 是           | 未查     | JDK 1.8 + Boot 2.7.18           | —       | 否      |
| `demo_java`                           | 是（master） | **75**   | 混合（含 QuantDemo.java、文档） | 否      | 否      |
| `java_demo`                           | 是（master） | **29**   | 多子项目混合                    | 否      | 否      |
| `java-poc`                            | 否           | —        | —                               | 否      | —       |
| `specgate-pilots`                     | 否           | —        | —                               | 否      | —       |
| 其余（node / py / vue 试点）          | —            | —        | 非 Java+Vue 全栈                | —       | 否      |

### 2.3 全量 Spring Boot 版本扫描

```text
$ for d in /e/ai_workflow/*/; do
    grep -oE '<version>3\.[0-9]+\.[0-9]+</version>' $pom
    grep -oE '<java.version>[^<]+' $pom
  done

pilot-java-api                       | 3.3.1 | java.version 8
specgate-sg-java-lenient-validation  | 3.3.1 | java.version 1.8
specgate-sg-java-validation          | 3.3.1 | java.version 1.8
```

> 说明：上表的 `3.3.1` 是 Maven 插件版本号，**不是** Spring Boot 版本。三者的 Spring Boot 母 POM 实际均为 `2.7.18`。

### 2.4 插件内生成目录检查

```text
$ ls -d .runtime/*jdk17* .runtime/*boot3*
(none)

$ grep -rl 'spring-boot-starter-parent' --include=pom.xml .runtime
(none)
```

即使存在，`.runtime/` 位于插件仓库内，**违反 C1 与 C5**，不得作为金丝雀。

---

## 3. 结论

### 3.1 不存在符合全部硬条件的金丝雀项目

**最接近的候选：`pilot-java-api`**

| 条件                         | 结果       | 说明                                     |
| ---------------------------- | ---------- | ---------------------------------------- |
| C1 真实 Git 仓库             | 通过       | `master`，`a5d38cc`，23 个跟踪文件       |
| C2 工作区干净                | 通过       | `git status --porcelain` 输出为 0 行     |
| C3 JDK 17 + Boot 3.5 + Vue 3 | **不通过** | 实际为 JDK 8 + Boot 2.7.18，且**无前端** |
| C4 命令可 argv 化            | 部分       | 有 `mvnw` / `mvnw.cmd`；无前端构建命令   |
| C5 与插件仓库隔离            | 通过       | 独立目录                                 |

**唯一的失败点是 C3（技术栈）。**

### 3.2 按计划 §4.6 的处置

计划 §4.6 明文规定：

> 金丝雀不可用：M1-M5 可继续，M6 不得通过。

计划 §4.4 CORE2-0003 完成条件：

> 若没有真实项目，M6 保持 `BLOCKED`，**测试 fixture 不能冒充真实验收**。

**因此本任务判定：M6 预置为 `BLOCKED` 状态。**

这不阻断 M1–M5 —— 它们全部基于本仓库自身的测试与代码，不依赖金丝雀。

---

## 4. 解除 M6 阻断所需条件

用户需提供满足全部 5 条硬条件的真实项目，并在本文件登记下列信息：

| 登记项            | 要求                                                           |
| ----------------- | -------------------------------------------------------------- |
| 项目绝对路径      | 普通业务目录，不在插件仓库内                                   |
| Git 仓库确认      | `git rev-parse --is-inside-work-tree` 返回 true                |
| 基线 commit       | `git rev-parse HEAD` 实际值                                    |
| 干净工作区        | `git status --porcelain` 输出为 0 行                           |
| 技术栈            | JDK 17 + Spring Boot 3.5 + Vue 3（或经用户批准的等效金丝雀栈） |
| build 命令        | 可 argv 数组表达，例如 ['./mvnw', 'package']                   |
| test 命令         | 同上                                                           |
| lint 命令         | 同上                                                           |
| format check 命令 | 同上                                                           |
| runtime 启动命令  | 同上，需能验证 HTTP runtime 证据                               |
| 需求范围声明      | 明确该金丝雀需求不涉及修改 SpecGate 仓库                       |

### 4.1 若用户确认放宽技术栈

AC-022-02 明确要求 JDK 17 + Spring Boot 3.5 + Vue 3。若要改用 `pilot-java-api`（JDK 8 + Boot 2.7.18，无前端），需先修改已冻结需求 ——

按 v1.0 §16 与 Delta v1.1 变更规则，**必须形成新版本并重新审批**，不得静默调整。

该决策已在 M0 退门时提交（见 M0 验收报告待决策项 D-04）。

---

## 5. 与 AC-MVP 系列的连带影响

| 验收项                       | 是否受影响       | 说明                             |
| ---------------------------- | ---------------- | -------------------------------- |
| AC-MVP-01 完整成功链路       | **受阻**         | 需真实项目                       |
| AC-MVP-02 测试先行失败       | 不受阻           | 可在本仓库用测试样例验证         |
| AC-MVP-03 越界修改阻断       | 不受阻           | 同上                             |
| AC-MVP-04 修复上下文完整     | 不受阻           | 同上                             |
| AC-MVP-05 格式化后回归       | 不受阻           | 同上                             |
| AC-MVP-06 旧证据拒绝         | 不受阻           | 同上                             |
| AC-MVP-07 独立 Review        | 不受阻           | 同上                             |
| AC-MVP-08 最终人工验收       | 不受阻           | 同上                             |
| AC-MVP-09 无外部服务运行     | 不受阻           | 本仓库可验证                     |
| AC-MVP-10 当前提交自身可发布 | **已确认不成立** | npm test fail=6（见 CORE2-0001） |
| AC-MVP-11…16                 | 不受阻           | 均可在本仓库验证                 |

**结论：10 项验收中仅 AC-MVP-01 与 AC-MVP-10 受阻，其余 8 项不依赖金丝雀。**

---

## 6. 本任务完成条件核对

| 完成条件（计划 §4.4）                                | 状态                                   |
| ---------------------------------------------------- | -------------------------------------- |
| 记录用户批准的现有 Git 项目绝对路径                  | **无合格项目**，已如实记录扫描结论     |
| 记录项目 build / test / lint / format / runtime 命令 | 条件表已就绪，待合格项目回填           |
| 记录技术栈、基线 commit、干净工作区                  | 已记录全部候选实测值                   |
| 明确金丝雀需求不能用于修改 SpecGate 仓库自身         | C5 已列为硬条件                        |
| 项目是普通业务目录                                   | 已排除插件仓库与 `.runtime/`           |
| `git status --porcelain` 为空                        | 仅 `pilot-java-api` 满足，但技术栈不符 |
| 命令可由 argv 数组表达                               | 待合格项目回填                         |
| 若没有真实项目，M6 保持 BLOCKED                      | **已判定 M6 BLOCKED**                  |

**本任务以「无合格金丝雀，M6 置 BLOCKED」结案，未使用任何 fixture 冒充。**
