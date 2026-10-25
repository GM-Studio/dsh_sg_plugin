# M0 金丝雀项目入口（CORE-0003）

- 用户本次指定并批准登记路径：`E:/ai_workflow/pilot-java-api`。
- 调查时间：2026-10-25T06:58:59.811Z。
- 仅只读检查；未构建、写入、升级或提交该业务项目。

## 真实检查结果

| 检查                                 | 实际结果                                            | 判定                         |
| ------------------------------------ | --------------------------------------------------- | ---------------------------- |
| Git 仓库                             | master / `a5d38ccaff4f12fb3aacf0d20ff1495b16191315` | 通过                         |
| `git status --porcelain`             | 空输出                                              | 干净                         |
| 目录边界                             | 插件目录之外的普通业务目录                          | 通过                         |
| pom.xml java.version / .java-version | 8 / 8                                               | 不满足 JDK 17                |
| Spring Boot parent                   | 2.7.18                                              | 不满足 3.5                   |
| 前端 package.json                    | git ls-files 无结果，无 Vue 前端                    | 不满足 Vue 3                 |
| 真实只读项目检测                     | `PROJECT_STACK_UNSUPPORTED`                         | 无法按当前 Java/Vue 入口接入 |

**结论：路径已由用户指定，项目当前不满足冻结 AC-022-02。M6 保持 BLOCKED；M1–M5 可依据计划 §4.6 继续。**

## 项目已有命令与未执行项

下列 argv 均由已读取的 Maven wrapper / pom.xml 得出，不是通过记录。`mvnw.cmd` 只是调用系统 mvn，未内置完整 Maven Wrapper；Maven/JDK 的真实可用性尚未验证。

| 门          | argv                                          | 来源                             | 当前状态 |
| ----------- | --------------------------------------------- | -------------------------------- | -------- |
| build       | `["./mvnw.cmd","-B","-DskipTests","package"]` | Maven wrapper and pom.xml        | NOT_RUN  |
| test        | `["./mvnw.cmd","-B","test"]`                  | pom.xml spring-boot-starter-test | NOT_RUN  |
| lint        | `["./mvnw.cmd","-B","checkstyle:check"]`      | pom.xml maven-checkstyle-plugin  | NOT_RUN  |
| formatCheck | `["./mvnw.cmd","-B","spotless:check"]`        | pom.xml spotless-maven-plugin    | NOT_RUN  |
| runtime     | `["./mvnw.cmd","spring-boot:run"]`            | pom.xml spring-boot-maven-plugin | NOT_RUN  |

前端 build/test/lint/format/runtime：无前端模块，未提供可用命令。Runtime 还需明确测试启动、就绪探测和清理方式，不能把一次启动推定为通过。

## M6 解锁条件

1. 提供满足 JDK 17 + Spring Boot 3.5 + Vue 3 的干净真实业务项目；或单独授权升级本项目后重新建立基线。仅提供路径并不授权本次修改业务项目。
2. 若要采用当前 Java 8 / Boot 2.7 项目替代验收栈，必须新版本需求及重新审批，不能静默修改冻结 AC-022-02。
3. 明确一项真实业务需求与 REQ/AC；完成可信 H1/H3、独立测试设计/实现/Review 和真实质量门。
4. 冻结项目确认过的 argv 命令与环境，保存基线 commit、工作区状态和实际执行证据。
5. 不使用插件源码、自建 fixture 或生成项目冒充此次真实验收。

原始机器记录：`.runtime/core-mvp-v1-m0/canary-inspection.json`。
