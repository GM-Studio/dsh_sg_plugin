# 环境自检与工具链供给（v4.2）

> 自 v4.3 起，sg-init 只做只读检测与缺口提示，下载/安装/镜像配置全部由 `/sg-env install` 负责（见 [sg-init-boundaries.zh.md](sg-init-boundaries.zh.md)）。

本文说明环境自检、缺失依赖安装、镜像配置与 JDK 归档下载链路，以及 Windows / Linux 上“下载归档 → 解压 → 配置环境变量 → 刷新即用”的闭环方式。

## 1. 链路总览

    sg-init（只做 1-4：零网络、无机器副作用）
      1. detect     只读扫描 DSH 运行时、PATH、项目 .specgate/toolchains
      2. plan       纯函数：复用项 + 缺口项（JDK / Maven / Gradle / pnpm / uv）
      3. approve    审批页展示“复用 / 缺口”，初始化不下载
      4. write      契约 + 骨架 + git 基线；缺口写入 init-report 与摘要

    /sg-env install（独立触发：机器能力）
      5. download   国内镜像下载 zip / tar.gz（拒绝 exe/msi），失败按候选源回退
      6. extract    tar 优先，Windows 回退 Expand-Archive；Linux 回退 unzip
      7. verify     java / javac / mvn / gradle 实际执行并校验大版本
      8. persist    .specgate/toolchains/{env.json,env.ps1,env.cmd,env.sh,manifest.json}

    /sg-init 恢复路径（环境补齐后重跑）
      9. requality  只补跑质量并更新报告，不重建代码、不产生新提交

模块位置：

| 阶段 | 文件 |
|---|---|
| 扫描 | `src/v4/environment.js`（含项目内 toolchains 发现） |
| 计划 / 下载 / 解压 / 校验 | `src/v4/provision.js` |
| 镜像与 JDK 源 | `src/v4/mirrors.js` |
| sg-init 编排 | `src/v4/init.js` |
| 自检工具 | `src/v4/env-tool.js`（`sg_env`） |
| 包装器 | `src/v3/env/wrapper.js` |

## 2. JDK 归档源

所有候选都是解压即用的归档，不使用 .exe / .msi 安装程序，也不需要管理员权限。

| JDK | Windows（zip） | Linux（tar.gz） | 说明 |
|---|---|---|---|
| 8 | 阿里云 Dragonwell 8.30.29 | 阿里云 Dragonwell 8.30.29 | Oracle/OpenJDK 8 在华为云只有 exe，故默认用 Alibaba 发行版 |
| 9–26 | 华为云 OpenJDK x.0.2 | 华为云 OpenJDK x.0.2 | 镜像 jdk.java.net 的 GA 构建，稳定可复现 |
| 任意 | SG_JDK_URL 模板 | SG_JDK_URL 模板 | 完全自定义，模板变量见下 |

默认顺序：`auto` = 华为云 → 阿里云 Dragonwell；JDK 8 自动落到 Dragonwell。可用 `SG_JDK_PROVIDER=aliyun|huawei` 显式切换优先源。

URL 模板变量（`SG_JDK_URL`）：`{major}`、`{version}`、`{os}`、`{platform}`、`{arch}`、`{ext}`。示例：

    SG_JDK_URL=https://mirror.example.com/openjdk/{version}/jdk-{os}-{arch}.{ext}

## 3. 配置项

| 变量 | 默认值 | 作用 |
|---|---|---|
| SG_MIRROR | aliyun | npm / pip / maven / gradle 镜像预设（aliyun / tsinghua） |
| SG_JDK_PROVIDER | auto | JDK 源优先级：auto / aliyun / huawei |
| SG_JDK_MIRROR | https://mirrors.huaweicloud.com/openjdk | 华为云 OpenJDK 目录（含 9–26） |
| SG_DRAGONWELL_MIRROR | https://dragonwell.oss-cn-shanghai.aliyuncs.com | 阿里云 Dragonwell 目录（JDK 8） |
| SG_DRAGONWELL_VERSION | 8.30.29 | Dragonwell 8 具体版本 |
| SG_JDK_VERSION | 空 | 覆盖具体版本号（如 21.0.9；华为云目录需存在） |
| SG_JDK_URL | 空 | 自定义归档地址模板，设置后只使用它 |
| SG_MAVEN_MIRROR | https://maven.aliyun.com/repository/public | Maven 仓库与发行包来源 |
| SG_MAVEN_VERSION | 3.9.11 | 项目内 Maven 版本 |
| SG_MAVEN_REPO | 项目内 .specgate/m2repo | Maven 本地仓库；设 home 用 ~/.m2/repository，也可给相对路径 |
| SG_GRADLE_DIST | 腾讯云 gradle-8.14-bin.zip | Gradle 发行包 |
| SG_GRADLE_VERSION | 8.14 | 项目内 Gradle 版本 |

