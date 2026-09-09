/**
 * Load external CDN scripts once and cache the promise. Scripts are appended to
 * the host document head (a <script> injected into a shadow root does not
 * execute), which is fine for globals like d3 / markmap that we read back off
 * `window`.
 */
const cache = new Map<string, Promise<void>>();

export function loadScript(src: string): Promise<void> {
  const existing = cache.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
  cache.set(src, promise);
  return promise;
}

export async function loadScriptsSequential(srcs: string[]): Promise<void> {
  for (const src of srcs) {
    await loadScript(src);
  }
}
