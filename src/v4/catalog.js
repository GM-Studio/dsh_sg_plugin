export const CATALOG_VERSION = '4.2.0';

export const BACKENDS = ['node', 'python', 'java', 'none'];
export const FRONTENDS = ['vue', 'react', 'none'];

export const JAVA_JDKS = ['8', '11', '13', '17', '21'];
export const JAVA_BUILD_TOOLS = ['maven', 'gradle'];
export const JAVA_BOOT_VERSIONS = ['2.7.x', '3.x', '4.x'];
export const JAVA_MATRIX = {
  8: ['2.7.x'],
  11: ['2.7.x'],
  13: ['2.7.x'],
  17: ['2.7.x', '3.x', '4.x'],
  21: ['2.7.x', '3.x', '4.x'],
};

export const PYTHON_VERSIONS = ['3.13', '3.12', '3.11', '3.10', '2.7'];
export const PYTHON_FRAMEWORKS = ['fastapi', 'flask', 'django'];
export const PYTHON_PACKAGE_MANAGERS = ['pip', 'poetry', 'uv'];

export const NODE_VERSIONS = ['24', '22', '20'];
export const NODE_PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn'];
export const NODE_LANGUAGES = ['typescript', 'javascript'];
export const NODE_FRAMEWORKS = ['express', 'fastify', 'nestjs'];

export const FRONTEND_BUILD_TOOLS = ['vite'];
export const FRONTEND_LANGUAGES = ['typescript', 'javascript'];

function dep(id, label, options = {}) {
  return {
    id,
    label,
    category: options.category || 'runtime',
    required: Boolean(options.required),
    scope: options.scope || 'optional',
    version: options.version || '',
    install: options.install || '',
    artifact: options.artifact || '',
    name: options.name || '',
    kind: options.kind || 'package',
    description: options.description || '',
    group: options.group || null,
    frameworks: options.frameworks || null,
    py2: Boolean(options.py2),
  };
}

const JAVA_REQUIRED = [
  dep('web', 'Spring Web', {
    artifact: 'org.springframework.boot:spring-boot-starter-web',
    required: true,
    scope: 'compile',
    version: 'managed',
    category: 'runtime',
    description: 'REST 接口与内嵌 Tomcat',
  }),
  dep('validation', 'Bean Validation', {
    artifact: 'org.springframework.boot:spring-boot-starter-validation',
    required: true,
    scope: 'compile',
    version: 'managed',
    category: 'validation',
    description: '请求参数校验',
  }),
  dep('actuator', 'Actuator', {
    artifact: 'org.springframework.boot:spring-boot-starter-actuator',
    required: true,
    scope: 'compile',
    version: 'managed',
    category: 'observability',
    description: '健康检查与运行指标',
  }),
  dep('test', 'Spring Boot Test', {
    artifact: 'org.springframework.boot:spring-boot-starter-test',
    required: true,
    scope: 'test',
    version: 'managed',
    category: 'test',
    description: 'JUnit 5 + MockMvc',
  }),
  dep('spotless', 'Spotless', {
    required: true,
    kind: 'plugin',
    category: 'format',
    description: 'Java 格式化',
  }),
  dep('checkstyle', 'Checkstyle', {
    required: true,
    kind: 'plugin',
    category: 'lint',
    description: 'Java 静态检查',
  }),
  dep('spotbugs', 'SpotBugs', {
    required: true,
    kind: 'plugin',
    category: 'lint',
    description: '字节码缺陷检查',
  }),
  dep('jacoco', 'JaCoCo', {
    required: true,
    kind: 'plugin',
    category: 'test',
    description: '测试覆盖率',
  }),
];

