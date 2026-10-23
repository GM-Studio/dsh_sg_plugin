# 本地运行与运维

## 启动入口

在项目根目录执行 npm run setup 安装前端依赖。npm run dev 或 npm run frontend 只启动前端，不需要 Java；npm run backend 启动后端；npm run dev:all 联合启动。Ctrl+C 停止服务。

后端使用所选 JDK、Maven 3.9.x 或 backend/mvnw(.cmd)。JAVA_HOME 必须指向含 bin/java 与 bin/javac 的 JDK 目录；可用 MAVEN_CMD 指定现有 Maven 可执行文件。不要为了启动前端配置 Java。

## 本地密码

新项目已有 .env；旧项目先执行 npm run configure 生成本地演示配置，保留已有文件。默认管理员账号和密码均为 admin；只读账号和密码均为 viewer。启动脚本和 Spring 都读取该文件，环境变量优先。IDE 的工作目录可以为项目根或 backend。本地演示通过 APP_LOCAL_DEMO=true 明确启用；部署时设为 false，密码必须至少 12 个字符且最多 72 个 UTF-8 字节。不要使用 .env.example 中的空值或弱密码；不要在 application.properties 写入密码覆盖本地配置。

## 端口与数据

BACKEND_PORT 默认 8080，FRONTEND_PORT 默认 5173。监听 127.0.0.1，Vite strictPort 拒绝占用端口。仅启动前端时，API 请求需要另行启动后端。

DB_URL 默认 jdbc:h2:file:./data/tasks;DB_CLOSE_ON_EXIT=FALSE，DB_USER 默认 sa，DB_PASSWORD 默认为空。后端工作目录为 backend，数据位于 backend/data/tasks.mv.db；IDE 从根目录运行时数据会位于根目录 data。保持工作目录与数据库 URL 一致才能复用数据。H2 控制台关闭；一个数据库文件仅供一个进程访问。ddl-auto=update 仅适用于本地脚手架，生产需迁移方案。

CSV_MAX_BYTES 默认 2097152、CSV_MAX_ROWS 默认 1000；multipart 上限为每文件 10 MiB、请求 11 MiB。SESSION_TIMEOUT 默认 30m；HTTPS 后设置 SESSION_COOKIE_SECURE=true。本地 HTTP 为 false，Cookie 使用 HttpOnly / SameSite=Lax；写入必须携带 X-CSRF-TOKEN，不能为排障关闭 CSRF。

APP_SYS_MAX_PAGE_SIZE 为 20–100，APP_SYS_MAX_BATCH_SIZE 为 1–100，DTO 硬上限为 100。提升上限需要同步评审契约与测试。

npm run build 生成 backend/target 中的 JAR 与 frontend/dist。运行 JAR 时从 backend 启动，前端部署需配置 /api 与 /actuator 代理。Vite preview 不提供生产 API 代理。生产部署另行配置 TLS、代理信任、迁移与监控。

## IDE 排障

IDE 只链接 backend/pom.xml，排除 .specgate、node_modules、target。参考快照中的 pom.xml 仅用于审查，不能作为第二个业务模块导入。前端运行配置的 package.json 应为 frontend/package.json，Node 解释器选择实际的 node.exe。

若 IDE 报 Cannot read field "isNull" because "robj" is null，先核对 idea.log：当堆栈位于 RemoteMessageRouterImpl / JCEFConsoleHtmlPanel 时，属于 JetBrains JCEF 调试控制台故障。可在 IDE Registry 将 js.debugger.webconsole 设置为 false，重启后使用文本调试控制台，并关闭运行配置中自动启动浏览器调试。终端 npm run dev 不依赖该控制台。此设置不修复 IDE 本身的上游缺陷。

运行数据、依赖、构建结果、日志和密码都由 Git 忽略；不要把这些文件当作验收证据或提交内容。
