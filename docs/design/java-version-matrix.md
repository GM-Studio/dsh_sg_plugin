# Java 版本矩阵与工具链锁定（T-001）

> 状态：**候选锁定（Candidate Lock）**，尚未完成全矩阵 PoC  
> 适用 change：`java-core`（T-001）  
> 上游：`openspec/changes/java-core/design.md`、`proposal.md`、`tasks.md`、`docs/design/java-support-review.md`  
> 探测/核实日期：2026-10-19  
> 落盘范围：仅本文档；未修改代码、配置、测试或其他文档，未执行 `git commit`。

## 0. 证据等级与阅读方式

本文严格区分三类结论，**不把未执行过的组合写成“已验证”**：

| 标记 | 含义 | 判定标准 |
|---|---|---|
| ✅ 官方支持 | 官方文档明确声明该运行时/构建工具版本可用 | 有官方 System Requirements、兼容矩阵或 JRE 表 |
| 🟡 候选锁定 | 官方文档支持，但未在本仓库/本机实际执行 | 仅静态核实，等待 CI 或 PoC |
| ⚠️ 待 PoC | 官方未明确声明，或存在已知冲突，需要实际运行验证 | 不得作为默认组合 |
| ❌ 不支持 | 官方明确排除 | 初始化阶段应拒绝 |

> 本机探测结论见第 5 节：**当前机器只有 IDE 内置的 JDK 21 与 Maven 3.9.11，没有 JDK 8/11/17，也没有 Gradle**。因此本文的 JDK 8/11/17 组合全部是“官方支持 + 候选锁定”，不是“本机已验证”。

---

## 1. 结论摘要

### 1.1 `java-core` 默认锁定

| 项 | 锁定值 | 状态 |
|---|---|---|
| 构建/测试 JDK | **JDK 8** | ✅ 官方支持（Boot 2.7.18 要求 Java 8+） |
| 构建工具 | **Maven 3.9.11** + Maven Wrapper 3.3.4 | ✅ 官方支持 / 🟡 Wrapper 组合待 PoC |
| Spring Boot | **2.7.18** | ✅ 官方兼容（版本要求）；⚠️ 2.7 线 OSS 支持已结束 |
| analysis JVM | **JDK 17**（独立于构建 JDK） | 🟡 候选锁定，待 CI |
| Spotless | **3.10.4**（Maven 插件） | 🟡 候选锁定（3.x 要求 Java 17） |
| google-java-format | **1.28.0**（JDK 17） | 🟡 候选锁定 |
| Checkstyle | **12.3.1**（JDK 17） | ✅ JRE 17+ / 🟡 组合待 PoC |
| PMD | **7.28.0** | 🟡 候选锁定 |
| SpotBugs | **4.10.5**（JDK 17） | ✅ 运行时 Java 11+ / 🟡 JDK 8 字节码分析待 PoC |
| JaCoCo | **0.8.15** | ✅ 插件 Java 8+ / 🟡 组合待 PoC |

### 1.2 `java-core` 的 JDK 8 兜底工具集

当 analysis JVM 只能是 JDK 8 时，回退到下表；该表是**兜底**，不是首选：

| 工具 | JDK 8 兜底版本 | 状态 |
|---|---|---|
| Spotless | **2.32.0** | 🟡 2.33.0 起最低 JRE 从 8 升到 11 |
| google-java-format | **1.7** | 🟡 1.8+ 要求 Java 11+（Spotless 2.2.0 说明） |
| Checkstyle | **9.3** | ✅ 9.x 支持 JRE 8 |
| PMD | **7.28.0**，失败时回退 **6.55.0** | 🟡 官方安装页称 Java 8+，需实测 |
| SpotBugs | **4.7.3** | 🟡 4.8+ 要求 Java 11+ |
| JaCoCo | **0.8.15** | ✅ 插件编译目标为 Java 8 |

### 1.3 `java-extension` 建议锁定

| 项 | 建议值 | 状态 |
|---|---|---|
| JDK | **17 / 21** | ✅ |
| Spring Boot | **3.5.16 / 4.0.8** | ✅ |
| Gradle | **8.14.6**（Boot 3/4） | ✅ 官方要求 8.14+ |
| Gradle（Boot 2.7 存量） | **7.6.6**（JDK 8/11/17）；JDK 21 必须改用 **8.14.6** | ✅/⚠️ 见矩阵 |
| 质量工具 | 同 1.1 的 JDK 17/21 现代工具集；JDK 21 的 GJF 用 1.36.1、Checkstyle 用 14.3.0 | 🟡 |

