# Java/Vue 管理后台代码风格基线 (style baseline)

> 本文档是生成项目（scaffold `java-vue-admin-1`）的可评审风格基线。它把脚手架**已经遵循**的约定写成可对照的规则，供后续变更（`sg-change`）检查。`README.md` 要求变更前先读 `docs/style.md`；评审用它判断变更是否偏离基线。约定用 **SHOULD / MUST** 描述，具体见文末「评审基线」。

生成说明：生成时按 `ProjectProfile` 替换包名与展示文案；文中 `Task*`、`Sys*` 为参考模块名。Java 设计参考《阿里巴巴 Java 开发手册》(嵩山版 2022-02-03)，但**不宣称**自动化覆盖整本手册。参考快照位于 `.specgate/examples/`，清单为 `.specgate/template-style.json`，其哈希用于检测漂移；只修改正常业务文件，**禁止**改写快照来掩盖不一致。

## 1. 后端分层 (Backend layering)

依赖方向单向向下，跨层需显式类型：

```text
controller -> service -> repository -> entity
                     \-> dto (请求输入) / vo (响应输出)
```

- `controller`：只做 HTTP 绑定、`@Valid` 校验与响应封装，不含业务规则，**不得**直接返回 `entity`。
- `service`：承载业务规则与事务边界；返回 `vo`，入参用 `dto`。
- `repository`：仅持久化，继承 `JpaRepository`（+ 需要过滤时 `JpaSpecificationExecutor`）。
- `entity`：内部存储模型，不对外暴露。
- `dto`：请求类型，命名 `<Domain>Request`、`<Domain>UpdateRequest`（更新类型可继承 `Request` 并加 `id`）；通用 `IdRequest`、`BatchRequest`。连接类如 `UpdateTaskRequest extends TaskRequest`。
- `vo`：响应类型，命名 `<Domain>VO`；由 entity 构造（`new TaskVO(entity)`）。
- 一律**构造器注入**（`private final` 依赖），不用字段注入。

## 2. common 共享组件 (Shared helpers)

`common` 包是控制器与安全过滤器共享的稳定契约，**不得**另起一套错误/追踪格式：

- `ApiResponse<T>`：统一响应信封。`success(data)` 生成 `code=0, message="OK"`；`failure(code, message, data)` 生成稳定字符串错误码。`traceId` 来自 MDC，内部生成，绝不用用户输入。`securityError(...)` 供安全过滤器直接输出 JSON 错误。
  ```json
  { "code": 0, "message": "OK", "data": {}, "traceId": "<uuid>" }
  ```
- `BusinessException`：`(int status, String code, String message)`，message **必须**可安全外露；不可预期异常不得包装成它。
- `TraceFilter`：`OncePerRequestFilter`，`@Order(HIGHEST_PRECEDENCE)`；每个请求生成 UUID `traceId`，写入 MDC 与 `X-Trace-Id` 响应头，`finally` 中清理。
- `ApiErrorHandler`：`@RestControllerAdvice`，把 `BusinessException` 映射为其带的状态码；`MethodArgumentNotValidException`→400（带字段错误 map）；参数/JSON 畸形→400；`HttpRequestMethodNotSupportedException`→405；媒体类型→415；上传超限→413；`NoHandlerFoundException`→404；`HttpMediaTypeNotAcceptableException`→406；兜底 `Exception`→500 且**内部**记日志。
- 安全语义：未登录 401、权限/CSRF 拒绝 403，错误体同样是 JSON 信封（含 `traceId`）。**不得**返回堆栈、磁盘路径或凭据。

## 3. 分页、校验、持久化、事务与配置

- 分页统一返回 `PageResult<T>`：`{ records: T[], total, page, pageSize }`；`page` 从 1 开始，请求返回**实际** total（越界页返回空 `records`）。
- 请求校验用 `javax.validation`（`@Valid @RequestBody`）：`@NotNull`、`@NotBlank`、`@Size`、`@Min` 等，放在 `dto` 字段上，不要手写重复校验。
- 列表过滤用 JPA `Specification`（repository 继承 `JpaSpecificationExecutor`）。LIKE 过滤**必须转义通配符**再拼接：
  ```java
  String escaped = value.trim()
      .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
  builder.like(builder.lower(root.get("name")), "%" + escaped + "%", '\\');
  ```
  排序字段/方向用白名单校验，禁止把用户值拼进 SQL。
- 事务边界：`service` 类级 `@Transactional(readOnly = true)`，每个写方法单独 `@Transactional`；批量操作与 CSV 导入**要么全成要么全滚**，不留部分写入。
- 上限用 `@Value` 配置并在构造器**范围校验**，越界则抛 `IllegalArgumentException` 让启动失败。示例键：`app.tasks.max-page-size`、`app.tasks.max-batch-size`、`app.sys.max-page-size`、`app.sys.max-batch-size`、`app.files.max-bytes`、`app.csv.max-rows`、`app.csv.max-bytes`。

## 4. sys 管理模块

`sys` 子包按同样分层实现后台管理：`controller` / `service` / `repository` / `entity` / `dto` / `vo`。路由固定在 `/api/sys/**`：

| 模块 | 路由前缀 | 说明 |
| --- | --- | --- |
| 用户 | `/api/sys/users` | 分页过滤、增改删、`/batch-delete` |
| 角色 | `/api/sys/roles` | 增改删；`/options` 供下拉选择 |
| 部门 | `/api/sys/departments` | 增改删；`/options` |
| 菜单 | `/api/sys/menus` | 增改删；`/options` |
| 审计日志 | `/api/sys/audits` | 只读分页查询 |
| 仪表盘 | `/api/sys/dashboard` | 只读汇总统计 |

