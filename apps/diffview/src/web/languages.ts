// Deliberately curated, lazy grammar catalog. Unknown languages remain plain text.
const text = async () => ({ default: [] });
export const bundledLanguages = new Proxy(
  {
    javascript: () => import("shiki/langs/javascript.mjs"),
    typescript: () => import("shiki/langs/typescript.mjs"),
    tsx: () => import("shiki/langs/tsx.mjs"),
    jsx: () => import("shiki/langs/jsx.mjs"),
    json: () => import("shiki/langs/json.mjs"),
    css: () => import("shiki/langs/css.mjs"),
    html: () => import("shiki/langs/html.mjs"),
    markdown: () => import("shiki/langs/markdown.mjs"),
    yaml: () => import("shiki/langs/yaml.mjs"),
    python: () => import("shiki/langs/python.mjs"),
    bash: () => import("shiki/langs/bash.mjs"),
  },
  {
    get: (obj, key) => Reflect.get(obj, key) ?? text,
    getOwnPropertyDescriptor: (obj, key) =>
      Reflect.getOwnPropertyDescriptor(obj, key) ?? {
        configurable: true,
        enumerable: true,
        value: text,
      },
  },
);
