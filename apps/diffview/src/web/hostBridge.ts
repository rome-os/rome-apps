/**
 * Best-effort bridge to the chat page that embeds this app in its workspace.
 *
 * Clicking a project link in a chat message opens the Projects panel and selects the file by
 * emitting `projects:opened` on the page's event bus and setting `followTargetPath` in its
 * store. The SDK exposes neither (an already-open panel ignores `selectedPath`), so until it does
 * we find both through the parent's React tree. The app iframe is same-origin by design. Every
 * step is guarded: if the host's internals change this returns false and the caller falls back
 * to the supported widget message.
 */
interface Bus {
  emit(name: string, payload: unknown): void;
  on(name: string, handler: unknown): unknown;
}
interface Store {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  subscribe(key: string, handler: unknown): unknown;
}
interface Fiber {
  return?: Fiber | null;
  memoizedProps?: { value?: unknown } | null;
}
function findHostObjects(chatId: string): { bus: Bus; store: Store } | null {
  try {
    const frame = [...window.parent.document.querySelectorAll("iframe")].find(
      (f) => f.contentWindow === window,
    );
    if (!frame) return null;
    const key = Object.keys(frame).find((k) => k.startsWith("__reactFiber$"));
    let fiber = key
      ? ((frame as unknown as Record<string, Fiber>)[key] ?? null)
      : null;
    let bus: Bus | undefined;
    let store: Store | undefined;
    for (
      let hops = 0;
      fiber && hops < 1000;
      hops++, fiber = fiber.return ?? null
    ) {
      const v = fiber.memoizedProps?.value as
        Record<string, unknown> | undefined;
      if (!v || typeof v !== "object") continue;
      if (!bus && typeof v.emit === "function" && typeof v.on === "function")
        bus = v as unknown as Bus;
      if (
        !store &&
        typeof v.get === "function" &&
        typeof v.set === "function" &&
        typeof v.subscribe === "function" &&
        (v as unknown as Store).get("activeSessionId") === chatId
      )
        store = v as unknown as Store;
      if (bus && store) return { bus, store };
    }
  } catch {
    /* cross-origin parent or unexpected tree */
  }
  return null;
}
/** Opens `/projects/...` in the chat's side panel and selects it. Returns false if the host can't be reached. */
export function openProjectInChatPanel(chatId: string, route: string): boolean {
  const host = findHostObjects(chatId);
  if (!host) return false;
  try {
    host.bus.emit("projects:opened", { paths: [route], force: true });
    host.store.set("followTargetPath", route);
    return host.store.get("followTargetPath") === route;
  } catch {
    return false;
  }
}
