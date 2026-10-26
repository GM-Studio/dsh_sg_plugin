# SpecGate Core 环境检查

Core v1 只检测、复用、阻断和报告已有工具，不下载或安装 JDK、Maven、Node、Git。历史自动安装与镜像说明保存在 [可选环境历史文档](optional/environment-codex.zh.md)，非 MVP、非默认、未被当前 Core 发行验证。

## 会话内入口

使用 $sg-codex-env 或调用 sg_env_check。先绑定已有业务项目；从真实 pom.xml、frontend/package.json 和 ProjectProfile 识别技术栈。发现必须有界并优先复用已有安装，不能扫描整盘或因状态查询修改用户环境。

默认不公开 sg_env_prepare。缺项时保持阻塞，由用户或其授权环境维护者处理，之后重新真实探测。Core 不替换项目技术栈，不修改全局 PATH、JAVA_HOME、npm 或 Maven 配置。

## 就绪含义

工具版本探测、Codex 角色执行、可信原生审批、项目基线和业务质量门是分别验证的结果。工具存在不等于业务项目已通过验证，源码或模板生成也不是基线。

sg_status / sg_project_status 只读显示事实；上次环境检查或历史报告不能冒充当前提交通过。建立已有项目基线使用 sg_adopt_preview / sg_adopt_apply，失败保留命令、真实退出码和日志。

## 支持与验收

实现保留 Windows / Linux 的有界发现路径。Core MVP 发布金丝雀要求 JDK 17、Spring Boot 3.5、Vue 3；其他栈不因已有模板而自动获得已验证声明。本轮实际平台、工具版本和未运行检查以 [执行计划验收附录](plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md) 及证据为准。

运行仓库测试时，Windows 应使用独立短 TEMP，避免系统 TEMP 内残留 Git 标记与深层路径触发保护。npm test bootstrap 只清理有所有权标记的测试目录，不能删除其他临时文件。