const JAVA_OPTIONAL = [
  dep('jpa', 'Spring Data JPA', {
    artifact: 'org.springframework.boot:spring-boot-starter-data-jpa',
    scope: 'compile',
    version: 'managed',
    category: 'persistence',
    group: 'orm',
    description: 'JPA 持久化',
  }),
  dep('h2', 'H2 Database', {
    artifact: 'com.h2database:h2',
    scope: 'runtime',
    version: 'managed',
    category: 'persistence',
    group: 'db',
    description: '内存/文件数据库',
  }),
  dep('postgresql', 'PostgreSQL Driver', {
    artifact: 'org.postgresql:postgresql',
    scope: 'runtime',
    version: 'managed',
    category: 'persistence',
    group: 'db',
    description: 'PostgreSQL 驱动',
  }),
  dep('mysql', 'MySQL Driver', {
    artifact: 'com.mysql:mysql-connector-j',
    scope: 'runtime',
    version: 'managed',
    category: 'persistence',
    group: 'db',
    description: 'MySQL 驱动',
  }),
  dep('flyway', 'Flyway', {
    artifact: 'org.flywaydb:flyway-core',
    scope: 'compile',
    version: 'managed',
    category: 'persistence',
    group: 'migration',
    description: '数据库版本迁移',
  }),
  dep('liquibase', 'Liquibase', {
    artifact: 'org.liquibase:liquibase-core',
    scope: 'compile',
    version: 'managed',
    category: 'persistence',
    group: 'migration',
    description: '数据库版本迁移',
  }),
  dep('lombok', 'Lombok', {
    artifact: 'org.projectlombok:lombok',
    scope: 'provided',
    version: 'managed',
    category: 'productivity',
    description: '减少样板代码',
  }),
  dep('mapstruct', 'MapStruct', {
    artifact: 'org.mapstruct:mapstruct',
    scope: 'compile',
    version: 'managed',
    category: 'productivity',
    description: '对象映射',
  }),
  dep('security', 'Spring Security', {
    artifact: 'org.springframework.boot:spring-boot-starter-security',
    scope: 'compile',
    version: 'managed',
    category: 'security',
    description: '认证与授权基础',
  }),
  dep('springdoc', 'springdoc-openapi', {
    artifact: 'org.springdoc:springdoc-openapi-starter-webmvc-ui',
    scope: 'compile',
    version: 'managed',
    category: 'docs',
    description: 'OpenAPI/Swagger UI',
  }),
  dep('redis', 'Spring Data Redis', {
    artifact: 'org.springframework.boot:spring-boot-starter-data-redis',
    scope: 'compile',
    version: 'managed',
    category: 'integration',
    group: 'cache',
    description: 'Redis 客户端',
  }),
  dep('cache', 'Spring Cache', {
    artifact: 'org.springframework.boot:spring-boot-starter-cache',
    scope: 'compile',
    version: 'managed',
    category: 'integration',
    group: 'cache',
    description: '缓存抽象',
  }),
  dep('kafka', 'Spring for Kafka', {
    artifact: 'org.springframework.kafka:spring-kafka',
    scope: 'compile',
    version: 'managed',
    category: 'integration',
    description: 'Kafka 消息',
  }),
  dep('mail', 'Spring Mail', {
    artifact: 'org.springframework.boot:spring-boot-starter-mail',
    scope: 'compile',
    version: 'managed',
    category: 'integration',
    description: '邮件发送',
  }),
  dep('websocket', 'Spring WebSocket', {
    artifact: 'org.springframework.boot:spring-boot-starter-websocket',
    scope: 'compile',
    version: 'managed',
    category: 'integration',
    description: 'WebSocket 支持',
  }),
  dep('testcontainers', 'Testcontainers', {
    artifact: 'org.testcontainers:junit-jupiter',
    scope: 'test',
    version: 'managed',
    category: 'test',
    description: '容器化集成测试',
  }),
  dep('docker', 'Dockerfile', { kind: 'file', category: 'deploy', description: '容器化部署示例' }),
];

const PYTHON_REQUIRED = {
  fastapi: [
    ['fastapi', 'FastAPI', 'fastapi>=0.115,<1', 'runtime', 'Web 框架'],
    ['uvicorn', 'Uvicorn', 'uvicorn[standard]>=0.30,<1', 'runtime', 'ASGI 服务器'],
    ['pydantic', 'Pydantic', 'pydantic>=2.9,<3', 'runtime', '数据校验'],
    ['pydantic-settings', 'Pydantic Settings', 'pydantic-settings>=2.5,<3', 'runtime', '配置管理'],
    ['httpx', 'HTTPX', 'httpx>=0.27,<1', 'test', '测试 HTTP 客户端'],
    ['pytest', 'pytest', 'pytest>=8,<9', 'test', '测试框架'],
    ['pytest-cov', 'pytest-cov', 'pytest-cov>=5,<7', 'test', '覆盖率'],
    ['ruff', 'Ruff', 'ruff>=0.7,<1', 'quality', '格式化与静态检查'],
  ],
  flask: [
    ['flask', 'Flask', 'flask>=3.0,<4', 'runtime', 'Web 框架'],
    ['dotenv', 'python-dotenv', 'python-dotenv>=1.0,<2', 'runtime', '环境变量'],
    ['pytest', 'pytest', 'pytest>=8,<9', 'test', '测试框架'],
    ['pytest-cov', 'pytest-cov', 'pytest-cov>=5,<7', 'test', '覆盖率'],
    ['ruff', 'Ruff', 'ruff>=0.7,<1', 'quality', '格式化与静态检查'],
  ],
  django: [
    ['django', 'Django', 'django>=5.0,<6', 'runtime', 'Web 框架'],
    ['drf', 'Django REST Framework', 'djangorestframework>=3.15,<4', 'runtime', 'REST API'],
    ['pytest', 'pytest', 'pytest>=8,<9', 'test', '测试框架'],
    ['pytest-django', 'pytest-django', 'pytest-django>=4.9,<5', 'test', 'Django 测试集成'],
    ['ruff', 'Ruff', 'ruff>=0.7,<1', 'quality', '格式化与静态检查'],
  ],
};

