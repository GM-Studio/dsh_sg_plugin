# 任务：java-extension

<!-- 前置：java-core 已完成并归档。 -->
<!-- 每个任务一个标题，紧跟一行 sg:task 元数据；勾选状态由编排器维护。 -->

## 建议波次

| 波次 | 任务 |
|---|---|
| W1 | T-101 |
| W2 | T-102 |
| W3 | T-103、T-104 |
| W4 | T-105、T-106 |

---

## T-101 JDK21 + Boot4

<!-- sg:task {"id":"T-101","title":"JDK21 + Boot4","ac":["AC-101","AC-102","AC-103","AC-104"],"deps":[],"parallel":false} -->

- [ ] JDK21 + Maven + Boot4 脚手架
- [ ] Boot4 `pom.xml`、Wrapper、测试
- [ ] 未授权组合 `UNSUPPORTED_MATRIX`
- [ ] Maven 3.9.x / Gradle 8.14+ 版本约束
- [ ] 集成测试：JDK17/JDK21 + Boot4

## T-102 Gradle 脚手架

<!-- sg:task {"id":"T-102","title":"Gradle 脚手架","ac":["AC-105","AC-106","AC-110"],"deps":["T-101"],"parallel":false} -->

- [ ] Groovy DSL 脚手架
- [ ] Kotlin DSL 脚手架
- [ ] 模板内置 Gradle Wrapper（脚本 + jar/properties）
- [ ] Boot2.7 → Gradle 7.6.x；Boot3/4 → 8.14+
- [ ] 集成测试：`./gradlew check`

## T-103 Gradle suite 与报告 [P]

<!-- sg:task {"id":"T-103","title":"Gradle suite 与报告","ac":["AC-107","AC-108","AC-109","AC-111"],"deps":["T-101","T-102"],"parallel":true} -->

- [ ] `runGradleSuite()` 与超时
- [ ] JUnit XML、JaCoCo XML
- [ ] 根 `check` 与 `:module:check`
- [ ] Wrapper 缺失/损坏错误
- [ ] 单测覆盖 Groovy/Kotlin、多模块、wrapper 错误

## T-104 monorepo 初始化 [P]

<!-- sg:task {"id":"T-104","title":"monorepo 初始化","ac":["AC-112","AC-113"],"deps":["T-101"],"parallel":true} -->

- [ ] `java-monorepo` stack
- [ ] Java 后端 + Vue/React 前端脚手架
- [ ] 根配置写入 Java 与前端 suite
- [ ] 集成测试：Vue/React monorepo

## T-105 monorepo 套件与 CI [P]

<!-- sg:task {"id":"T-105","title":"monorepo 套件与 CI","ac":["AC-114","AC-115","AC-116","AC-117","AC-118"],"deps":["T-103","T-104"],"parallel":true} -->

- [ ] 按 `changedFiles` 选择 suite
- [ ] 根构建文件触发全量
- [ ] Java job 与前端 job 拆分
- [ ] 单测覆盖后端/前端/根变更

## T-106 全矩阵、跨平台与文档 [P]

<!-- sg:task {"id":"T-106","title":"全矩阵、跨平台与文档","ac":["AC-119","AC-120","AC-121","AC-122","AC-123","AC-124","AC-125","AC-126"],"deps":["T-101","T-103","T-105"],"parallel":true} -->

- [ ] Ubuntu 全矩阵、Windows 组合、macOS 手动/nightly
- [ ] 缓存、最小权限、命令白名单
- [ ] 版本与 Wrapper SHA-256
- [ ] 路径/编码跨平台
- [ ] 文档与全量回归
