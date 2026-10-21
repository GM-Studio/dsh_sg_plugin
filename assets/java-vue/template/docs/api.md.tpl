# API contract — java-vue-admin-1

Queries use GET without a body. Mutations use POST application/json, including id in update/delete bodies. The file exceptions below are explicit. Successful business responses have {code:0,message:"OK",data:T,traceId:string}; failures have a stable string code, safe message, optional validation data and traceId, with an appropriate non-2xx HTTP status.

## Authentication

1. GET /api/auth/csrf (anonymous allowed), retain the session cookie and read data.token.
2. POST /api/auth/login with JSON {username,password} and X-CSRF-TOKEN, retaining the rotated cookie.
3. GET /api/auth/me returns {username,role}. Fetch a fresh CSRF token before each POST, including multipart uploads and logout.
4. POST /api/auth/logout with JSON {} invalidates the Session. Unauthenticated requests return 401; unauthorized or CSRF-denied requests return 403. Passwords never appear in responses.

Accounts: admin (ADMIN), viewer (VIEWER). Passwords are configured externally. Both roles share the local sample data. All reads, exports and downloads require login; only ADMIN writes/imports/uploads. No registration, password reset, SSO or tenant/owner isolation.

## Task JSON endpoints

| Method | Path | Input | data / status |
| --- | --- | --- | --- |
| GET | /api/tasks | page=1,pageSize=20,title,completed,sortBy=id,sortOrder=asc | {records:Task[],total,page,pageSize} / 200 |
| GET | /api/tasks/{id} | positive id | {id,title,completed} / 200 |
| POST | /api/tasks | {title,completed} | Task / 201 |
| POST | /api/tasks/update | {id,title,completed} | Task / 200 |
| POST | /api/tasks/delete | {id} | {id,deleted:true,count:1} / 200 |
| POST | /api/tasks/batch-delete | {ids} | {id:null,deleted:true,count} / 200 |
| POST | /api/tasks/batch-update-status | {ids,completed} | {id:null,deleted:false,count} / 200 |

page starts at 1; pageSize is 1–100. Sort fields: id/title/completed; directions: asc/desc. Empty/out-of-range pages have empty records and the actual total. Invalid page/sort is 400. Titles are nonblank, trimmed and at most 200 characters; completed is required. A missing task is 404.

Batch ids: 1–100 distinct positive integers. Any invalid/missing id makes the entire request fail without partial writes; null completed is invalid for state updates.

## CSV and files (binary exceptions)

| Method | Path | Transfer | Result |
| --- | --- | --- | --- |
| GET | /api/tasks/import/template | attachment CSV | title,completed template |
| POST | /api/tasks/import/validate | multipart field file | JSON {count,valid,errors}; no writes |
| POST | /api/tasks/import | multipart field file | JSON ImportResult; atomic insert only |
| GET | /api/tasks/export | title/completed query | attachment CSV matching filter |
| POST | /api/files/upload | multipart field file | JSON FileVO |
| GET | /api/files | none | JSON FileVO[] (at most 100) |
| GET | /api/files/{fileId} | opaque fileId | JSON FileVO |
| GET | /api/files/{fileId}/download | opaque fileId | authenticated attachment |

CSV: UTF-8 (optional BOM), exact header title,completed; boolean true/false; quotes, commas, embedded newlines and blank lines handled by Commons CSV. Default <=1000 rows / 2 MiB. Preview reports row-level validation errors; confirmation parses and validates again. Invalid imports roll back entirely; successful imports insert rows, not an idempotent upsert. Export >1000 matches is rejected, never truncated. Formula-like exported cells are neutralized for spreadsheet use.

FileVO: {fileId,name,mediaType,size,downloadUrl}. Upload defaults <=10 MiB and allows CSV/TXT/PNG/JPEG/PDF with matching extension, declared MIME and content checks. Original names are display metadata; disk names are generated ids outside static roots. Invalid names/types, missing content, storage failures and denied downloads return JSON errors. Uploaded files are never served as executable/static content. No antivirus scanning is claimed.

Common failures: 400 invalid input, 401 login required, 403 permission/CSRF denied, 404 missing resource, 405 method, 413 size, 415 media type, 429 login rate, 500 internal/storage error. X-Trace-Id correlates internal logs. Never return stack traces, disk paths or credentials. Actuator health is public and contains no sensitive details.