const PYTHON_OPTIONAL = [
  dep('sqlalchemy', 'SQLAlchemy', {
    category: 'persistence',
    version: 'SQLAlchemy>=2.0,<3',
    install: 'SQLAlchemy>=2.0,<3',
    group: 'orm',
    frameworks: ['fastapi', 'flask'],
    description: 'ORM',
  }),
  dep('alembic', 'Alembic', {
    category: 'persistence',
    version: 'alembic>=1.13,<2',
    install: 'alembic>=1.13,<2',
    group: 'migration',
    frameworks: ['fastapi', 'flask'],
    description: '数据库迁移',
  }),
  dep('psycopg', 'psycopg', {
    category: 'persistence',
    version: 'psycopg[binary]>=3.2,<4',
    install: 'psycopg[binary]>=3.2,<4',
    group: 'db',
    frameworks: ['fastapi', 'flask', 'django'],
    description: 'PostgreSQL 驱动',
  }),
  dep('pymysql', 'PyMySQL', {
    category: 'persistence',
    version: 'PyMySQL>=1.1,<2',
    install: 'PyMySQL>=1.1,<2',
    group: 'db',
    frameworks: ['django'],
    description: 'MySQL 驱动',
  }),
  dep('redis', 'redis-py', {
    category: 'integration',
    version: 'redis>=5,<7',
    install: 'redis>=5,<7',
    group: 'cache',
    frameworks: ['fastapi', 'flask', 'django'],
    description: 'Redis 客户端',
  }),
  dep('celery', 'Celery', {
    category: 'integration',
    version: 'celery>=5.4,<6',
    install: 'celery>=5.4,<6',
    group: 'queue',
    frameworks: ['fastapi', 'flask', 'django'],
    description: '任务队列',
  }),
  dep('passlib', 'passlib', {
    category: 'security',
    version: 'passlib[bcrypt]>=1.7,<2',
    install: 'passlib[bcrypt]>=1.7,<2',
    frameworks: ['fastapi'],
    description: '密码哈希',
  }),
  dep('python-jose', 'python-jose', {
    category: 'security',
    version: 'python-jose[cryptography]>=3.3,<4',
    install: 'python-jose[cryptography]>=3.3,<4',
    frameworks: ['fastapi'],
    description: 'JWT',
  }),
  dep('flask-cors', 'Flask-CORS', {
    category: 'security',
    version: 'Flask-Cors>=5,<7',
    install: 'Flask-Cors>=5,<7',
    group: 'cors',
    frameworks: ['flask'],
    description: '跨域',
  }),
  dep('cors', 'django-cors-headers', {
    category: 'security',
    version: 'django-cors-headers>=4.6,<5',
    install: 'django-cors-headers>=4.6,<5',
    group: 'cors',
    frameworks: ['django'],
    description: '跨域',
  }),
  dep('mypy', 'mypy', {
    category: 'quality',
    version: 'mypy>=1.13,<2',
    install: 'mypy>=1.13,<2',
    frameworks: ['fastapi', 'flask', 'django'],
    description: '类型检查',
  }),
  dep('pre-commit', 'pre-commit', {
    category: 'quality',
    version: 'pre-commit>=4,<5',
    install: 'pre-commit>=4,<5',
    frameworks: ['fastapi', 'flask', 'django'],
    description: '提交钩子',
  }),
  dep('docker', 'Dockerfile', {
    category: 'deploy',
    kind: 'file',
    frameworks: ['fastapi', 'flask', 'django'],
    description: '容器化示例',
  }),
];

const NODE_REQUIRED = {
  express: [
    ['express', '^4.21.2', 'dependencies', 'Web 框架'],
    ['zod', '^3.24.1', 'dependencies', '数据校验'],
    ['cors', '^2.8.5', 'dependencies', '跨域'],
    ['dotenv', '^16.4.7', 'dependencies', '环境变量'],
    ['pino', '^9.6.0', 'dependencies', '日志'],
    ['vitest', '^2.1.8', 'devDependencies', '测试框架'],
    ['supertest', '^7.0.0', 'devDependencies', 'HTTP 测试'],
    ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
    ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ['typescript', '^5.7.2', 'devDependencies', 'TypeScript'],
    ['tsx', '^4.19.2', 'devDependencies', 'TS 运行器'],
    ['@types/node', '^22.10.5', 'devDependencies', 'Node 类型'],
    ['@types/express', '^5.0.0', 'devDependencies', 'Express 类型'],
    ['@types/cors', '^2.8.17', 'devDependencies', 'CORS 类型'],
    ['@types/supertest', '^6.0.2', 'devDependencies', 'Supertest 类型'],
    ['typescript-eslint', '^8.18.0', 'devDependencies', 'TypeScript ESLint'],
  ],
  fastify: [
    ['fastify', '^5.2.1', 'dependencies', 'Web 框架'],
    ['@fastify/cors', '^10.0.2', 'dependencies', '跨域'],
    ['@fastify/sensible', '^6.0.2', 'dependencies', '常用能力'],
    ['zod', '^3.24.1', 'dependencies', '数据校验'],
    ['vitest', '^2.1.8', 'devDependencies', '测试框架'],
    ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
    ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ['typescript', '^5.7.2', 'devDependencies', 'TypeScript'],
    ['tsx', '^4.19.2', 'devDependencies', 'TS 运行器'],
    ['@types/node', '^22.10.5', 'devDependencies', 'Node 类型'],
    ['@types/express', '^5.0.0', 'devDependencies', 'Express 类型'],
    ['@types/supertest', '^6.0.2', 'devDependencies', 'Supertest 类型'],
    ['typescript-eslint', '^8.18.0', 'devDependencies', 'TypeScript ESLint'],
  ],
  nestjs: [
    ['@nestjs/core', '^11.0.1', 'dependencies', 'NestJS 核心'],
    ['@nestjs/common', '^11.0.1', 'dependencies', 'NestJS 公共模块'],
    ['@nestjs/platform-express', '^11.0.1', 'dependencies', 'Express 适配'],
    ['reflect-metadata', '^0.2.2', 'dependencies', '装饰器元数据'],
    ['rxjs', '^7.8.1', 'dependencies', '响应式流'],
    ['jest', '^29.7.0', 'devDependencies', '测试框架'],
    ['ts-jest', '^29.2.5', 'devDependencies', 'TypeScript 测试'],
    ['supertest', '^7.0.0', 'devDependencies', 'HTTP 测试'],
    ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
    ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ['typescript', '^5.7.2', 'devDependencies', 'TypeScript'],
    ['@nestjs/cli', '^11.0.0', 'devDependencies', 'NestJS CLI'],
    ['@nestjs/schematics', '^11.0.0', 'devDependencies', 'NestJS 脚手架'],
    ['@nestjs/testing', '^11.0.1', 'devDependencies', 'NestJS 测试'],
    ['@types/jest', '^29.5.14', 'devDependencies', 'Jest 类型'],
    ['@types/node', '^22.10.5', 'devDependencies', 'Node 类型'],
    ['@types/express', '^5.0.0', 'devDependencies', 'Express 类型'],
    ['@types/supertest', '^6.0.2', 'devDependencies', 'Supertest 类型'],
    ['typescript-eslint', '^8.18.0', 'devDependencies', 'TypeScript ESLint'],
  ],
};