---

## 2. 兼容矩阵

### 2.1 官方基线（原文核实）

| 组件 | 官方要求 | 来源 |
|---|---|---|
| Spring Boot 2.7.18 | Java 8，兼容至 Java 21；Maven 3.5+；Gradle 6.8.x / 6.9.x / 7.x / 8.x | [Spring Boot 2.7.18 Getting Started](https://docs.spring.io/spring-boot/docs/2.7.18/reference/html/getting-started.html) |
| Spring Boot 3.5.16 | Java 17，兼容至 Java 25；Maven 3.6.3+；Gradle 7.6.4+ 或 8.4+ | [Spring Boot 3.5 System Requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html) |
| Spring Boot 4.0.8 | Java 17，兼容至 Java 26；Maven 3.6.3+；Gradle 8.14+ / 9.x | [Spring Boot 4.0 System Requirements](https://docs.spring.io/spring-boot/4.0/system-requirements.html) |
| Maven 3.9.11 | JDK 8+（Maven 3.9.0 起最低 Java 8；3.9.11 为 3.9 线最新） | [Maven 3.9.11 Release Notes](https://maven.apache.org/docs/3.9.11/release-notes.html)、[Maven 3.9.0 Release Notes](https://maven.apache.org/docs/3.9.0/release-notes.html) |
| Gradle 7.6.6 | 运行 Gradle 支持 Java 8–19；Boot 2.7 声明支持 Gradle 7.x | [Gradle Compatibility Matrix](https://docs.gradle.org/current/userguide/compatibility.html)、[Gradle 7.6.6](https://services.gradle.org/versions/all) |
| Gradle 8.14.6 | 运行 Gradle 支持 Java 8–24；Boot 3.5 要求 7.6.4+/8.4+，Boot 4.0 要求 8.14+ | 同上 |

> 重要修正：`docs/design/java-support-review.md` 曾写“Boot 2.7 Gradle 插件只支持 6.8/6.9/7.x”。2.7.18 官方页面已明确写 **Gradle 6.8.x、6.9.x、7.x、8.x**。本文以 2.7.18 页面为准；但 2.7 插件在 Gradle 8.14 上的实际行为仍列为待 PoC。

### 2.2 组合矩阵

图例：✅ 官方支持且进入候选锁定；🟡 官方支持但非默认/待 PoC；⚠️ 官方兼容但必须显式启用；❌ 不支持。

| JDK | Boot 2.7.18 | Boot 3.5.16 | Boot 4.0.8 | Maven 3.9.11 | Gradle 7.6.6 | Gradle 8.14.6 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **8** | ✅ **默认** | ❌ | ❌ | ✅ | ✅ Boot 2.7 + Gradle 7.x | 🟡 可运行；Boot 2.7 声明支持 Gradle 8.x，待 PoC |
| **11** | ✅ 支持 | ❌ | ❌ | ✅ | ✅ Boot 2.7 + Gradle 7.x | 🟡 可运行；非项目默认 |
| **17** | ✅ 支持 | ✅ 支持 | ✅ 支持 | ✅ | ✅ Boot 2.7/3.5 可用；❌ Boot 4.0 | ✅ 全组合可用 |
| **21** | ⚠️ 官方兼容（≤21），**非默认**，需显式开关 + PoC | ✅ 支持 | ✅ 支持 | ✅ | ❌ Gradle 7.6 不能在 JDK 21 运行 | ✅ 官方支持 |

补充规则：

1. **JDK 8/11 只能配 Boot 2.7**；Boot 3.5/4.0 官方最低 Java 17。
2. **Boot 4.0 只能配 Gradle 8.14+**；Gradle 7.6.6 不满足。
3. **Gradle 7.6.6 最高只能在 JDK 19 上运行**；JDK 21 必须 Gradle 8.5+，因此本项目 Boot 2.7 + JDK 21 若用 Gradle，只能选 8.14.6。
4. **JDK 21 + Boot 2.7.18** 属于官方“兼容至 21”的范围，但项目策略仍将其定义为非默认、需显式验证；`java-core` 初始化交互不得默认提供该组合。
5. **JDK 13** 非 LTS 且 EOL，不进入选择项和 CI 矩阵，只允许手工绝对路径。

### 2.3 构建输出目标

| 项目 JDK | `maven.compiler.release` | class 文件主版本 | 说明 |
|---|---|---|---|
| 8 | `8` | 52 | JDK 17 编译时仍输出 52，保证 JDK 8 运行 |
| 11 | `11` | 55 | — |
| 17 | `17` | 61 | — |
| 21 | `21` | 65 | 仅 `java-extension` 默认 |

CI 必须用 `javap -verbose` 或字节码检查断言主版本，不能只看 `java -version`。

---

## 3. 质量工具锁定表

> 表内版本是**工具本体**版本。Maven 插件坐标（如 `maven-checkstyle-plugin`、`maven-pmd-plugin`、`spotbugs-maven-plugin`）由 T-010 单独锁定；未在本文写成已验证。

| 工具 | JDK 8 运行候选 | JDK 17 运行候选 | JDK 21 运行候选 | 兼容性说明 | 来源 |
|---|---|---|---|---|---|
| **Spotless**（Maven 插件） | **2.32.0** 🟡 | **3.10.4** 🟡 | **3.10.4** 🟡 | Spotless lib **2.33.0** 将最低 JRE 从 8 升到 11；**3.0.0** 起要求 Java **17**。因此 JDK 8 最高只能用 2.32.0，不能把 3.x 用于 JDK 8。 | [plugin-maven CHANGES](https://github.com/diffplug/spotless/blob/main/plugin-maven/CHANGES.md)、[lib CHANGES](https://github.com/diffplug/spotless/blob/main/CHANGES.md)、[Maven Central 元数据](https://repo1.maven.org/maven2/com/diffplug/spotless/spotless-maven-plugin/maven-metadata.xml) |
| **google-java-format** | **1.7** 🟡 | **1.28.0** 🟡 | **1.36.1** 🟡 | Spotless 2.2.0 明确：GJF 默认版本在 JDK 11+ 为 1.9，在更早 JDK 继续为 1.7；即 **1.8+ 需要 Java 11+**。GJF 1.28.0 的 POM 仍以 Java 8 为 target；1.36.1 的 POM 已是 **Java 21**。不同版本输出可能不同，必须固定版本。 | [GJF README](https://github.com/google/google-java-format)、[v1.28.0 pom](https://github.com/google/google-java-format/blob/v1.28.0/pom.xml)、[v1.36.1 pom](https://github.com/google/google-java-format/blob/v1.36.1/pom.xml) |
| **Checkstyle** | **9.3** ✅ | **12.3.1** ✅ | **14.3.0** ✅ | 官方 JRE 表：13.x/14.x 需 JRE **21+**；11.x/12.x 需 **17+**；10.x 需 **11+**；7.x/8.x/9.x 需 **8+**。JDK 17 不能用 13/14，JDK 8 不能用 10+。 | [Checkstyle JRE/JDK 表](https://checkstyle.org/index.html)、[Maven Central 元数据](https://repo1.maven.org/maven2/com/puppycrawl/tools/checkstyle/maven-metadata.xml) |
| **PMD** | **7.28.0** 🟡（备用 **6.55.0** 🟡） | **7.28.0** 🟡 | **7.28.0** 🟡 | PMD 7.28.0 官方“Installation”页写的是 **Java 8 or above**；这与“PMD 7 需要 Java 11”的旧印象冲突。因此先以 7.28.0 为候选，JDK 8 实测失败再回退 6.55.0。 | [PMD 7.28.0 安装页](https://docs.pmd-code.org/pmd-doc-7.28.0/pmd_userdocs_installation.html)、[PMD 7.28.0 Release Notes](https://docs.pmd-code.org/pmd-doc-7.28.0/pmd_release_notes.html)、[pmd-java 元数据](https://repo1.maven.org/maven2/net/sourceforge/pmd/pmd-java/maven-metadata.xml) |
| **SpotBugs** | **4.7.3** 🟡 | **4.10.5** ✅ | **4.10.5** ✅ | 当前官方手册：运行时 **Java 11+**；4.8.0 起进入 Java 11 线，因此 JDK 8 运行只能停在 4.7.3。手册同时声称“扫描 JDK 11+ 生成的字节码”，用 JDK 17 运行 SpotBugs 分析 **JDK 8 字节码** 的行为必须单独 PoC。 | [SpotBugs Requirements](https://spotbugs.readthedocs.io/en/stable/introduction.html)、[SpotBugs 4.8.0 Release](https://github.com/spotbugs/spotbugs/releases/tag/4.8.0)、[Maven Central 元数据](https://repo1.maven.org/maven2/com/github/spotbugs/spotbugs/maven-metadata.xml) |
| **JaCoCo** | **0.8.15** ✅ | **0.8.15** ✅ | **0.8.15** ✅ | `jacoco-maven-plugin` 0.8.15 的 POM 明确 `maven.compiler.release=8`；变更日志记录 0.8.11 起 Maven 插件至少 Java 8。0.8.15 官方支持到 Java 26，JDK 8/17/21 均覆盖。 | [JaCoCo Change History](https://www.jacoco.org/jacoco/trunk/doc/changes.html)、[0.8.15 POM](https://repo1.maven.org/maven2/org/jacoco/jacoco-maven-plugin/0.8.15/jacoco-maven-plugin-0.8.15.pom) |

### 3.1 关键风险与结论

1. **JDK 8 不能用现代 Spotless/Checkstyle/SpotBugs**。这是硬约束，不是配置问题：
   - Spotless 3.x → Java 17；
   - Checkstyle 10.x → Java 11，11.x/12.x → Java 17，13.x+ → Java 21；
   - SpotBugs 4.8+ → Java 11。
2. **首选策略不是“JDK 8 跑全部工具”，而是“构建用 JDK 8，analysis 用 JDK 17”**。这符合 design §7，也能让 JDK 8 项目用上现代规则。
3. **GJF 版本必须显式固定**。Spotless 会按 JVM 版本选择默认 GJF（JVM 17 → 1.28.0，JVM 21+ → 1.30.0+），不固定会导致不同机器格式化结果不同。
4. **PMD 7 的 Java 8 运行时结论是“官方文档支持、待实测”**。如果 JDK 8 上 `pmd check` 启动失败，回退 6.55.0；不要在文档里预先写成已验证。
5. **SpotBugs 分析 JDK 8 字节码是最大不确定项**。官方手册的措辞容易被误读为“只分析 JDK 11+ 字节码”。CI 必须显式跑一个 JDK 8 编译产物 + JDK 17 SpotBugs 的任务。

---

## 4. Maven / Gradle Wrapper 策略

### 4.1 Maven Wrapper

| 项 | 锁定/建议 |
|---|---|
| Wrapper 版本 | **3.3.4**（Maven Wrapper Plugin / Distribution / Jar 同一版本线） |
| 分发包类型 | **`bin`（默认）**：把 `.mvn/wrapper/maven-wrapper.jar` 纳入版本控制，不依赖运行时下载 jar |
| Maven 版本 | **3.9.11** |
| 生成方式 | `mvn wrapper:wrapper -Dmaven=3.9.11`（或等价的 wrapper 3.3.4 插件调用） |
| 项目内文件 | `mvnw`、`mvnw.cmd`、`.mvn/wrapper/maven-wrapper.properties`、`.mvn/wrapper/maven-wrapper.jar` |
| 来源 | Maven Central：`org.apache.maven.wrapper:maven-wrapper:3.3.4`；Maven 分发包：`org.apache.maven:apache-maven:3.9.11:bin@zip` |

官方依据：

- [Maven Wrapper 总览](https://maven.apache.org/tools/mavenwrapper.html)
- [Maven Wrapper Plugin 3.3.4](https://maven.apache.org/tools/wrapper/maven-wrapper-plugin/)
- [Maven Wrapper Distribution 3.3.4](https://maven.apache.org/tools/wrapper/maven-wrapper-distribution/)（明确 `bin` 为默认，直接提供 jar）
- [Maven 3.9.11 Release Notes](https://maven.apache.org/docs/3.9.11/release-notes.html)

`maven-wrapper.properties` 建议固定两个 URL：

```properties
distributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip
wrapperUrl=https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.3.4/maven-wrapper-3.3.4.jar
```

> SHA-256 属性名以 wrapper 3.3.4 实际生成的 properties 为准（不同 wrapper 版本对 `distributionSha256Sum` / `wrapperSha256Sum` 的支持不同）。**无论属性是否生效，CI 都必须独立执行哈希校验**，不能只依赖 wrapper 自身。

### 4.2 Gradle Wrapper

| 用途 | Gradle 版本 | distributionUrl | distribution SHA-256 | wrapper jar SHA-256 |
|---|---|---|---|---|
| Boot 2.7 存量（JDK 8/11/17） | **7.6.6** | `https://services.gradle.org/distributions/gradle-7.6.6-bin.zip` | `673d9776f303bc7048fc3329d232d6ebf1051b07893bd9d11616fad9a8673be0` | `14dfa961b6704bb3decdea06502781edaa796a82e6da41cd2e1962b14fbe21a3` |
| Boot 3.5 / 4.0（JDK 17/21） | **8.14.6** | `https://services.gradle.org/distributions/gradle-8.14.6-bin.zip` | `7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24` | `ad16bca46cb71bb5887c546860d93992aeee35c1fdaf4a242b0a612375d937e0` |
| `java-extension` 后续可选 | 9.8.1 | `https://services.gradle.org/distributions/gradle-9.8.1-bin.zip` | `dce76f55f8e251a3a1f130eb120f30b3d271de2b76c9b0729d316b5a1b6dc01f` | `3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98` |

`gradle-wrapper.properties` 建议：

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.14.6-bin.zip
distributionSha256Sum=7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24
```

校验来源：

- Gradle 官方版本服务：<https://services.gradle.org/versions/all>
- 每个版本的 `.sha256`：`https://services.gradle.org/distributions/gradle-<version>-bin.zip.sha256`
- wrapper jar 校验：`https://services.gradle.org/distributions/gradle-<version>-wrapper.jar.sha256`

> Gradle 7.6.6 不能运行在 JDK 21 上（官方兼容矩阵：Java 21 需要 Gradle 8.5+）。因此 `java-extension` 的 JDK 21 任务不得复用 7.6.6 wrapper。

### 4.3 SHA-256 校验建议（Maven）

以下哈希是本机 2026-10-19 从 Maven Central HTTPS 下载后计算的实际值，供锁定参考；正式写入模板前应与 Apache 官方分发校验值交叉复核：

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
| `apache-maven-3.9.11-bin.zip` | 9,278,421 | `0d7125e8c91097b36edb990ea5934e6c68b4440eef4ea96510a0f6815e7eeadb` |
| `maven-wrapper-3.3.4.jar` | 63,093 | `4e2fbf6554bc8a4702cdfdd3bef464f423393d784ddb037216320ce55d5e4e1` |
| `maven-wrapper-distribution-3.3.4-bin.zip` | 65,218 | `db7487641ba809ce66540a107e7d1ae8db6ba980480212fcc95e27eff82e68ec` |
| `maven-wrapper-distribution-3.3.4-only-script.zip` | 8,492 | `6cb584c2bc907b849a0b931d8266d3ff3214cdd3127115ed4f49fb7176413d36` |

建议的 CI 校验（Linux）：

```bash
echo "4e2fbf6554bc8a4702cdfdd3bef464f423393d784ddb037216320ce55d5e4e1  .mvn/wrapper/maven-wrapper.jar" | sha256sum -c -
echo "ad16bca46cb71bb5887c546860d93992aeee35c1fdaf4a242b0a612375d937e0  gradle/wrapper/gradle-wrapper.jar" | sha256sum -c -
```

Windows（PowerShell）：

```powershell
(Get-FileHash .mvn/wrapper/maven-wrapper.jar -Algorithm SHA256).Hash.ToLower()
```

校验策略：

1. Wrapper jar 在提交前校验一次，校验值写入版本清单（T-007 的 manifest）。
2. CI 每次构建校验一次，不匹配直接失败，错误码建议 `WRAPPER_CHECKSUM_MISMATCH`（新增，或复用 `BUILD_TOOL_NOT_FOUND` 的扩展）。
3. Gradle 必须使用 `distributionSha256Sum`；Maven 若 wrapper 版本支持 `distributionSha256Sum` 则写入，否则在 CI 脚本中校验下载后的 zip。
4. 不允许 `latest`、`+`、`SNAPSHOT`、版本区间。

---

## 5. 本机探测结果（当前机器可用工具）

探测命令与结果（2026-10-19，Windows，工作目录 `E:\ai_workflow\specgate`）：

| 命令 | 结果 | 说明 |
|---|---|---|
| `java -version` | **未找到（command not found，exit 1）** | PATH 无 `java` |
| `javac -version` | **未找到** | PATH 无 `javac` |
| `mvn -version` | **未找到** | PATH 无 `mvn`；`Get-Command mvn` 为 NOT FOUND |
| `gradle -version` | **未找到** | PATH 无 `gradle`；`~/.gradle` 不存在 |
| `$env:JAVA_HOME` | **空** | 未设置 |
| `Get-Command java/javac/mvn/gradle` | 全部 **NOT FOUND** | — |
| Chocolatey 已装包 | `python 3.14.3`、`visualstudio2026buildtools` 等；**无 JDK/Maven/Gradle** | `choco list` |
| `~/.m2/wrapper/dists` | 存在 `apache-maven-3.9.11` 与 `apache-maven-3.9.11-bin` 缓存 | 说明历史上使用过 Maven Wrapper 3.9.11 |
| `~/.m2/repository` | 存在，含 `spotless-maven-plugin 2.22.1`、`junit-jupiter 5.12.2` 等 | 只是缓存，不构成兼容性验证 |

IDE 内置工具（**不是系统 PATH 工具**）：

| 工具 | 路径 | 版本输出 |
|---|---|---|
| IntelliJ JBR（Java 运行时/JDK） | `D:\Program Files\JetBrains\IntelliJ IDEA 2025.3.1\jbr` | `openjdk version "21.0.9" 2025-10-21`；`javac 21.0.9`；`IMPLEMENTOR="JetBrains s.r.o."` |
| IntelliJ 内置 Maven | `D:\Program Files\JetBrains\IntelliJ IDEA 2025.3.1\plugins\maven\lib\maven3` | `Apache Maven 3.9.11 (3e54c93a704957b63ee3494413a2b544fd3d825b)`；`Java version: 21.0.9`；`Default locale: zh_CN`；`platform encoding: UTF-8` |
| PyCharm / WebStorm JBR | 各自 `jbr` 目录 | 均为 `JAVA_VERSION="21.0.9"` |

本机可用工具结论：

- **可用**：JDK 21（仅 IDE 内置 JBR）、Maven 3.9.11（仅 IDE 内置）。
- **不可用**：JDK 8、JDK 11、JDK 17、Gradle 7.6.x、Gradle 8.14.x、系统级 `mvn`/`java`。
- **直接后果**：
  1. 无法在本机执行 `java-core` 默认组合（JDK 8 + Boot 2.7.18）。
  2. 无法在本机验证 JDK 8 兜底工具集（Spotless 2.32.0 / Checkstyle 9.3 / SpotBugs 4.7.3）。
  3. 只能在本机做 **JDK 21 + Maven 3.9.11** 的单点冒烟；该组合不是 `java-core` 默认组合。
  4. 全矩阵 PoC 必须放到 CI；本文相应结论保持“候选锁定”。

---

## 6. 待验证项与 CI 验证方案

### 6.1 必须在 CI 跑的组合

`java-core` 阻断矩阵（Linux，Temurin）：

| 编号 | 构建 JDK | analysis JDK | Boot | 构建工具 | 工具集 | 目的 |
|---|---|---|---|---|---|---|
| C1 | 8 | 17 | 2.7.18 | Maven 3.9.11 | 现代集 | **默认组合**；字节码 52；Surefire + JaCoCo |
| C1b | 8 | 8 | 2.7.18 | Maven 3.9.11 | JDK 8 兜底集 | 无 JDK 17 的机器上的回退路径；验证兜底工具 |
| C2 | 11 | 17 | 2.7.18 | Maven 3.9.11 | 现代集 | JDK 11 兼容 |
| C3 | 17 | 17 | 2.7.18 | Maven 3.9.11 | 现代集 | JDK 17 兼容 |
| C4 | 17 | 17 | 3.5.16 | Maven 3.9.11 | 现代集 | Boot 3.5 基线 |
| C5 | 21 | 21 | 3.5.16 | Maven 3.9.11 | JDK 21 现代集 | JDK 21 基线 |
| C6 | 17 | 17 | 4.0.8 | Maven 3.9.11 | 现代集 | Boot 4.0 基线 |
| C7 | 21 | 21 | 4.0.8 | Maven 3.9.11 | JDK 21 现代集 | Boot 4.0 + JDK 21 |
| C8 | 21 | 21 | 2.7.18 | Maven 3.9.11 | JDK 21 现代集 | **仅显式验证**，非默认；可先 `continue-on-error` |
| C9 | 8 | 17 | 2.7.18 | Maven 3.9.11 | 现代集 | **Windows 冒烟**：`mvnw.cmd`、路径、编码、超时 |

`java-extension` 阻断矩阵（Gradle）：

| 编号 | JDK | Boot | Gradle | 目的 |
|---|---|---|---|---|
| G1 | 8 / 11 / 17 | 2.7.18 | 7.6.6 | Gradle 7.6 存量兼容 |
| G2 | 17 | 3.5.16 | 8.14.6 | Boot 3.5 + Gradle 8.14 |
| G3 | 21 | 4.0.8 | 8.14.6 | Boot 4.0 + JDK 21 |
| G4 | 21 | 2.7.18 | 8.14.6 | JDK 21 + Boot 2.7 的 Gradle 唯一可行组合 |

### 6.2 每个 CI Job 必须断言

1. `java -version` 与 `javac -version` 主版本等于目标 JDK。
2. `./mvnw -B -ntp -Dstyle.color=never verify` 退出码为 0。
3. `target/surefire-reports/TEST-*.xml` 与（如启用）`target/failsafe-reports/TEST-*.xml` 存在且可解析。
4. `target/site/jacoco/jacoco.xml` 存在；行 ≥80%、分支 ≥70%。
5. `javap -verbose` 或字节码扫描确认 class 主版本为 52/55/61/65。
6. Spotless `apply` 后工作区无 diff（或 `check` 通过）。
7. Checkstyle/PMD/SpotBugs 报告文件存在；P0/P1 违规阻断。
8. Wrapper jar / 分发包 SHA-256 匹配。
9. Windows Job 必须实际执行 `mvnw.cmd`，不能只跑 Linux `mvnw`。

### 6.3 可以本地/手动验证

| 项 | 方式 | 说明 |
|---|---|---|
| JDK 21 + Maven 3.9.11 + Boot 2.7.18/3.5.16/4.0.8 单点冒烟 | 本机 IDE JBR 21 + 内置 Maven | 只能证明 JDK 21 单点，不代表 JDK 8/11/17 |
| 单个工具 CLI 可启动 | `java -jar checkstyle-*.jar -c ...`、`pmd check`、`spotbugs -version` | 验证 jar 可执行，不验证 Maven 插件集成 |
| Wrapper 脚本语法 | `mvnw -v` / `gradlew -v` | 不验证真实构建 |
| 文档链接与版本号 | 人工复核 | 本文已做 |
| Maven Wrapper 哈希 | `sha256sum` / `Get-FileHash` | 已在 4.3 记录 |

### 6.4 当前阻塞与未解决项

| # | 问题 | 影响 | 处理建议 |
|---|---|---|---|
| B1 | 本机无 JDK 8/11/17 | 无法本地执行 `java-core` 默认矩阵 | 由 CI 执行 C1/C1b–C7、C9；本地只保留 JDK 21 冒烟 |
| B2 | 本机无 Gradle | 无法验证 7.6.6 / 8.14.6 | 交给 `java-extension` CI（G1–G4） |
| B3 | PMD 7.28.0 在 JDK 8 上是否可运行 | 影响 JDK 8 兜底集 | C1b 实测；失败回退 6.55.0 |
| B4 | SpotBugs 4.10.5 在 JDK 17 分析 JDK 8 字节码 | 影响 `java-core` 首选 analysis 方案 | C1 增加显式断言；失败则 JDK 8 工具集改用 4.7.3 |
| B5 | Spotless 2.32.0 + Maven 3.9.11 + JDK 8 | 影响兜底格式化 | C1b 实测；必要时降到 2.31.0 或改用 GJF CLI |
| B6 | Boot 2.7 已结束 OSS 支持 | 安全补丁缺口 | 默认保留用于存量 JDK 8；新项目引导至 Boot 3.5/4.0；在 G4/G7 风险中保留 |
| B7 | `maven-checkstyle-plugin` / `maven-pmd-plugin` / `spotbugs-maven-plugin` 版本未锁定 | T-010 无法直接落地 | 在 T-010 做插件级 PoC，不阻塞本文 |
| B8 | Windows 编码/超时未实测 | 可能影响 C9 | C9 必须包含 `platform encoding: UTF-8` 与 30 分钟超时断言 |
| B9 | Maven 3.10.0 已是当前稳定版（官网 2026-10-18 更新） | 3.9.11 不是最新稳定版 | 本 change 按需求锁 3.9.x；3.10.0 留给 `java-extension` 评估 |
| B10 | Boot 4.0 生态较新 | Spotless/Checkstyle/PMD/SpotBugs 对 Boot 4 无“官方组合”声明 | C6/C7 用实际项目验证；失败项降级为警告并记录 |

### 6.5 不进入矩阵的组合

- JDK 8/11 + Boot 3.5/4.0：官方最低 Java 17，直接拒绝。
- JDK 8/11 + Gradle 8.14：Gradle 能跑，但 Boot 3/4 不支持 JDK 8/11；Boot 2.7 下也不是项目默认，仅保留“可运行”说明。
- JDK 21 + Gradle 7.6.6：Gradle 7.6 最高 Java 19，直接拒绝。
- JDK 13：非 LTS/EOL，不进入选择项。
- Boot 2.7 + JDK 22+：超出 Boot 2.7 官方兼容上限（21）。

---

## 7. 对 `design.md` 待 PoC 项的回写建议

> 本轮任务范围只允许修改本文档，因此 **`design.md` 未被修改**。以下内容供 G4 复审后由 T-012 回写；在回写前，`design.md` 的“版本由 T-001 锁定”仍应按本文执行。

| `design.md` 位置 | 当前表述 | 建议回写 |
|---|---|---|
| §7 质量门禁 / analysis JVM | “版本由 T-001 锁定” | 引用本文 3.1：首选 analysis JDK 17；JDK 8 兜底集见 1.2 |
| §9 Wrapper | “校验 wrapper 来源与 SHA-256” | 引用本文 4.1–4.3：Wrapper 3.3.4、Maven 3.9.11、哈希清单 |
| §10 CI | 仅 `jdk: [8, 11, 17]` | 增加 analysis JDK 17、Boot 3.5/4.0、Windows 冒烟、哈希校验 |
| §14 风险 | “JDK8 工具链老化；需 analysis JVM” | 引用本文 3.1 的硬约束与兜底表 |
| §2 设计原则 5 | “版本锁定” | 明确“锁定”= 候选锁定，CI 绿后才升级为已验证 |

---

## 8. 参考来源

### 8.1 Spring Boot / Maven / Gradle

- [Spring Boot 2.7.18 Getting Started / System Requirements](https://docs.spring.io/spring-boot/docs/2.7.18/reference/html/getting-started.html)
- [Spring Boot 3.5 System Requirements](https://docs.spring.io/spring-boot/3.5/system-requirements.html)
- [Spring Boot 4.0 System Requirements](https://docs.spring.io/spring-boot/4.0/system-requirements.html)
- [Maven 3.9.11 Release Notes](https://maven.apache.org/docs/3.9.11/release-notes.html)
- [Maven 3.9.0 Release Notes（最低 Java 8）](https://maven.apache.org/docs/3.9.0/release-notes.html)
- [Maven Installation](https://maven.apache.org/install.html)
- [Maven Wrapper](https://maven.apache.org/tools/mavenwrapper.html)
- [Maven Wrapper Plugin 3.3.4](https://maven.apache.org/tools/wrapper/maven-wrapper-plugin/)
- [Maven Wrapper Distribution 3.3.4](https://maven.apache.org/tools/wrapper/maven-wrapper-distribution/)
- [Gradle Compatibility Matrix](https://docs.gradle.org/current/userguide/compatibility.html)
- [Gradle 版本服务（含 checksum）](https://services.gradle.org/versions/all)
- [Gradle 8.14.3 Release Notes](https://docs.gradle.org/8.14.3/release-notes.html)

### 8.2 质量工具

- [Spotless plugin-maven CHANGES](https://github.com/diffplug/spotless/blob/main/plugin-maven/CHANGES.md)
- [Spotless lib CHANGES](https://github.com/diffplug/spotless/blob/main/CHANGES.md)
- [Spotless Maven Central 元数据](https://repo1.maven.org/maven2/com/diffplug/spotless/spotless-maven-plugin/maven-metadata.xml)
- [google-java-format](https://github.com/google/google-java-format)
- [google-java-format v1.28.0 POM](https://github.com/google/google-java-format/blob/v1.28.0/pom.xml)
- [google-java-format v1.36.1 POM](https://github.com/google/google-java-format/blob/v1.36.1/pom.xml)
- [Checkstyle 官网（JRE/JDK 表）](https://checkstyle.org/index.html)
- [Checkstyle Maven Central 元数据](https://repo1.maven.org/maven2/com/puppycrawl/tools/checkstyle/maven-metadata.xml)
- [PMD 7.28.0 安装要求](https://docs.pmd-code.org/pmd-doc-7.28.0/pmd_userdocs_installation.html)
- [PMD 7.28.0 Release Notes](https://docs.pmd-code.org/pmd-doc-7.28.0/pmd_release_notes.html)
- [PMD 官网](https://pmd.github.io/)
- [SpotBugs Requirements](https://spotbugs.readthedocs.io/en/stable/introduction.html)
- [SpotBugs 4.8.0 Release](https://github.com/spotbugs/spotbugs/releases/tag/4.8.0)
- [SpotBugs Maven Central 元数据](https://repo1.maven.org/maven2/com/github/spotbugs/spotbugs/maven-metadata.xml)
- [JaCoCo Change History](https://www.jacoco.org/jacoco/trunk/doc/changes.html)
- [JaCoCo 0.8.15 Maven Plugin POM](https://repo1.maven.org/maven2/org/jacoco/jacoco-maven-plugin/0.8.15/jacoco-maven-plugin-0.8.15.pom)

### 8.3 本仓库上游

- `openspec/changes/java-core/design.md`
- `openspec/changes/java-core/proposal.md`
- `openspec/changes/java-core/tasks.md`
- `docs/design/java-support-review.md`
