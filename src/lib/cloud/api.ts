/**
 * Thin client for the Drawesome backend (Azure Functions, see backend/README.md).
 * Accounts are optional: when VITE_API_BASE_URL isn't set at build time, nothing in
 * the app talks to a server and the sign-in button stays hidden.
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";
export const API_BASE = RAW_BASE.replace(/\/+$/, "");
export const cloudEnabled = API_BASE.length > 0;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** Called when a signed-in request comes back 401 (expired session or deleted account). */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal } = {}
): Promise<T> {
  if (!cloudEnabled) throw new ApiError(0, "Accounts aren't set up for this copy of Drawesome.");
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const useAuth = init.auth !== false && authToken;
  if (useAuth) headers.Authorization = `Bearer ${authToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiError(0, "Couldn't reach Drawesome's server. Check your connection and try again.");
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) {
    if (res.status === 401 && useAuth) onUnauthorized?.();
    const message = typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return data as T;
}