const NODE_OPTIONAL = [
  dep('prisma', 'Prisma', {
    name: 'prisma',
    version: '^6.2.1',
    install: 'prisma@^6.2.1',
    category: 'persistence',
    group: 'orm',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: 'ORM',
  }),
  dep('drizzle-orm', 'Drizzle ORM', {
    name: 'drizzle-orm',
    version: '^0.38.3',
    install: 'drizzle-orm@^0.38.3',
    category: 'persistence',
    group: 'orm',
    frameworks: ['express', 'fastify'],
    description: 'ORM',
  }),
  dep('typeorm', 'TypeORM', {
    name: 'typeorm',
    version: '^0.3.20',
    install: 'typeorm@^0.3.20',
    category: 'persistence',
    group: 'orm',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: 'ORM',
  }),
  dep('mongoose', 'Mongoose', {
    name: 'mongoose',
    version: '^8.9.3',
    install: 'mongoose@^8.9.3',
    category: 'persistence',
    group: 'orm',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: 'MongoDB ODM',
  }),
  dep('pg', 'pg', {
    name: 'pg',
    version: '^8.13.1',
    install: 'pg@^8.13.1',
    category: 'persistence',
    group: 'db',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: 'PostgreSQL 驱动',
  }),
  dep('mysql2', 'mysql2', {
    name: 'mysql2',
    version: '^3.12.0',
    install: 'mysql2@^3.12.0',
    category: 'persistence',
    group: 'db',
    frameworks: ['express', 'fastify'],
    description: 'MySQL 驱动',
  }),
  dep('redis', 'ioredis', {
    name: 'ioredis',
    version: '^5.4.2',
    install: 'ioredis@^5.4.2',
    category: 'integration',
    group: 'cache',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: 'Redis 客户端',
  }),
  dep('bullmq', 'BullMQ', {
    name: 'bullmq',
    version: '^5.34.6',
    install: 'bullmq@^5.34.6',
    category: 'integration',
    group: 'queue',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: '任务队列',
  }),
  dep('helmet', 'Helmet', {
    name: 'helmet',
    version: '^8.0.0',
    install: 'helmet@^8.0.0',
    category: 'security',
    group: 'security',
    frameworks: ['express', 'fastify'],
    description: '安全响应头',
  }),
  dep('swagger-ui-express', 'Swagger UI', {
    name: 'swagger-ui-express',
    version: '^5.0.1',
    install: 'swagger-ui-express@^5.0.1',
    category: 'docs',
    group: 'docs',
    frameworks: ['express'],
    description: 'OpenAPI UI',
  }),
  dep('@fastify/swagger', 'Fastify Swagger', {
    name: '@fastify/swagger',
    version: '^9.4.2',
    install: '@fastify/swagger@^9.4.2',
    category: 'docs',
    group: 'docs',
    frameworks: ['fastify'],
    description: 'OpenAPI',
  }),
  dep('@nestjs/swagger', '@nestjs/swagger', {
    name: '@nestjs/swagger',
    version: '^11.0.3',
    install: '@nestjs/swagger@^11.0.3',
    category: 'docs',
    group: 'docs',
    frameworks: ['nestjs'],
    description: 'OpenAPI',
  }),
  dep('pino', 'pino', {
    name: 'pino',
    version: '^9.6.0',
    install: 'pino@^9.6.0',
    category: 'observability',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: '日志',
  }),
  dep('prom-client', 'prom-client', {
    name: 'prom-client',
    version: '^15.1.3',
    install: 'prom-client@^15.1.3',
    category: 'observability',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: 'Prometheus 指标',
  }),
  dep('docker', 'Dockerfile', {
    category: 'deploy',
    kind: 'file',
    frameworks: ['express', 'fastify', 'nestjs'],
    description: '容器化示例',
  }),
];