- 唯一性等业务冲突返回 409（如用户名重复），缺失返回 404，非法入参返回 400。
- `sys` 的 `@Value` 使用 `app.sys.*` 键；控制器与服务均带中文业务注释。

## 5. HTTP API 约定

- **查询用 GET**（无请求体，参数走 query/path）；**所有变更用 POST**（`application/json`），不用 PUT/PATCH/DELETE。
- 更新与删除的 id 放在 JSON 体内：`POST .../update`（体含 `id`）、`POST .../delete`（体 `{id}`）。
- 批量接口命名 `POST .../batch-*`（如 `/api/tasks/batch-delete`、`/api/tasks/batch-update-status`），ids 为 1–`maxBatchSize` 个**互不相同**的正整数。
- 业务响应统一为 JSON 信封；创建成功返回 **201 + `Location`**（`/api/<resource>/<id>`）。
- **受控例外**：CSV/文件传输允许 multipart 上传与二进制下载响应（`/api/files/upload`、`/api/tasks/import[/validate]`、`/api/files/{id}/download`、`/api/tasks/export`）；但这些端点**出错时仍是 JSON 信封**，HTTP 状态保持语义（400/401/403/404/405/413/415/500）。
- 导出/导入有界（默认 ≤1000 行 / 2 MiB），超限报错而非截断；CSV 公式注入需中和。

## 6. 前端约定 (Frontend)

技术栈固定：Vue 3.5 + Element Plus 2.11 + vue-router 4 + vue-i18n 11 + TypeScript 5.9（Vite / Vitest）。

- 每个组件用 **`<script setup lang="ts">`** 组合式 API；props 用 `defineProps<{...}>()`，事件用 `defineEmits`。
- UI 组件来自 **Element Plus**，按需具名导入（`ElButton, ElCard, ElInput, ElPagination, ElTag, ElCheckbox` 等）。
- 路由用 `createWebHashHistory()`（hash 路由）；受保护页面挂载在 `AppLayout` 外壳（侧边栏导航 + 顶栏 + `RouterView`）内，路由集中在 `src/router/index.ts`。
- 网络访问集中到 `src/api/*.ts`（`tasks.ts`、`sys.ts`、`auth.ts`、`files.ts`），复用共享助手：`request<T>()`（GET/读）、`mutate<T>()`（POST/写，**每次写请求重新取 CSRF token**，支持 JSON 与 `FormData`）、`download()`（附件下载）。
- 页面用 **`run(action)` 包裹器**统一处理忙/错状态：置 `busy`、清空 `error`、`catch` 后显示消息（`ApiError` 追加 traceId）、`finally` 复位。横幅用语义角色：错误 `role="alert"`，提示/进行中 `role="status"`。
- 确认/详情用内联 `[role="dialog"]` 块（带 `:aria-label`），不弹系统 `confirm`。
- 列表分页用 **`ElPagination`**（`:current-page` / `:page-size` / `:total` / `@current-change`）。
- 所有展示文本经 **`t()`** 取 i18n key，默认 **`zh-CN`**，保留 **`en-US`** 并在运行时切换（`setLocale`，持久化到 `localStorage`）。**禁止**硬编码展示字符串。

## 7. 命名与注释

- 包根为 `ProjectProfile` 的 **`com.<company>.<business>`** 及对应源码目录；**禁止**新增 `com.example.*` 代码（参考模板中的 `com.example.tasks` 仅为示例占位）。
- Java / TypeScript / Vue 源文件使用**中文文件说明与必要的中文业务注释**（类、方法、关键分支）。
- 生产方法与变量用 lowerCamelCase；常量 UPPER_SNAKE_CASE；类型 PascalCase。JUnit 验收测试方法用 `AC001_caseName` 形式（Checkstyle `MethodName` 显式放行）以保持可追溯，普通单测用描述性 camelCase；前端测试文件 `<name>.test.ts`（Vitest）。

## 8. 格式与校验闸门 (Formatting gates)

- Java：**Spotless + Google Java Format AOSP**（四空格缩进、UNIX 行尾）；**Checkstyle** 校验命名/导入/修饰符/语句子集（`AvoidStarImport`、`TypeName`、`MethodName` 等）。工具结果**不得**表述为「完整符合手册」。
- 前端：**Prettier**（`singleQuote`、`semi`）+ **ESLint**（flat config，typescript-eslint + eslint-plugin-vue，`--max-warnings=0`）。前端不用 Java 格式规则。
- 统一入口：`node scripts/run.mjs format` 应用格式，`format:check` / `lint` / `static` / `verify` 校验。后端与前端**分别**要求 ≥80% 行、≥70% 分支覆盖，业务代码无排除；`main.ts` 与 DTO/VO 仍计入。未运行或失败的命令**不得**描述为通过。

## 9. 评审基线 (Review baseline)

- 变更 **SHOULD** 遵循本文所有约定；脚手架本身即为这些约定的可运行范例，可用作对照。
- **无显式且已记录理由的偏离，视为评审发现（review finding）**。
- 当偏离具实质性影响（分层/契约/事务/安全/接口与前端一致性被破坏）时，**可**作为阻塞性问题（blocking finding）提出。
- 偏离理由需随变更记录；仅「历史上如此」「临时绕过」不构成理由。
