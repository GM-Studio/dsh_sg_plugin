# 生成 API 的统一约定

所有 Golden 模板、脚手架和 CRUD 示例使用下列约定。查询采用 GET，写操作统一采用 POST；POST 的参数使用 `application/json` body，成功和失败响应均为 JSON。GET 不使用 body，查询参数放在路径或 query string。保留资源实体和列表数组的 JSON 结构，不额外引入响应 envelope。

| 操作 | 方法 | 示例路径 | JSON body | 成功响应 |
| --- | --- | --- | --- | --- |
| 列表 | GET | `/api/tasks` | 无 | 200，JSON 数组 |
| 单项 | GET | `/api/tasks/1` | 无 | 200，实体 JSON |
| 新增 | POST | `/api/tasks` | `{"title":"Read","completed":false}` | 201，实体 JSON |
| 修改 | POST | `/api/tasks/update` | `{"id":1,"title":"Read more","completed":true}` | 200，实体 JSON |
| 删除 | POST | `/api/tasks/delete` | `{"id":1}` | 200，`{"id":1,"deleted":true}` |

Item 示例使用 `/api/items`、`/api/items/update`、`/api/items/delete`；业务字段是 `name`、`description`，方法及 id 规则相同。修改和删除的 id 不再放入 URL，删除不再返回空 204。非法 id、无效 JSON、缺失资源和不支持的方法返回 JSON 错误。框架原生错误对象可以不同，例如 FastAPI 的 `detail` 与其他栈的 `error`。

已同步：Java 四版本档与旧 Java Item 控制器，Express/Fastify 的 JS/TS、NestJS，FastAPI/Flask/Django、标准库 Python，Vue/React 客户端，生成 OpenAPI、需求、任务、测试、默认 Java HTTP 冒烟验证器。没有保留旧写入方法作为兼容别名。

验收记录见 [本次原始证据](../verification/2026-10-21-json-post-crud/README.md)。历史验收目录保留当时实际接口的日志，不作为当前模板凭证。已有业务项目不会被生成器自动覆盖，需要在更新插件后另行迁移。
