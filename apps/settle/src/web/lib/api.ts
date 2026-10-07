import { fetchAppApi } from "@rome-os/app-web-sdk";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; raw?: Blob }): Promise<T> {
  const method = init?.method ?? (init?.body === undefined && !init?.raw ? "GET" : "POST");
  const response = await fetchAppApi(path, {
    method,
    headers: init?.raw ? { "Content-Type": init.raw.type } : init?.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init?.raw ? init.raw : init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    /* empty body */
  }
  if (!response.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    const code = d.error === "visitor_auth_required" ? "visitor_auth_required" : undefined;
    throw new ApiError(response.status, (code ? d.message : d.error) || d.message || `Request failed (${response.status})`, code);
  }
  return data as T;
}
