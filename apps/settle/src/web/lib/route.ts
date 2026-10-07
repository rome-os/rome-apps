import { useEffect, useState } from "react";
import { getCurrentAppPath, navigateToApp, subscribeToAppPath } from "@rome-os/app-web-sdk";

export function useAppPath(): string {
  const [path, setPath] = useState(() => clean(getCurrentAppPath()));
  useEffect(() => subscribeToAppPath((next) => setPath(clean(next))), []);
  return path;
}

function clean(path: string): string {
  return (path || "").replace(/^\/+|\/+$/g, "");
}

export function go(path: string, options?: { replace?: boolean }): void {
  navigateToApp(path, options);
}

export function queryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

/** Drop query parameters from the address bar without navigating. */
export function clearQuery(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.search) return;
    url.search = "";
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* ignore */
  }
}
