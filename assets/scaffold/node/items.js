const items = new Map();
let sequence = 0;

export function resetItems() {
  items.clear();
  sequence = 0;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export async function handleItems(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'items') return false;
  if (parts.length > 3) {
    send(res, 404, { error: 'not found' });
    return true;
  }
  if (req.method === 'GET') {
    if (parts.length === 2) send(res, 200, [...items.values()]);
    else {
      const id = Number(parts[2]);
      const item = items.get(id);
      if (!Number.isSafeInteger(id) || id <= 0) send(res, 400, { error: 'invalid id' });
      else if (!item) send(res, 404, { error: 'not found' });
      else send(res, 200, item);
    }
    return true;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'use GET for queries and POST for mutations' });
    return true;
  }
  if (
    !String(req.headers['content-type'] || '')
      .toLowerCase()
      .startsWith('application/json')
  ) {
    send(res, 415, { error: 'use application/json' });
    return true;
  }
  const body = await readBody(req);
  if (!body) {
    send(res, 400, { error: 'invalid JSON object' });
    return true;
  }
  const action = parts[2];
  if (action && action !== 'update' && action !== 'delete') {
    send(res, 404, { error: 'not found' });
    return true;
  }
  const id = body.id;
  if (action && (!Number.isSafeInteger(id) || id <= 0)) {
    send(res, 400, { error: 'id must be a positive integer' });
    return true;
  }
  if (action && !items.has(id)) {
    send(res, 404, { error: 'not found' });
    return true;
  }
  if (action === 'delete') {
    items.delete(id);
    send(res, 200, { id, deleted: true });
    return true;
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    send(res, 400, { error: 'name is required' });
    return true;
  }
  const item = {
    id: action ? id : ++sequence,
    name: body.name.trim(),
    description: body.description || '',
  };
  items.set(item.id, item);
  send(res, action ? 200 : 201, item);
  return true;
}
