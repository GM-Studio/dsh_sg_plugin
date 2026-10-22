# API contract — java-vue-admin-1

Queries use GET without a body. Mutations use POST application/json, including id in update/delete bodies. The CSV exceptions below are explicit. Successful business responses have {code:0,message:"OK",data:T,traceId:string}; failures have a stable string code, safe message, optional validation data and traceId, with an appropriate non-2xx HTTP status.

## Authentication

1. GET /api/auth/csrf (anonymous allowed), retain the session cookie and read data.token.
2. POST /api/auth/login with JSON {username,password} and X-CSRF-TOKEN, retaining the rotated cookie.
3. GET /api/auth/me returns {username,role}. Fetch a fresh CSRF token before each POST, including multipart uploads and logout.
4. POST /api/auth/logout with JSON {} invalidates the Session. Unauthenticated requests return 401; unauthorized or CSRF-denied requests return 403. Passwords never appear in responses.

Accounts: admin (ADMIN), viewer (VIEWER). Passwords are configured externally. All reads, exports and downloads require login; only ADMIN writes/imports. No registration, password reset, SSO or tenant/owner isolation.

## System administration endpoints

| Method | Path | Input | data / status |
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

The audit log is read-only: it has no create/update/delete endpoint. page starts at 1; pageSize is 1–100. Results are ordered by id. Empty/out-of-range pages have empty records and the actual total. Invalid page is 400. A missing record is 404; a duplicate unique key (for example a username or role code) is 409.

Batch ids: 1–100 distinct positive integers. Any invalid/missing id makes the entire request fail without partial writes.

SysUser: {id,username,displayName,roleCode,enabled}. SysRole: {id,code,name,description,enabled}. SysDepartment: {id,code,name,parentCode,enabled}. SysMenu: {id,code,name,path,icon,sortOrder,enabled}. SysAuditLog: {id,actor,action,target,detail,createdAt}. SysOption: {value,label}.

## CSV endpoints (binary exceptions)

| Method | Path | Transfer | Result |
| --- | --- | --- | --- |
| GET | /api/sys/users/import/template | attachment CSV | username,displayName,roleCode,enabled template |
| POST | /api/sys/users/import/validate | multipart field file | JSON {count,valid,errors}; no writes |
| POST | /api/sys/users/import | multipart field file | JSON ImportResult; atomic insert only |
| GET | /api/sys/users/export | username/roleCode/enabled query | attachment CSV matching filter |
| GET | /api/sys/roles/import/template | attachment CSV | code,name,description,enabled template |
| POST | /api/sys/roles/import/validate | multipart field file | JSON {count,valid,errors}; no writes |
| POST | /api/sys/roles/import | multipart field file | JSON ImportResult; atomic insert only |
| GET | /api/sys/roles/export | code/name query | attachment CSV matching filter |

CSV: UTF-8 (optional BOM) with the exact per-module header; boolean true/false; quotes, commas, embedded newlines and blank lines handled by Commons CSV. Default <=1000 rows / 2 MiB. Preview reports row-level validation errors; confirmation parses and validates again. Invalid imports roll back entirely; successful imports insert rows, not an idempotent upsert. Export >1000 matches is rejected, never truncated. Formula-like exported cells are neutralized for spreadsheet use.

ImportResult: {count,valid,errors}.

Common failures: 400 invalid input, 401 login required, 403 permission/CSRF denied, 404 missing resource, 405 method, 413 size, 415 media type, 429 login rate, 500 internal error. X-Trace-Id correlates internal logs. Never return stack traces, disk paths or credentials. Actuator health is public and contains no sensitive details.
