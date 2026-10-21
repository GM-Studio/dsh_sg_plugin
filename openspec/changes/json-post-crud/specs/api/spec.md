# API 要求

- GET `/api/<resource>` 查询列表，GET `/api/<resource>/{id}` 查询单项；无 GET body。
- POST `/api/<resource>` 新增，JSON body 包含业务字段，201 返回实体 JSON。
- POST `/api/<resource>/update` 修改，JSON body 包含正整数 id 与业务字段，200 返回实体 JSON。
- POST `/api/<resource>/delete` 删除，JSON body 包含正整数 id，200 返回 `{"id":1,"deleted":true}`。
- 不生成 PUT/PATCH/DELETE 写入路由；不得用 GET 执行写操作或返回空 204。无效写入参数、缺失资源和不支持的方法返回 JSON 错误及相应非成功状态。
- 客户端与服务端、OpenAPI、生成用例、冒烟验证器一致。
- 模板变更先使历史 Golden 不匹配；真实构建、用例、静态/格式检查及运行时验收通过后方可登记新哈希。
