import {
  CodeView,
  WorkerPoolContextProvider,
  type CodeViewHandle,
} from "@pierre/diffs/react";
import {
  parsePatchFiles,
  getFiletypeFromFileName,
  type CodeViewItem,
  registerCustomCSSVariableTheme,
} from "@pierre/diffs";
import { useRef, useCallback, type ReactNode, type Ref } from "react";
import type { CodeView as CodeViewInstance } from "@pierre/diffs";
import { reviewCSS } from "./rendererStyles";
import { messages, type Messages } from "./i18n";
import type { Loaded } from "./types";
const syntax: Record<string, string> = {
  foreground: "var(--foreground)",
  background: "var(--app-canvas)",
};
for (const key of [
  "comment",
  "punctuation",
  "link",
  "string",
  "string-expression",
  "keyword",
  "constant",
  "parameter",
  "function",
  "inserted",
  "deleted",
])
  syntax["token-" + key] =
    key === "comment"
      ? "var(--muted-foreground)"
      : key === "keyword"
        ? "var(--primary)"
        : key === "inserted" || key.startsWith("string")
          ? "var(--success)"
          : key === "deleted"
            ? "var(--destructive)"
            : key === "constant"
              ? "var(--info)"
              : "var(--foreground)";
registerCustomCSSVariableTheme("rome-review", syntax, false);

