/** Real HTTP acceptance against an isolated server; no fabricated test results. */
export function sessionClient(base) {
  const cookies = new Map();
  async function send(route, options = {}) {
    const response = await fetch(base + route, {
      ...options,
      headers: {
        Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '),
        ...options.headers,
      },
      signal: AbortSignal.timeout(15000),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0];
      const split = pair.indexOf('=');
      cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response;
  }
  async function json(route, options = {}, expected = 200) {
    const response = await send(route, options);
    const body = await response.json();
    if (response.status !== expected || (expected < 400 && body.code !== 0)) {
      throw new Error(
        route + ': expected HTTP ' + expected + ', got ' + response.status + ' (' + body.code + ')',
      );
    }
    return body.data;
  }
  async function write(route, body, expected = 200) {
    const csrf = await json('/api/auth/csrf');
    const multipart = body instanceof FormData;
    return json(
      route,
      {
        method: 'POST',
        headers: {
          'X-CSRF-TOKEN': csrf.token,
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
        },
        body: multipart ? body : JSON.stringify(body),
      },
      expected,
    );
  }
  return { send, json, write, clear: () => cookies.clear() };
}

export async function exerciseAdminApi({ base, env, restart, log }) {
  const admin = sessionClient(base);
  const viewer = sessionClient(base);
  const expect = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  await admin.json('/api/tasks', {}, 401);
  await admin.write('/api/auth/login', { username: 'admin', password: env.APP_ADMIN_PASSWORD });
  await viewer.write('/api/auth/login', { username: 'viewer', password: env.APP_VIEWER_PASSWORD });
  expect((await admin.json('/api/auth/me')).role === 'ADMIN', 'Administrator role mismatch');
  await viewer.write('/api/tasks', { title: 'forbidden', completed: false }, 403);
  const csrfDenied = await admin.send('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(csrfDenied.status === 403, 'Missing CSRF token was accepted');
  const task = await admin.write('/api/tasks', { title: 'sg-verify', completed: false }, 201);
  expect((await viewer.json('/api/tasks/' + task.id)).title === 'sg-verify', 'Task read mismatch');
  await admin.write('/api/tasks/update', {
    id: task.id,
    title: 'sg-verify-updated',
    completed: true,
  });
  await admin.write('/api/tasks/batch-update-status', { ids: [task.id], completed: false });
  await admin.write('/api/tasks/batch-delete', { ids: [task.id, 9007199254740991] }, 404);
  const page = await admin.json(
    '/api/tasks?title=sg-verify&completed=false&pageSize=1&sortBy=title&sortOrder=desc',
  );
  expect(
    page.total === 1 && page.records[0].id === task.id,
    'Pagination/filter/atomic rollback mismatch',
  );
  await admin.json('/api/tasks?page=0', {}, 400);
  const upload = new FormData();
  upload.append('file', new Blob(['persistent-content'], { type: 'text/plain' }), 'note.txt');
  const file = await admin.write('/api/files/upload', upload);
  expect((await viewer.json('/api/files/' + file.fileId)).size === 18, 'File metadata mismatch');
  const csv = new FormData();
  csv.append(
    'file',
    new Blob(['title,completed\r\nImported,true\r\n'], { type: 'text/csv' }),
    'tasks.csv',
  );
  expect((await admin.write('/api/tasks/import/validate', csv)).valid, 'CSV validation failed');
  expect((await admin.write('/api/tasks/import', csv)).count === 1, 'CSV import failed');
  const exported = await viewer.send('/api/tasks/export?title=Imported');
  expect(
    exported.status === 200 && (await exported.text()).includes('Imported'),
    'CSV export mismatch',
  );
  const bad = new FormData();
  bad.append(
    'file',
    new Blob(['title,completed\nValid,true\n,invalid'], { type: 'text/csv' }),
    'bad.csv',
  );
  await admin.write('/api/tasks/import', bad, 400);
  await restart(async () => {
    const csrf = await admin.json('/api/auth/csrf');
    return admin.send('/actuator/shutdown', {
      method: 'POST',
      headers: { 'X-CSRF-TOKEN': csrf.token },
    });
  });
  admin.clear();
  viewer.clear();
  await admin.write('/api/auth/login', { username: 'admin', password: env.APP_ADMIN_PASSWORD });
  await viewer.write('/api/auth/login', { username: 'viewer', password: env.APP_VIEWER_PASSWORD });
  expect(
    (await admin.json('/api/tasks/' + task.id)).title === 'sg-verify-updated',
    'Task did not survive restart',
  );
  expect(
    (await (await viewer.send('/api/files/' + file.fileId + '/download')).text()) ===
      'persistent-content',
    'File did not survive restart',
  );
  const receipt = await admin.write('/api/tasks/delete', { id: task.id });
  expect(receipt.deleted && receipt.id === task.id, 'Deletion receipt mismatch');
  await admin.json('/api/tasks/' + task.id, {}, 404);
  const imported = await admin.json('/api/tasks?title=Imported');
  await admin.write('/api/tasks/batch-delete', { ids: imported.records.map((item) => item.id) });
  await viewer.write('/api/auth/logout', {});
  await viewer.json('/api/auth/me', {}, 401);
  log('HTTP login/CSRF/roles/CRUD/pagination/batch/CSV/files/restart/logout passed');
}
