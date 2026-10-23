# Java 8 + Spring Boot + 管理后台

这是领域中立的管理后台脚手架，包含登录、仪表盘、用户、角色、部门、菜单、只读审计、CSV 导入导出和中英文切换。生成不代表当前项目已完成构建或验证。

## 本地启动

- Node 24 或 Node 22 >=22.12，依赖由 frontend/package-lock.json 锁定。
- npm run setup 安装前端依赖；npm run dev 仅启动前端，打开 http://127.0.0.1:5173，不依赖 Java。
- 后端需要与所选技术栈匹配的 JDK 和 Maven 3.9.x（backend/mvnw 或 mvnw.cmd）；npm run backend 独立启动，npm run dev:all 联合启动。
- 本地演示默认管理员为 admin / admin，只读账号为 viewer / viewer；登录页和生成结果会提示。配置在 .env，旧项目可用 npm run configure 创建，已有自定义文件不覆盖。
- 启动脚本和 Spring 自动读取 .env；环境变量优先。APP_LOCAL_DEMO=true 时允许上述演示密码；部署前关闭演示模式并设置至少 12 个字符、最多 72 个 UTF-8 字节的密码。
- 端口、持久化与故障处理见 docs/operations.md；IDE 只导入 backend/pom.xml，排除 .specgate 参考快照目录。

## 验证与需求流程

node scripts/run.mjs format 执行 Java Spotless 和前端 Prettier；node scripts/run.mjs verify 执行后端测试、JaCoCo、Checkstyle、格式，以及前端构建、Vitest 覆盖率、ESLint 和格式检查。

sg_verify 还会启动隔离服务，检查权限、CSRF、CRUD、CSV 和重启持久化。前后端分别要求行覆盖率 >=80%、分支覆盖率 >=70%；未执行、跳过或失败不能描述为通过。

修改前阅读 docs/style.md；.specgate/examples 中的已提交参考快照不可改写来掩盖漂移。项目基线完成后处于就绪，等待用户提出业务需求，再进行澄清、反述、批判分析和 H1 需求审批；不会自动编造需求或开始开发。

API 见 docs/api.md 和 docs/openapi.yaml，安全边界见 docs/security.md。
