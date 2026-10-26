import { fetchAppApi } from "@rome-os/app-web-sdk";

export async function api<T>(
  route: string,
  q?: Record<string, string | undefined>,
  signal?: AbortSignal,
) {
  const res = await fetchAppApi(
    route +
      (q
        ? "?" +
          new URLSearchParams(
            Object.entries(q).filter(
              (x): x is [string, string] => x[1] !== undefined,
            ),
          ).toString()
        : ""),
    { signal },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "internal");
  return data as T;
}