export function Pool({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{
        poolSize: 2,
        mainThreadMaxCharacters: 0,
        workerFactory: () =>
          new Worker(
            // Use the self-contained entry: Rslib shares dependencies across UI/worker
            // graphs. The modular worker entry can then be imported back into Window
            // by a shared chunk, installing a self-posting error loop on the page.
            new URL("@pierre/diffs/worker/worker-portable.js", import.meta.url),
            { type: "module" },
          ),
      }}
      highlighterOptions={{
        preferredHighlighter: "shiki-js",
        lineDiffType: "word",
        langs: [],
        theme: "rome-review",
      }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
export function patchItem(
  id: string,
  patch: string,
  version = 0,
): CodeViewItem<undefined> | undefined {
  const fileDiff = parsePatchFiles(patch, id + ":" + version, true).flatMap(
    (p) => p.files,
  )[0];
  if (fileDiff) {
    const lang = getFiletypeFromFileName(fileDiff.name);
    if (
      ![
        "javascript",
        "typescript",
        "tsx",
        "jsx",
        "json",
        "css",
        "html",
        "markdown",
        "yaml",
        "python",
        "bash",
      ].includes(lang)
    )
      fileDiff.lang = "text";
  }
  return fileDiff ? { id, type: "diff", fileDiff, version } : undefined;
}
export function Viewer({
  items,
  handle,
  dark = false,
  split = false,
  expanded = false,
  wrap = false,
  header,
  onScroll,
  onContext,
  records = {},
  t = messages(false),
}: {
  items: CodeViewItem<undefined>[];
  handle?: Ref<CodeViewHandle<undefined, undefined>>;
  dark?: boolean;
  split?: boolean;
  expanded?: boolean;
  wrap?: boolean;
  header?: (item: CodeViewItem<undefined>) => ReactNode;
  onScroll?: (
    top: number,
    viewer: CodeViewInstance<undefined, undefined>,
  ) => void;
  onContext?: (path: string, direction: "up" | "down" | "all") => void;
  records?: Record<string, Loaded>;
  t?: Messages;
}) {
  const live = useRef({ records, t, onContext });
  live.current = { records, t, onContext };
  const decorate = useCallback(
    (
      node: HTMLElement,
      _instance: unknown,
      _phase: unknown,
      context: { item: CodeViewItem<undefined> },
    ) => {
      const shadow = node.shadowRoot;
      if (!shadow) return;
      if (
        context.item.collapsed ||
        _phase === "unmount" ||
        context.item.type !== "diff"
      ) {
        shadow.querySelector("[data-review-tail]")?.remove();
        return;
      }
      const diff = context.item.fileDiff;
      const current = live.current;
      const makeBar = (
        el: HTMLElement,
        count: number | undefined,
        tail = false,
        gutter = false,
      ) => {
        const existing = el.querySelector(".dv-context");
        if (existing) {
          const label = existing.querySelector("span");
          if (label)
            label.textContent =
              count !== undefined
                ? current.t.unmodified.replace("{n}", String(count))
                : current.t.moreContext;
          return;
        }
        const bar = document.createElement("div");
        bar.className = "dv-context";
        bar.dataset.contextFile = context.item.id;
        const button = (direction: "up" | "down", points: string) => {
          const b = document.createElement("button");
          b.type = "button";
          b.title = current.t.expandTwenty;
          b.setAttribute(
            "aria-label",
            current.t.expandTwenty +
              " " +
              (direction === "up" ? current.t.before : current.t.after),
          );
          b.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="' +
            points +
            '"/></svg>';
          b.onclick = () =>
            live.current.onContext?.(context.item.id, direction);
          return b;
        };
        if (!tail && gutter) bar.append(button("up", "m6 15 6-6 6 6"));
        const label = document.createElement("span");
        label.textContent =
          count !== undefined
            ? current.t.unmodified.replace("{n}", String(count))
            : current.t.moreContext;
        if (!gutter) {
          bar.append(label);
          bar.append(button("down", "m6 9 6 6 6-6"));
        }
        el.append(bar);
      };
      const separators = [
        ...shadow.querySelectorAll<HTMLElement>("[data-separator]"),
      ];
      for (let i = 0; i < separators.length; i++) {
        const el = separators[i];
        const specs = el
          .querySelector("[data-separator-wrapper]")
          ?.textContent?.trim();
        const h = diff.hunks.find((h) => h.hunkSpecs?.trim() === specs);
        makeBar(
          el,
          h?.collapsedBefore || undefined,
          false,
          !!el.closest("[data-gutter]"),
        );
      }
      const last = diff.hunks.at(-1);
      const record = current.records[context.item.id];
      const lastLine = last ? last.additionStart + last.additionCount - 1 : 0;
      const omitted =
        record?.totalLines !== undefined
          ? Math.max(0, record.totalLines - lastLine)
          : undefined;
      const oldTail = shadow.querySelector<HTMLElement>("[data-review-tail]");
      if (last && (omitted === undefined ? !!diff.newObjectId : omitted > 0)) {
        const tail = oldTail || document.createElement("div");
        tail.dataset.reviewTail = "";
        tail.style.padding = "3px 10px";
        makeBar(tail, omitted, true);
        if (!oldTail) shadow.append(tail);
      } else oldTail?.remove();
    },
    [],
  );
  return (
    <CodeView
      ref={handle}
      items={items}
      style={{
        height: "100%",
        minHeight: 0,
        overflow: "auto",
        scrollbarColor: "var(--border) transparent",
        scrollbarWidth: "thin",
      }}
      onScroll={onScroll}
      options={{
        preferredHighlighter: "shiki-js",
        themeType: dark ? "dark" : "light",
        theme: "rome-review",
        lineDiffType: "word",
        maxLineDiffLength: 500,
        tokenizeMaxLineLength: 2000,
        diffStyle: split ? "split" : "unified",
        diffIndicators: "bars",
        overflow: wrap ? "wrap" : "scroll",
        expandUnchanged: false,
        collapsedContextThreshold: expanded ? 10001 : 6,
        hunkSeparators: "metadata",
        stickyHeaders: true,
        itemMetrics: {
          lineHeight: 26,
          diffHeaderHeight: 44,
          hunkSeparatorHeight: 38,
          spacing: 0,
        },
        layout: { gap: 0, paddingTop: 0, paddingBottom: 0 },
        unsafeCSS: reviewCSS,
        onPostRender: decorate,
      }}
      renderCustomHeader={header}
    />
  );
}
export function Spike() {
  const items = Array.from({ length: 200 }, (_, i) =>
    patchItem(
      "src/file-" + i + ".ts",
      `diff --git a/src/file-${i}.ts b/src/file-${i}.ts\n--- a/src/file-${i}.ts\n+++ b/src/file-${i}.ts\n@@ -1,13 +1,13 @@\n${Array.from({ length: 13 }, (_, n) => "-export const old" + n + " = " + n + ";\n").join("")}${Array.from({ length: 13 }, (_, n) => "+export const fresh" + n + " = " + n + ";\n").join("")}`,
    )!,
  ).filter(Boolean);
  return (
    <Pool>
      <div data-spike style={{ height: "90vh" }}>
        <Viewer items={items} />
      </div>
    </Pool>
  );
}
