/** Deterministic hook/JSX harness. No browser, host SDK, network or real settings. */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Node = { type: any; props: any; key?: unknown };
export function uiHarness() {
  const slots: any[] = [], effects: Array<() => void> = [], calls: Array<{ input: any; resolve: (x: any) => void; reject: (x: Error) => void }> = [];
  let index = 0, writes = 0;
  const react = {
    useState(init: any) { const i = index++; if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init; return [slots[i], (value: any) => { writes++; slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(init: any) { const i = index++; return slots[i] ??= { current: init }; },
    useEffect(fn: () => any, deps: unknown[]) { const i = index++, old = slots[i]; if (!old || deps.some((v, k) => v !== old.deps[k])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const node = (type: unknown, props: unknown, key?: unknown) => ({ type, props, key });
  const common = new Proxy({}, { get: (_, key) => key });
  const api = {
    formatUsd: (v: unknown) => v == null ? "—" : `$${v}`,
    api: async (route: string) => {
      const path = new URLSearchParams(route.split("?")[1]).get("path");
      return { method: "get", path, summary: path, safety: { sensitive: false, reasons: [] }, parameters: [], price: { costUsd: .001 }, example: {}, docsUrl: "https://docs.tikhub.io/" };
    },
    postJson: (_route: string, input: any) => new Promise((resolve, reject) => { calls.push({ input, resolve, reject }); }),
  };
  const modules = new Map<string, any>();
  function load(filename: string): any {
    if (modules.has(filename)) return modules.get(filename);
    const exports = {}; modules.set(filename, exports);
    const source = readFileSync(filename, "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(js, { exports, URLSearchParams, console, require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: node, jsxs: node };
      if (name === "@rome-os/app-web-sdk") return { navigateToApp() {} };
      if (name.startsWith(".")) {
        const target = resolve(dirname(filename), name.replace(/\.js$/, ""));
        if (target.endsWith("/web/api")) return api;
        if (target.endsWith("/web/i18n")) return { useI18n: () => ({ t: (k: string, vars?: unknown) => k + (vars ? JSON.stringify(vars) : "") }) };
        if (target.endsWith("/lib/safety")) return { isPrivateField: () => false };
        if (target.endsWith("/hooks/useEndpointCall") || target.endsWith("/lib/cost")) return load(target + ".ts");
        if (target.endsWith("/components/CostValue")) return load(target + ".tsx");
      }
      return common;
    } }, { filename });
    return exports;
  }
  const endpoint = load(resolve("src/web/components/EndpointDetail.tsx"));
  function render(path: string) {
    index = 0;
    const tree = endpoint.EndpointDetail({ method: "get", path, settings: { configured: true } });
    while (effects.length) effects.shift()!();
    return tree;
  }
  function find(tree: any, predicate: (n: Node) => boolean): Node | null {
    if (!tree || typeof tree !== "object") return null;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
    return null;
  }
  function text(tree: any): string {
    if (tree == null) return "";
    if (Array.isArray(tree)) return tree.map(text).join(" ");
    if (typeof tree !== "object") return String(tree);
    if (typeof tree.type === "function") return text(tree.type(tree.props));
    return text(tree.props?.children);
  }
  function unmount() { for (const slot of slots) slot?.cleanup?.(); }
  return { render, find, text, calls, unmount, writes: () => writes, renderOutcome: endpoint.OutcomeView, load, flush: async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); } };
}