const FRONTEND_REQUIRED = {
  vue: {
    typescript: [
      ['vue', '^3.5.13', 'dependencies', 'Vue 运行时'],
      ['vite', '^5.4.11', 'devDependencies', '构建工具'],
      ['@vitejs/plugin-vue', '^5.2.1', 'devDependencies', 'Vue 插件'],
      ['typescript', '^5.7.2', 'devDependencies', 'TypeScript'],
      ['vue-tsc', '^2.2.0', 'devDependencies', 'Vue 类型检查'],
      ['vitest', '^2.1.8', 'devDependencies', '测试框架'],
      ['@vue/test-utils', '^2.4.6', 'devDependencies', '组件测试'],
      ['jsdom', '^25.0.1', 'devDependencies', 'DOM 环境'],
      ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
      ['eslint-plugin-vue', '^9.32.0', 'devDependencies', 'Vue ESLint'],
      ['typescript-eslint', '^8.18.0', 'devDependencies', 'TypeScript ESLint'],
      ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ],
    javascript: [
      ['vue', '^3.5.13', 'dependencies', 'Vue 运行时'],
      ['vite', '^5.4.11', 'devDependencies', '构建工具'],
      ['@vitejs/plugin-vue', '^5.2.1', 'devDependencies', 'Vue 插件'],
      ['vitest', '^2.1.8', 'devDependencies', '测试框架'],
      ['@vue/test-utils', '^2.4.6', 'devDependencies', '组件测试'],
      ['jsdom', '^25.0.1', 'devDependencies', 'DOM 环境'],
      ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
      ['eslint-plugin-vue', '^9.32.0', 'devDependencies', 'Vue ESLint'],
      ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ],
  },
  react: {
    typescript: [
      ['react', '^18.3.1', 'dependencies', 'React 运行时'],
      ['react-dom', '^18.3.1', 'dependencies', 'React DOM'],
      ['vite', '^5.4.11', 'devDependencies', '构建工具'],
      ['@vitejs/plugin-react', '^4.3.4', 'devDependencies', 'React 插件'],
      ['typescript', '^5.7.2', 'devDependencies', 'TypeScript'],
      ['@types/react', '^18.3.18', 'devDependencies', 'React 类型'],
      ['@types/react-dom', '^18.3.5', 'devDependencies', 'React DOM 类型'],
      ['vitest', '^2.1.8', 'devDependencies', '测试框架'],
      ['@testing-library/react', '^16.1.0', 'devDependencies', '组件测试'],
      ['jsdom', '^25.0.1', 'devDependencies', 'DOM 环境'],
      ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
      ['typescript-eslint', '^8.18.0', 'devDependencies', 'TypeScript ESLint'],
      ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ],
    javascript: [
      ['react', '^18.3.1', 'dependencies', 'React 运行时'],
      ['react-dom', '^18.3.1', 'dependencies', 'React DOM'],
      ['vite', '^5.4.11', 'devDependencies', '构建工具'],
      ['@vitejs/plugin-react', '^4.3.4', 'devDependencies', 'React 插件'],
      ['vitest', '^2.1.8', 'devDependencies', '测试框架'],
      ['@testing-library/react', '^16.1.0', 'devDependencies', '组件测试'],
      ['jsdom', '^25.0.1', 'devDependencies', 'DOM 环境'],
      ['eslint', '^9.17.0', 'devDependencies', '静态检查'],
      ['prettier', '^3.4.2', 'devDependencies', '格式化'],
    ],
  },
};

const FRONTEND_OPTIONAL = [
  dep('vue-router', 'Vue Router', {
    name: 'vue-router',
    version: '^4.5.0',
    install: 'vue-router@^4.5.0',
    category: 'routing',
    group: 'router',
    frameworks: ['vue'],
    description: '路由',
  }),
  dep('pinia', 'Pinia', {
    name: 'pinia',
    version: '^2.3.0',
    install: 'pinia@^2.3.0',
    category: 'state',
    group: 'state',
    frameworks: ['vue'],
    description: '状态管理',
  }),
  dep('element-plus', 'Element Plus', {
    name: 'element-plus',
    version: '^2.9.1',
    install: 'element-plus@^2.9.1',
    category: 'ui',
    group: 'ui',
    frameworks: ['vue'],
    description: 'UI 组件库',
  }),
  dep('naive-ui', 'Naive UI', {
    name: 'naive-ui',
    version: '^2.40.3',
    install: 'naive-ui@^2.40.3',
    category: 'ui',
    group: 'ui',
    frameworks: ['vue'],
    description: 'UI 组件库',
  }),
  dep('react-router-dom', 'React Router', {
    name: 'react-router-dom',
    version: '^7.1.1',
    install: 'react-router-dom@^7.1.1',
    category: 'routing',
    group: 'router',
    frameworks: ['react'],
    description: '路由',
  }),
  dep('zustand', 'Zustand', {
    name: 'zustand',
    version: '^5.0.2',
    install: 'zustand@^5.0.2',
    category: 'state',
    group: 'state',
    frameworks: ['react'],
    description: '状态管理',
  }),
  dep('@reduxjs/toolkit', 'Redux Toolkit', {
    name: '@reduxjs/toolkit',
    version: '^2.5.0',
    install: '@reduxjs/toolkit@^2.5.0',
    category: 'state',
    group: 'state',
    frameworks: ['react'],
    description: '状态管理',
  }),
  dep('antd', 'Ant Design', {
    name: 'antd',
    version: '^5.22.7',
    install: 'antd@^5.22.7',
    category: 'ui',
    group: 'ui',
    frameworks: ['react'],
    description: 'UI 组件库',
  }),
  dep('@mui/material', 'MUI', {
    name: '@mui/material',
    version: '^6.3.1',
    install: '@mui/material@^6.3.1',
    category: 'ui',
    group: 'ui',
    frameworks: ['react'],
    description: 'UI 组件库',
  }),
  dep('tailwindcss', 'Tailwind CSS', {
    name: 'tailwindcss',
    version: '^3.4.17',
    install: 'tailwindcss@^3.4.17',
    category: 'styling',
    group: 'styling',
    frameworks: ['vue', 'react'],
    description: '原子化 CSS',
  }),
  dep('sass', 'Sass', {
    name: 'sass',
    version: '^1.83.1',
    install: 'sass@^1.83.1',
    category: 'styling',
    group: 'styling',
    frameworks: ['vue', 'react'],
    description: 'CSS 预处理器',
  }),
  dep('axios', 'Axios', {
    name: 'axios',
    version: '^1.7.9',
    install: 'axios@^1.7.9',
    category: 'http',
    group: 'http',
    frameworks: ['vue', 'react'],
    description: 'HTTP 客户端',
  }),
  dep('msw', 'MSW', {
    name: 'msw',
    version: '^2.7.0',
    install: 'msw@^2.7.0',
    category: 'test',
    frameworks: ['vue', 'react'],
    description: 'API mock',
  }),
  dep('playwright', '@playwright/test', {
    name: '@playwright/test',
    version: '^1.49.1',
    install: '@playwright/test@^1.49.1',
    category: 'test',
    frameworks: ['vue', 'react'],
    description: '端到端测试',
  }),
];

