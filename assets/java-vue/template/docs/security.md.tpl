# 脚手架安全边界

已有控制：Spring Security 权限、Session Cookie 登录与退出、会话轮换、CSRF、BCrypt 密码哈希、ADMIN/VIEWER 两种角色、登录失败限流、回环地址监听、统一 JSON 错误、traceId 与有界 CSV 导入导出。

本项目用于本地参考，不包含注册、密码找回、SSO、租户/所有者隔离、恶意文件扫描、分布式会话或生产数据库迁移。数据库和 .env 应受操作系统权限保护。本地演示明确启用 APP_LOCAL_DEMO=true，管理员为 admin / admin、只读账号为 viewer / viewer。环境变量优先，已有自定义配置保留；部署关闭演示模式后强制长密码，不能提交 .env。

## Legacy stack

Java 8 / Spring Boot 2.7 为兼容预设，已结束普通开源支持；需要维护中的厂商 JDK 和单独依赖审查。锁定版本只说明兼容性，不代表不存在漏洞。

## Exact frontend versions

前端精确版本及传递依赖由 frontend/package.json 与 package-lock.json 固定。升级前复核兼容性与安全公告，不得直接替换为 latest。Java 使用 Spotless / Google Java Format AOSP 与 Checkstyle；自动化只覆盖规定子集，不宣称完整手册合规。JaCoCo 和 Vitest 分别检查后端及前端覆盖率，不通过排除业务代码降低标准。
