# Design

- A single readable asset tree emits the reference project; all asset files use `.tpl` to avoid the plugin test runner executing template tests. Apply existing Java preset transformations after loading.
- Keep Java 8 as the common syntax baseline. Controllers delegate to services, request DTOs and response VOs are distinct from JPA entities. Use uniform ApiResponse/PageResult and JSON error boundaries.
- Session authentication uses hashed environment-supplied local credentials, CSRF tokens, fixed roles and server-side authorization. No hardcoded runtime password.
- CSV uses bounded parsing and transactional imports; uploaded content lives outside web roots with generated names, persisted metadata and authenticated downloads.
- Project-local sample manifest records hashes and paths. Planning, dispatch and review read actual examples; drift/missing files fail closed. Final quality evidence must describe the final source and cannot be inferred from command exit alone.
- Four presets share implementation and tests. Golden hashes remain invalid after any change until actual acceptance. Windows and Linux results are reported independently.