const PRESETS = {
  java: {
    minimal: [],
    recommended: ['lombok', 'springdoc'],
    full: [
      'jpa',
      'h2',
      'flyway',
      'lombok',
      'mapstruct',
      'security',
      'springdoc',
      'redis',
      'kafka',
      'mail',
      'websocket',
      'testcontainers',
      'docker',
    ],
  },
  python: {
    fastapi: {
      minimal: [],
      recommended: ['sqlalchemy', 'alembic', 'mypy', 'pre-commit'],
      full: [
        'sqlalchemy',
        'alembic',
        'psycopg',
        'redis',
        'celery',
        'passlib',
        'python-jose',
        'mypy',
        'pre-commit',
        'docker',
      ],
    },
    flask: {
      minimal: [],
      recommended: ['sqlalchemy', 'alembic', 'flask-cors', 'mypy', 'pre-commit'],
      full: [
        'sqlalchemy',
        'alembic',
        'psycopg',
        'redis',
        'celery',
        'flask-cors',
        'mypy',
        'pre-commit',
        'docker',
      ],
    },
    django: {
      minimal: [],
      recommended: ['cors', 'mypy', 'pre-commit'],
      full: ['psycopg', 'pymysql', 'redis', 'celery', 'cors', 'mypy', 'pre-commit', 'docker'],
    },
  },
  node: {
    express: {
      minimal: [],
      recommended: ['helmet', 'pino', 'swagger-ui-express', 'prom-client'],
      full: [
        'prisma',
        'pg',
        'redis',
        'bullmq',
        'helmet',
        'swagger-ui-express',
        'pino',
        'prom-client',
        'docker',
      ],
    },
    fastify: {
      minimal: [],
      recommended: ['helmet', 'pino', '@fastify/swagger', 'prom-client'],
      full: [
        'prisma',
        'pg',
        'redis',
        'bullmq',
        'helmet',
        '@fastify/swagger',
        'pino',
        'prom-client',
        'docker',
      ],
    },
    nestjs: {
      minimal: [],
      recommended: ['@nestjs/swagger', 'pino', 'prom-client'],
      full: ['prisma', 'pg', 'redis', 'bullmq', '@nestjs/swagger', 'pino', 'prom-client', 'docker'],
    },
  },
  vue: {
    minimal: [],
    recommended: ['vue-router', 'pinia', 'axios', 'tailwindcss'],
    full: ['vue-router', 'pinia', 'element-plus', 'tailwindcss', 'axios', 'msw', 'playwright'],
  },
  react: {
    minimal: [],
    recommended: ['react-router-dom', 'zustand', 'axios', 'tailwindcss'],
    full: ['react-router-dom', 'zustand', 'antd', 'tailwindcss', 'axios', 'msw', 'playwright'],
  },
};

export function javaBootOptions(jdk) {
  return JAVA_MATRIX[String(jdk)] || [];
}

export function pythonFrameworks(version) {
  return String(version) === '2.7' ? ['flask', 'django'] : [...PYTHON_FRAMEWORKS];
}

export function nodeLanguages(framework) {
  return String(framework) === 'nestjs' ? ['typescript'] : [...NODE_LANGUAGES];
}

export function pythonPackageManagers(version) {
  return String(version) === '2.7' ? ['pip'] : [...PYTHON_PACKAGE_MANAGERS];
}

export function defaultSideDetails(stack, framework = null) {
  if (stack === 'java') {
    return {
      stack: 'java',
      framework: 'spring-boot',
      runtimeVersion: '8',
      jdk: '8',
      buildTool: 'maven',
      bootVersion: '2.7.x',
      language: 'java',
      packageManager: 'maven',
    };
  }
  if (stack === 'python') {
    const fw = framework && PYTHON_FRAMEWORKS.includes(framework) ? framework : 'fastapi';
    return {
      stack: 'python',
      framework: fw,
      runtimeVersion: '3.12',
      pythonVersion: '3.12',
      packageManager: 'pip',
      language: 'python',
    };
  }
  if (stack === 'node') {
    const fw = framework && NODE_FRAMEWORKS.includes(framework) ? framework : 'express';
    return {
      stack: 'node',
      framework: fw,
      runtimeVersion: '22',
      nodeVersion: '22',
      packageManager: 'pnpm',
      language: 'typescript',
      jsLanguage: 'typescript',
    };
  }
  if (stack === 'vue' || stack === 'react') {
    return {
      stack,
      framework: stack,
      runtimeVersion: null,
      buildTool: 'vite',
      packageManager: 'npm',
      language: 'typescript',
    };
  }
  return { stack, framework: null, runtimeVersion: null, language: null };
}