镜像配置文件写入 `.specgate/mirrors/`：npmrc、pip.ini、settings.xml、init.gradle、uv.toml，镜像地址同时写入项目 `.npmrc`（已存在则不覆盖）。

## 4. 环境变量与“刷新即用”

安装完成后生成：

    .specgate/toolchains/env.json        机器可读：JAVA_HOME / MAVEN_HOME / PATH 前缀
    .specgate/toolchains/env.ps1         PowerShell（Windows）
    .specgate/toolchains/env.cmd         cmd（Windows）
    .specgate/toolchains/env.sh          POSIX sh/bash（Linux/macOS）
    .specgate/toolchains/manifest.json   已安装工具清单

Windows（PowerShell）：

    . .\.specgate\toolchains\env.ps1
    java -version
    mvn -v

Windows（cmd）：

    call .specgate\toolchains\env.cmd

Linux / macOS：

    source .specgate/toolchains/env.sh
    java -version
    mvn -v

Maven 的本地仓库默认落在项目内 `.specgate/m2repo`（沙箱/安全软件常把 `~/.m2` 设为不可写），并在 env 脚本中通过 `MAVEN_OPTS=-Dmaven.repo.local=...` 与 `MAVEN_ARGS=-s <settings>` 生效；如需复用用户级缓存，设置 `SG_MAVEN_REPO=home` 后重新 install。

脚本只影响当前 shell，刷新终端后重新执行即可，不修改系统级环境变量。插件自身执行的命令（sg-init 质量阶段、sg_run、任务执行器）通过 `toolchainEnv()` 自动继承同一套 PATH 与 JAVA_HOME，无需手动激活；v3 的 JDK/Maven 解析也会优先读 `.specgate/toolchains`。

## 5. 包装器

脚手架生成的 mvnw / mvnw.cmd 会优先使用项目内 Maven：

    .specgate/toolchains/apache-maven-*/bin/mvn[.cmd]

因此终端里直接执行 `./mvnw`、`mvnw.cmd` 也能闭环，不要求全局 Maven。旧项目里带 “add the full Maven Wrapper” 占位脚本会被 `sg_env install` 自动升级。

## 6. sg_env 用法

| action | 作用 |
|---|---|
| check（默认） | 扫描并输出工具表、缺失项、下载计划、JDK 源；写 `.specgate/env-report.md` |
| install | 下载并解压缺失工具，校验后生成环境变量脚本与 manifest，升级 mvnw 占位脚本 |
| verify | 实际执行 java/javac/mvn/gradle/uv 并校验 JDK 大版本 |
| activate | 输出当前项目的激活命令与变量值 |

示例：`sg_env({ action: "install" })`。

## 7. 常见失败

| 现象 | 处理 |
|---|---|
| JDK_MANUAL_INSTALL_REQUIRED | 版本无国内归档；设置 `SG_JDK_URL`，或换 8/11/17/21 |
| 下载失败 HTTP 404 | 切换 `SG_JDK_PROVIDER`，或用 `SG_JDK_URL` 指向可用归档 |
| 解压失败 | 确认系统有 tar（Windows 10+ 自带）或 PowerShell；Linux 可装 unzip |
| JDK_VERSION_MISMATCH | 指定版本与下载版本不一致；用 `SG_JDK_VERSION` 固定版本 |
| mvn 找不到 | `sg_env({ action: "install" })`，然后刷新 shell 或执行 env 脚本 |
| Could not create local repository | 设 `SG_MAVEN_REPO` 指向可写目录（默认已是项目内） |
| spotless 报 class file version 55 | JDK 8 用 spotless 2.27.0；JDK 17/21 用 3.x（脚手架已按 JDK 选版本） |
| pnpm 报 ERR_PNPM_IGNORED_BUILDS | 保留 `pnpm-workspace.yaml` 的 `allowBuilds/onlyBuiltDependencies: esbuild` |

## 8. 已验证

2026-10-20 实测可用（HTTP 206 + 归档签名）：

    https://mirrors.huaweicloud.com/openjdk/21.0.2/openjdk-21.0.2_windows-x64_bin.zip
    https://mirrors.huaweicloud.com/openjdk/11.0.2/openjdk-11.0.2_linux-x64_bin.tar.gz
    https://dragonwell.oss-cn-shanghai.aliyuncs.com/8.30.29/Alibaba_Dragonwell_Standard_8.30.29_x64_windows.zip
    https://dragonwell.oss-cn-shanghai.aliyuncs.com/8.30.29/Alibaba_Dragonwell_Standard_8.30.29_x64_linux.tar.gz
    https://maven.aliyun.com/repository/public/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip
