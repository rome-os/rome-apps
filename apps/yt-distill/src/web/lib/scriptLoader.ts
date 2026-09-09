/**
 * Load external CDN scripts once and cache the promise. Scripts are appended to
 * the host document head (a <script> injected into a shadow root does not
 * execute), which is fine for globals like d3 / markmap that we read back off
 * `window`.
 */
const cache = new Map<string, Promise<void>>();

export function loadScript(src: string, integrity?: string): Promise<void> {
  const existing = cache.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    if (integrity) {
      // Subresource Integrity: the browser refuses to run the script if the
      // bytes served do not match the pinned hash.
      el.integrity = integrity;
      el.crossOrigin = "anonymous";
    }
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
  cache.set(src, promise);
  return promise;
}

export async function loadScriptsSequential(scripts: { src: string; integrity?: string }[]): Promise<void> {
  for (const { src, integrity } of scripts) {
    await loadScript(src, integrity);
  }
}
