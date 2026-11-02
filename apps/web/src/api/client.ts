const TOKEN_KEY = 'dsh_console_token';
const USER_KEY = 'dsh_console_user';

export interface ApiErrorBody {
  error: { code: string; message: string; action: string; trace_id: string };
}

export class ApiError extends Error {
  constructor(public readonly body: ApiErrorBody, public readonly status: number) {
    super(body.error.message);
  }
}

export function readToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function storeSession(token: string, user: unknown): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (authenticated) {
    const token = readToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let body: ApiErrorBody;
    try { body = await response.json() as ApiErrorBody; }
    catch { body = { error: { code: 'HTTP_ERROR', message: `请求失败 (${response.status})`, action: '稍后重试', trace_id: '' } }; }
    if (response.status === 401 && authenticated) window.dispatchEvent(new Event('dsh:auth-expired'));
    throw new ApiError(body, response.status);
  }
  return response.json() as Promise<T>;
}
