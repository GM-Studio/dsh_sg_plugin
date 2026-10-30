# SpecGate Core 环境检查

默认环境入口支持只读探测和复用；缺项通过 `sg_env_prepare` 请求可信用户确认确切方案后下载、校验、隔离安装和复验。需要宿主原生安装的组件保持阻塞并报告。历史独立安装脚本不作为默认入口。

## 会话内入口

使用 $sg-codex-env 或调用 sg_env_check。先绑定已有业务项目；从真实 pom.xml、frontend/package.json 和 ProjectProfile 识别技术栈。发现必须有界并优先复用已有安装，不能扫描整盘或因状态查询修改用户环境。

存量项目以 root/模块中的 package.json、Python项目配置、go.mod、pom.xml/Gradle 文件推导所需工具；不要求同时存在Java和前端。新项目支持 `stack=node|react|vue|python|go|java` 和版本约束，`sg_project_create` 通过用户表单记录选择，后续会话仍可读取。Python与Go的缺项安装使用显式 `source=official`，只读check不联网取安装元数据；prepare在批准前展示从官方元数据解析的确切归档与校验。未适配包管理器、版本或平台必须阻断并说明，不静默替换技术栈。

只读检查不会下载安装。缺项未经对应方案批准不得执行，失败不得宣称READY。Core 不替换项目技术栈，不修改全局 PATH、JAVA_HOME、npm 或 Maven 配置。新项目由 `sg_project_create` 收集用户选择并准备环境，不生成业务模板。

## 就绪含义

工具版本探测、Codex 角色执行、可信原生审批、项目基线和业务质量门是分别验证的结果。工具存在不等于业务项目已通过验证，源码或模板生成也不是基线。

sg_status / sg_project_status 只读显示事实；上次环境检查或历史报告不能冒充当前提交通过。建立已有项目基线使用 sg_adopt_preview / sg_adopt_apply，失败保留命令、真实退出码和日志。

## 支持与验收

实现保留 Windows / Linux 的有界发现路径。Core MVP 发布金丝雀要求 JDK 17、Spring Boot 3.5、Vue 3；其他栈不因已有模板而自动获得已验证声明。本轮实际平台、工具版本和未运行检查以 [执行计划验收附录](plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md) 及证据为准。

运行仓库测试时，Windows 应使用独立短 TEMP，避免系统 TEMP 内残留 Git 标记与深层路径触发保护。npm test bootstrap 只清理有所有权标记的测试目录，不能删除其他临时文件。
