# Java/Vue reference style (java-vue-admin-1)

Java follows the Alibaba Java Coding Guidelines (Huangshan edition, 2022-02-03) naming and design guidance. The executable subset is Checkstyle naming/import/modifier/statement checks, Spotless Google Java Format AOSP (four-space indentation), compiler checks and tests. Framework conventions and annotations remain idiomatic Spring/JPA. This does not claim automated enforcement of the entire handbook. JUnit AC001_case names are an explicit exception for acceptance traceability; production methods use lowerCamelCase. See https://github.com/alibaba/p3c.

- Controller: HTTP binding, validation and response only. Service: business rules and transactions. Repository: persistence. Entity: internal storage. DTO: input. VO: output. Constructor injection; no entity returned from controllers.
- GET queries have no body; writes use POST JSON with ids in the body. Upload/import use multipart; successful download/export streams files. Errors always use ApiResponse, including security filters. HTTP status retains its meaning.
- TaskController, TaskService, TaskRequest, TaskVO and TaskApiTest are the backend examples. frontend/src/api/{request,tasks,auth,files,types}.ts and App.vue demonstrate the frontend and its tests. Frontend uses TypeScript, Vue composition API, ESLint and Prettier, not Java formatting rules.
- 新后端代码必须放在 ProjectProfile 的 `com.<company>.<business>` 包和对应源码目录中，禁止新增 `com.example.*` 代码。
- 新前端展示文本必须通过 i18n key 提供；默认 `zh-CN`，并保留 `en-US`。
- Java、TypeScript 和 Vue 源码使用中文文件说明与必要的中文业务注释。
- A new resource should provide its own DTO/VO/service/controller/repository, typed API module, UI and meaningful tests. Update docs/api.md and test normal/boundary/error/auth paths. Do not copy Task domain names into unrelated features.
- Use safe business exceptions; unexpected exceptions are logged internally with a traceId. Never log passwords, session ids, cookies or file content. Never concatenate user values into SQL or disk paths.
- Shared task data is intentional. ADMIN writes; VIEWER reads/exports/downloads. This is not a tenant/ownership model.
- Batch changes and CSV imports are atomic. File metadata failure removes the newly written content. Enforce bounded inputs and preserve error semantics.
- node scripts/run.mjs format applies formatting; node scripts/run.mjs verify checks the final source. Both frontend and backend require 80% lines and 70% branches, separately. No business-code coverage exclusions. main.ts and DTO/VO code remain included.
- Check login/CSRF/logout/expiry, backend permissions, transactions, file type/path/size limits, CSV formulas and malformed input in review. ESLint is not a code review.
- .specgate/template-style.json indexes immutable project-local reference snapshots under .specgate/examples/. Their hashes detect drift. Change business source files normally; never rewrite these snapshots to hide a mismatch. Existing projects require an explicit reviewed migration before adopting a newer baseline.
