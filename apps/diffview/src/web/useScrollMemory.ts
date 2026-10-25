import { useEffect, useMemo } from "react";
import { loadScroll, saveScroll, type ScrollPosition } from "../shared/scroll";
import type { KV } from "../shared/prefs";

/** One bounded, throttled scroll journal for one conversation/comparison. */
export function useScrollMemory(scope: string, view: string, storage: KV) {
  const memory = useMemo(() => {
    let latest = loadScroll(scope, view, storage);
    let viewer: object | undefined;
    let pending: ScrollPosition | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (pending) saveScroll(scope, view, pending, storage);
      pending = undefined;
    };
    return {
      restore(
        owner: object,
        apply: (position: ScrollPosition | undefined) => void,
      ) {
        if (viewer === owner) return;
        viewer = owner;
        apply(latest);
      },
      remember(position: ScrollPosition, owner: object) {
        if (viewer !== owner) return;
        latest = pending = position;
        if (timer === undefined) timer = setTimeout(flush, 250);
      },
      flush,
    };
  }, [scope, view, storage]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") memory.flush();
    };
    window.addEventListener("pagehide", memory.flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", memory.flush);
      document.removeEventListener("visibilitychange", hidden);
      // Flush the last observed position even if the viewer has already unmounted.
      memory.flush();
    };
  }, [memory]);
  return memory;
}
