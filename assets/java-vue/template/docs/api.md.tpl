# 管理后台 API 契约 — java-vue-admin-1

查询使用 GET 且无请求体；所有变更使用 POST application/json，更新与删除的 id 放在 JSON 体中。CSV 的传输例外见下文。成功业务响应为 {code:0,message:"OK",data:T,traceId:string}；失败包含稳定错误码、安全消息、可选校验信息和 traceId，并返回对应非 2xx 状态。

## 登录与权限

1. GET /api/auth/csrf（允许匿名），保留 Session Cookie 并读取 data.token。
2. POST /api/auth/login，提交 JSON {username,password} 和 X-CSRF-TOKEN，保留轮换后的 Cookie。
3. GET /api/auth/me 返回 {username,role}。每次 POST 前重新获取 CSRF token，上传和退出也一样。
4. POST /api/auth/logout，提交 JSON {} 后会话失效。未登录返回 401，权限不足或 CSRF 拒绝返回 403。响应不包含密码。

账号：admin（ADMIN）、viewer（VIEWER），密码在本地 .env 或环境变量配置。查询、导出、下载均需登录；仅 ADMIN 能变更或导入。不包含注册、密码重置、SSO 或租户/所有者隔离。

## 系统管理接口

| 方法 | 路径 | 输入 | data / 状态 |
| --- | --- | --- | --- |
| GET | /api/sys/dashboard | none | {userCount,roleCount,departmentCount,menuCount,auditCount} / 200 |
| GET | /api/sys/users | page=1,pageSize=20,username,roleCode,enabled | {records:SysUser[],total,page,pageSize} / 200 |
| GET | /api/sys/users/{id} | positive id | SysUser / 200 |
| POST | /api/sys/users | {username,displayName,roleCode,enabled} | SysUser / 201 |
| POST | /api/sys/users/update | {id,username,displayName,roleCode,enabled} | SysUser / 200 |
| POST | /api/sys/users/delete | {id} | {id,deleted:true,count:1} / 200 |
| POST | /api/sys/users/batch-delete | {ids} | {id:null,deleted:true,count} / 200 |
| GET | /api/sys/roles | page=1,pageSize=20,code,name | {records:SysRole[],total,page,pageSize} / 200 |
| GET | /api/sys/roles/options | none | {value,label}[] / 200 |
| GET | /api/sys/roles/{id} | positive id | SysRole / 200 |
| POST | /api/sys/roles | {code,name,description,enabled} | SysRole / 201 |
| POST | /api/sys/roles/update | {id,code,name,description,enabled} | SysRole / 200 |
| POST | /api/sys/roles/delete | {id} | {id,deleted:true,count:1} / 200 |
| GET | /api/sys/departments | page=1,pageSize=20,code,name | {records:SysDepartment[],total,page,pageSize} / 200 |
| GET | /api/sys/departments/options | none | {value,label}[] / 200 |
| GET | /api/sys/departments/{id} | positive id | SysDepartment / 200 |
| POST | /api/sys/departments | {code,name,parentCode,enabled} | SysDepartment / 201 |
| POST | /api/sys/departments/update | {id,code,name,parentCode,enabled} | SysDepartment / 200 |
| POST | /api/sys/departments/delete | {id} | {id,deleted:true,count:1} / 200 |
| GET | /api/sys/menus | page=1,pageSize=20,code,name | {records:SysMenu[],total,page,pageSize} / 200 |
| GET | /api/sys/menus/options | none | {value,label}[] / 200 |
| GET | /api/sys/menus/{id} | positive id | SysMenu / 200 |
| POST | /api/sys/menus | {code,name,path,icon,sortOrder,enabled} | SysMenu / 201 |
| POST | /api/sys/menus/update | {id,code,name,path,icon,sortOrder,enabled} | SysMenu / 200 |
| POST | /api/sys/menus/delete | {id} | {id,deleted:true,count:1} / 200 |
| GET | /api/sys/audits | page=1,pageSize=20,actor,action | {records:SysAuditLog[],total,page,pageSize} / 200 |

审计日志只读，没有新增、更新或删除接口。page 从 1 开始，pageSize 为 1–100，结果按 id 排序。空页与越界页返回空 records 和实际 total；非法分页为 400，记录不存在为 404，唯一键重复（如用户名、角色编码）为 409。

批量 ids 为 1–100 个不重复正整数。任一 id 非法或不存在会使整个请求失败，不发生部分写入。

SysUser: {id,username,displayName,roleCode,enabled}. SysRole: {id,code,name,description,enabled}. SysDepartment: {id,code,name,parentCode,enabled}. SysMenu: {id,code,name,path,icon,sortOrder,enabled}. SysAuditLog: {id,actor,action,target,detail,createdAt}. SysOption: {value,label}.

## CSV 接口（受控二进制例外）

| 方法 | 路径 | 传输方式 | 结果 |
| --- | --- | --- | --- |
| GET | /api/sys/users/import/template | attachment CSV | username,displayName,roleCode,enabled template |
| POST | /api/sys/users/import/validate | multipart field file | JSON {count,valid,errors}; no writes |
| POST | /api/sys/users/import | multipart field file | JSON ImportResult; atomic insert only |
| GET | /api/sys/users/export | username/roleCode/enabled query | attachment CSV matching filter |
| GET | /api/sys/roles/import/template | attachment CSV | code,name,description,enabled template |
| POST | /api/sys/roles/import/validate | multipart field file | JSON {count,valid,errors}; no writes |
| POST | /api/sys/roles/import | multipart field file | JSON ImportResult; atomic insert only |
| GET | /api/sys/roles/export | code/name query | attachment CSV matching filter |

CSV 为 UTF-8（可带 BOM），必须使用对应模块的准确表头，布尔值为 true/false。Commons CSV 处理引号、逗号、换行与空行。默认上限 1000 行 / 2 MiB。预校验返回行级错误，确认导入时再次解析与校验；非法导入整体回滚，成功导入为新增记录而非幂等 upsert。导出超 1000 条会拒绝，不静默截断；对公式样式的单元格做中和处理。

ImportResult: {count,valid,errors}.

常见错误：400 参数非法、401 未登录、403 权限/CSRF 拒绝、404 资源不存在、405 方法错误、413 超限、415 媒体类型错误、429 登录限流、500 内部错误。X-Trace-Id 关联内部日志；禁止返回堆栈、磁盘路径和凭据。Actuator 健康检查公开但不含敏感详情。