export function validateSide(side) {
  if (side.stack === 'java') {
    if (!JAVA_JDKS.includes(String(side.jdk)))
      return { ok: false, code: 'E_STACK_INVALID', message: 'JDK 只能是 ' + JAVA_JDKS.join(' / ') };
    if (!JAVA_BUILD_TOOLS.includes(String(side.buildTool)))
      return { ok: false, code: 'E_STACK_INVALID', message: '构建工具只能是 maven / gradle' };
    const allowed = javaBootOptions(side.jdk);
    if (!allowed.includes(String(side.bootVersion))) {
      return {
        ok: false,
        code: 'E_STACK_INVALID',
        message:
          'JDK ' +
          side.jdk +
          ' 不能搭配 Spring Boot ' +
          side.bootVersion +
          '；可选：' +
          allowed.join(' / '),
      };
    }
    return { ok: true };
  }
  if (side.stack === 'python') {
    if (!PYTHON_VERSIONS.includes(String(side.pythonVersion || side.runtimeVersion)))
      return { ok: false, code: 'E_STACK_INVALID', message: '不支持的 Python 版本' };
    const version = String(side.pythonVersion || side.runtimeVersion);
    const frameworks = pythonFrameworks(version);
    if (!frameworks.includes(String(side.framework))) {
      return {
        ok: false,
        code: 'E_STACK_INVALID',
        message:
          'Python ' +
          version +
          ' 不支持框架 ' +
          side.framework +
          '；可选：' +
          frameworks.join(' / '),
      };
    }
    if (!pythonPackageManagers(version).includes(String(side.packageManager || 'pip'))) {
      return {
        ok: false,
        code: 'E_STACK_INVALID',
        message: 'Python ' + version + ' 只支持 pip + requirements.txt',
      };
    }
    return { ok: true };
  }
  if (side.stack === 'node') {
    if (!NODE_VERSIONS.includes(String(side.nodeVersion || side.runtimeVersion)))
      return { ok: false, code: 'E_STACK_INVALID', message: '不支持的 Node 版本' };
    if (!NODE_PACKAGE_MANAGERS.includes(String(side.packageManager)))
      return { ok: false, code: 'E_STACK_INVALID', message: '包管理器只能是 pnpm / npm / yarn' };
    if (!NODE_FRAMEWORKS.includes(String(side.framework)))
      return {
        ok: false,
        code: 'E_STACK_INVALID',
        message: 'Node 框架只能是 express / fastify / nestjs',
      };
    const languages = nodeLanguages(side.framework);
    if (!languages.includes(String(side.language))) {
      return {
        ok: false,
        code: 'E_STACK_INVALID',
        message: side.framework + ' 只支持 ' + languages.join(' / '),
      };
    }
    return { ok: true };
  }
  if (side.stack === 'vue' || side.stack === 'react') {
    if (!FRONTEND_LANGUAGES.includes(String(side.language)))
      return {
        ok: false,
        code: 'E_STACK_INVALID',
        message: '前端语言只能是 typescript / javascript',
      };
    if (side.buildTool && side.buildTool !== 'vite')
      return { ok: false, code: 'E_STACK_INVALID', message: '本期前端构建工具只支持 Vite' };
    return { ok: true };
  }
  return { ok: false, code: 'E_STACK_INVALID', message: '未知技术栈：' + side.stack };
}

export function javaCatalog() {
  return {
    stack: 'java',
    required: [...JAVA_REQUIRED],
    optional: [...JAVA_OPTIONAL],
    presets: PRESETS.java,
    defaultPreset: 'recommended',
  };
}

export function pythonCatalog(framework, version) {
  const fw = PYTHON_FRAMEWORKS.includes(String(framework)) ? String(framework) : 'fastapi';
  const py2 = String(version) === '2.7';
  const legacy = {
    flask: [
      ['flask', 'Flask', 'flask==1.1.4', 'runtime', 'Flask 1.1.4（最后支持 Python 2.7 的版本）'],
      ['pytest', 'pytest', 'pytest==4.6.11', 'test', '测试框架'],
      ['flake8', 'flake8', 'flake8==3.9.2', 'quality', '静态检查'],
      ['autopep8', 'autopep8', 'autopep8==1.7.0', 'quality', '格式化'],
    ],
    django: [
      [
        'django',
        'Django',
        'django==1.11.29',
        'runtime',
        'Django 1.11 LTS（最后支持 Python 2.7 的版本）',
      ],
      ['drf', 'Django REST Framework', 'djangorestframework==3.9.4', 'runtime', 'DRF 3.9'],
      ['pytest', 'pytest', 'pytest==4.6.11', 'test', '测试框架'],
      ['pytest-django', 'pytest-django', 'pytest-django==3.10.0', 'test', 'Django 测试集成'],
      ['flake8', 'flake8', 'flake8==3.9.2', 'quality', '静态检查'],
      ['autopep8', 'autopep8', 'autopep8==1.7.0', 'quality', '格式化'],
    ],
  };
  const source = py2 ? legacy[fw] || [] : PYTHON_REQUIRED[fw] || [];
  const required = source.map(([id, label, spec, category, description]) =>
    dep(id, label, {
      required: true,
      scope: category === 'test' || category === 'quality' ? 'dev' : 'runtime',
      version: spec,
      install: spec,
      category,
      description,
    }),
  );
  const optional = py2
    ? []
    : PYTHON_OPTIONAL.filter((item) => !item.frameworks || item.frameworks.includes(fw));
  return {
    stack: 'python',
    framework: fw,
    required,
    optional,
    presets: PRESETS.python[fw] || PRESETS.python.fastapi,
    defaultPreset: 'recommended',
  };
}

