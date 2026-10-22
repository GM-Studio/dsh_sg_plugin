import type { ApiResponse } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchResponse(
  path: string,
  options: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...options });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Please retry.');
  }
  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => null)) as ApiResponse<unknown> | null;
    if (response.status === 401) {
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(
      response.status,
      error?.message || `Request failed (${response.status})`,
      error?.traceId,
    );
  }
  return response;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchResponse(path, options);
  const body = (await response.json()) as ApiResponse<T>;
  if (body.code !== 0) {
    throw new ApiError(response.status, body.message, body.traceId);
  }
  return body.data;
}

export async function mutate<T>(path: string, body: unknown): Promise<T> {
  // Fetch a fresh token for every write: session changes and logout cannot leave a stale cache.
  const csrf = await request<{ token: string }>('/api/auth/csrf');
  const multipart = body instanceof FormData;
  return request<T>(path, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      // Writes carry the session CSRF token. `x-specgate-csrf` is the requested
      // header name; `X-CSRF-TOKEN` is sent in parallel because the shared Spring
      // Security backend (HttpSessionCsrfTokenRepository), like the Vue template's
      // request.ts, reads that name.
      'x-specgate-csrf': csrf.token,
      'X-CSRF-TOKEN': csrf.token,
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    },
    body: multipart ? body : JSON.stringify(body),
  });
}

export async function download(path: string, filename: string): Promise<void> {
  const response = await fetchResponse(path, {});
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
