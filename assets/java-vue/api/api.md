# Task API

Query endpoints use GET with URL parameters and no request body. Every mutation uses POST with an `application/json` body. All responses, including successful deletion and errors, are JSON. There are no write operations on GET and no PUT/PATCH/DELETE mutation routes.

| Method | Path              | Request                                         | Success                       |
| ------ | ----------------- | ----------------------------------------------- | ----------------------------- |
| GET    | /api/tasks        | No body                                         | 200 array ordered by id       |
| GET    | /api/tasks/{id}   | id in URL                                       | 200 task                      |
| POST   | /api/tasks        | `{"title":"Read docs","completed":false}`       | 201 task + Location           |
| POST   | /api/tasks/update | `{"id":1,"title":"Read more","completed":true}` | 200 updated task              |
| POST   | /api/tasks/delete | `{"id":1}`                                      | 200 `{"id":1,"deleted":true}` |
| GET    | /actuator/health  | No body                                         | 200 `{"status":"UP"}`         |

Task response: `{"id":1,"title":"Read docs","completed":false}`. Titles are required, nonblank, trimmed and at most 200 characters. Completed is a required boolean; update replaces both editable fields. Mutation ids are required positive integers in the JSON body, never query parameters or form data.

Validation returns 400 JSON with field errors. Malformed JSON/ids return 400 `{"status":400,"message":"Malformed request"}`. Missing tasks return 404 `{"status":404,"message":"Task not found"}`. Unsupported methods return 405 JSON and unsupported content types return 415 JSON. Unexpected errors log server-side and expose only 500 `{"status":500,"message":"Internal server error"}`.

PowerShell example:

    Invoke-RestMethod http://127.0.0.1:8080/api/tasks/delete -Method Post -ContentType application/json -Body '{"id":1}'

Browser requests use same-origin `/api`; Vite proxies to BACKEND_PORT. The UI renders task titles and errors as text, never untrusted HTML.
