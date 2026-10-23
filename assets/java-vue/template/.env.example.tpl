# 执行 npm run configure 生成本地演示配置到 .env；启动脚本及 Spring 会读取 .env。
BACKEND_PORT=8080
FRONTEND_PORT=5173
DB_URL=jdbc:h2:file:./data/tasks;DB_CLOSE_ON_EXIT=FALSE
DB_USER=sa
DB_PASSWORD=
# MAVEN_CMD may be an absolute Maven executable path.
# JAVA_HOME 应指向所选技术栈对应的 JDK；仅前端 npm run dev 不需要 Java。
# Required: provide private passwords (12+ characters, <=72 UTF-8 bytes). No defaults.
APP_LOCAL_DEMO=true
APP_ADMIN_PASSWORD=admin
APP_VIEWER_PASSWORD=viewer
SESSION_COOKIE_SECURE=false