export function nodeCatalog(framework, language = 'typescript') {
  const fw = NODE_FRAMEWORKS.includes(String(framework)) ? String(framework) : 'express';
  const lang = language === 'javascript' ? 'javascript' : 'typescript';
  const tsOnly = new Set([
    'typescript',
    'tsx',
    'ts-jest',
    'typescript-eslint',
    '@types/node',
    '@types/express',
    '@types/cors',
    '@types/supertest',
    '@types/jest',
  ]);
  const required = (NODE_REQUIRED[fw] || [])
    .filter(([name]) => !(lang === 'javascript' && tsOnly.has(name)))
    .map(([name, version, scope, description]) =>
      dep(name, name, {
        required: true,
        scope,
        version,
        install: name + '@' + version,
        category: scope === 'devDependencies' ? 'test' : 'runtime',
        name,
        description,
      }),
    );
  const optional = NODE_OPTIONAL.filter((item) => !item.frameworks || item.frameworks.includes(fw));
  return {
    stack: 'node',
    framework: fw,
    required,
    optional,
    presets: PRESETS.node[fw] || PRESETS.node.express,
    defaultPreset: 'recommended',
  };
}

export function frontendCatalog(stack, language) {
  const fw = stack === 'vue' ? 'vue' : 'react';
  const lang = language === 'javascript' ? 'javascript' : 'typescript';
  const required = (FRONTEND_REQUIRED[fw]?.[lang] || []).map(
    ([name, version, scope, description]) =>
      dep(name, name, {
        required: true,
        scope,
        version,
        install: name + '@' + version,
        category: scope === 'devDependencies' ? 'test' : 'runtime',
        name,
        description,
      }),
  );
  const optional = FRONTEND_OPTIONAL.filter(
    (item) => !item.frameworks || item.frameworks.includes(fw),
  );
  return {
    stack: fw,
    framework: fw,
    language: lang,
    required,
    optional,
    presets: PRESETS[fw],
    defaultPreset: 'recommended',
  };
}

export function dependencyCatalog(side) {
  if (side.stack === 'java') return javaCatalog();
  if (side.stack === 'python')
    return pythonCatalog(side.framework, side.pythonVersion || side.runtimeVersion);
  if (side.stack === 'node') return nodeCatalog(side.framework, side.language);
  if (side.stack === 'vue' || side.stack === 'react')
    return frontendCatalog(side.stack, side.language);
  return {
    required: [],
    optional: [],
    presets: { minimal: [], recommended: [], full: [] },
    defaultPreset: 'minimal',
  };
}

export function findDependency(side, id) {
  const catalog = dependencyCatalog(side);
  return (
    catalog.required.find((item) => item.id === id) ||
    catalog.optional.find((item) => item.id === id) ||
    null
  );
}

export function resolveDependencies(side, preset = null, custom = null) {
  const catalog = dependencyCatalog(side);
  const chosenPreset =
    preset && ['minimal', 'recommended', 'full', 'custom'].includes(preset)
      ? preset
      : catalog.defaultPreset || 'recommended';
  let optionalIds = [];
  if (chosenPreset === 'custom') {
    optionalIds = Array.isArray(custom) ? custom.map(String) : [];
  } else {
    const presetIds = catalog.presets?.[chosenPreset] || [];
    optionalIds = Array.isArray(presetIds) ? presetIds.map(String) : [];
  }
  const required = catalog.required.map((item) => item.id);
  const requiredSet = new Set(required);
  const available = new Map(catalog.optional.map((item) => [item.id, item]));
  const selected = [];
  const dropped = [];
  const groups = new Map();
  for (const id of optionalIds) {
    if (requiredSet.has(id)) continue;
    const item = available.get(id);
    if (!item) {
      dropped.push({ id, reason: '当前栈/框架不支持该依赖' });
      continue;
    }
    if (item.group) {
      const previous = groups.get(item.group);
      if (previous) {
        dropped.push({ id, reason: '与已选 ' + previous + ' 互斥（分组 ' + item.group + '）' });
        continue;
      }
      groups.set(item.group, id);
    }
    if (!selected.includes(id)) selected.push(id);
  }
  return {
    preset: chosenPreset,
    required,
    optional: selected,
    dropped,
    items: [...catalog.required, ...catalog.optional],
  };
}

export function applyDetailsToSide(side, details, dependencies = null) {
  const merged = {
    ...side,
    ...defaultSideDetails(side.stack, details?.framework),
    ...(details || {}),
  };
  if (merged.stack === 'java') {
    merged.jdk = String(merged.jdk || merged.runtimeVersion || '17');
    merged.runtimeVersion = merged.jdk;
    merged.buildTool = merged.buildTool || 'maven';
    merged.packageManager = merged.buildTool;
  } else if (merged.stack === 'python') {
    merged.pythonVersion = String(merged.pythonVersion || merged.runtimeVersion || '3.12');
    merged.runtimeVersion = merged.pythonVersion;
    merged.packageManager = merged.packageManager || 'pip';
  } else if (merged.stack === 'node') {
    merged.nodeVersion = String(merged.nodeVersion || merged.runtimeVersion || '22');
    merged.runtimeVersion = merged.nodeVersion;
    merged.language = merged.language || 'typescript';
    merged.jsLanguage = merged.language;
  } else if (merged.stack === 'vue' || merged.stack === 'react') {
    merged.buildTool = merged.buildTool || 'vite';
  }
  merged.dependencies = dependencies || resolveDependencies(merged, 'recommended');
  return merged;
}

export function sideLabel(side) {
  const bits = [side.stack];
  if (side.framework && side.framework !== side.stack) bits.push(side.framework);
  if (side.runtimeVersion) bits.push(String(side.runtimeVersion));
  if (side.buildTool) bits.push(side.buildTool);
  if (side.packageManager && side.packageManager !== side.buildTool) bits.push(side.packageManager);
  if (side.language && side.language !== side.stack) bits.push(side.language);
  return bits.join(' / ');
}
