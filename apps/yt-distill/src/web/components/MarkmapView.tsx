import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@rome-os/ui/button";
import { Spinner } from "@rome-os/ui/spinner";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  List,
  Maximize2,
  Minimize2,
  Network,
  Scan,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { loadScript, loadScriptsSequential } from "../lib/scriptLoader";
import { SearchableMarkdown } from "./SearchableMarkdown";
import { SearchBar } from "./SearchBar";

// Exact versions + SRI hashes: the CDN cannot silently ship different bytes.
// To upgrade, bump the version and recompute the hash:
//   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
const D3 = {
  src: "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js",
  integrity: "sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i",
};
const MARKMAP_VIEW = {
  src: "https://cdn.jsdelivr.net/npm/markmap-view@0.18.12/dist/browser/index.js",
  integrity: "sha384-p+gyhsDIg0RmvIKRr9BBGSyJ9NDDkiFsbilRwdZd20Q8mUL2v7e8+orY4pvTV52w",
};
const MARKMAP_LIB = {
  src: "https://cdn.jsdelivr.net/npm/markmap-lib@0.18.12/dist/browser/index.iife.js",
  integrity: "sha384-ZlXKtR0wcZqxEYI8i3TPFFiOJR1MEdIzdVvnhSOonCrPsBup4dnkRw49FeYhfsHF",
};

interface MarkmapNode {
  content?: string;
  children?: MarkmapNode[];
  payload?: { fold?: number } & Record<string, unknown>;
  /** Layout state written by markmap after each render. */
  state?: { rect: { x: number; y: number; width: number; height: number } };
}

interface D3Selection {
  transition: () => { duration: (ms: number) => { call: (fn: unknown, arg: unknown) => unknown } };
}

interface D3Global {
  zoomTransform: (el: Element) => { k: number; x: number; y: number };
  zoomIdentity: { translate: (x: number, y: number) => { scale: (k: number) => unknown } };
}

interface MarkmapInstance {
  fit: () => void;
  rescale: (scale: number) => void;
  setData: (data: unknown) => void;
  toggleNode: (node: MarkmapNode, recursive?: boolean) => Promise<void>;
  destroy?: () => void;
  /** Internals used to drive the viewport ourselves (stable in markmap-view 0.18). */
  svg: D3Selection & { node: () => SVGSVGElement };
  zoom: { transform: unknown };
}

/** Focus animation: how much of the viewport the opened branch may occupy. */
const FOCUS_FILL = 0.9;
/** Minimum zoom applied when focusing a branch (a touch larger than 1:1 so it reads as "focused"). */
const FOCUS_MIN_ZOOM = 1.35;
const FOCUS_DURATION = 320;

interface MarkmapGlobal {
  Transformer: new () => { transform: (md: string) => { root: MarkmapNode } };
  Markmap: {
    create: (svg: SVGElement, opts: unknown, data: unknown) => MarkmapInstance;
  };
}

async function ensureMarkmap(): Promise<MarkmapGlobal> {
  await loadScript(D3.src, D3.integrity);
  await loadScriptsSequential([MARKMAP_VIEW, MARKMAP_LIB]);
  const mk = (window as unknown as { markmap?: MarkmapGlobal }).markmap;
  if (!mk?.Transformer || !mk?.Markmap) throw new Error("markmap failed to load");
  return mk;
}

/**
 * markmap renders node labels as HTML. The Markdown comes from the model (fed
 * an arbitrary YouTube transcript), so escape every "<" before rendering: no
 * tag can survive, while plain Markdown (bold, links, code) still works and a
 * literal "<" still displays as "<".
 */
function escapeHtmlTags(md: string): string {
  return md.replace(/</g, "&lt;");
}

/** Fold (collapse) or unfold (expand) every node with children; the root stays open. */
function setFoldAll(node: MarkmapNode, fold: boolean, depth = 0): void {
  if (!node.children || node.children.length === 0) return;
  node.payload = { ...(node.payload ?? {}), fold: depth >= 1 && fold ? 1 : 0 };
  for (const child of node.children) setFoldAll(child, fold, depth + 1);
}

/** Bounding box (in map coordinates) of a node plus all of its currently visible descendants. */
function visibleSubtreeBox(node: MarkmapNode): { x1: number; y1: number; x2: number; y2: number } | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const walk = (n: MarkmapNode) => {
    const r = n.state?.rect;
    if (r) {
      x1 = Math.min(x1, r.x);
      y1 = Math.min(y1, r.y);
      x2 = Math.max(x2, r.x + r.width);
      y2 = Math.max(y2, r.y + r.height);
    }
    if (n.payload?.fold) return; // collapsed → children are not rendered
    for (const c of n.children ?? []) walk(c);
  };
  walk(node);
  if (!Number.isFinite(x1)) return null;
  return { x1, y1, x2, y2 };
}

/**
 * Pan/zoom so the node's open branch sits in the middle of the canvas. The rest
 * of the map is allowed to drift off-screen. Zooms out only when the branch is
 * larger than the viewport; otherwise keeps the user's zoom (at least FOCUS_MIN_ZOOM).
 */
function focusSubtree(mm: MarkmapInstance, node: MarkmapNode): void {
  const d3 = (window as unknown as { d3?: D3Global }).d3;
  if (!d3) return;
  const box = visibleSubtreeBox(node);
  if (!box) return;
  const svgEl = mm.svg.node();
  const { width: W, height: H } = svgEl.getBoundingClientRect();
  if (!W || !H) return;
  const bw = Math.max(1, box.x2 - box.x1);
  const bh = Math.max(1, box.y2 - box.y1);
  const fitK = Math.min((W * FOCUS_FILL) / bw, (H * FOCUS_FILL) / bh);
  const currentK = d3.zoomTransform(svgEl).k;
  const k = Math.min(fitK, Math.max(currentK, FOCUS_MIN_ZOOM));
  const cx = (box.x1 + box.x2) / 2;
  const cy = (box.y1 + box.y2) / 2;
  const t = d3.zoomIdentity.translate(W / 2 - k * cx, H / 2 - k * cy).scale(k);
  mm.svg.transition().duration(FOCUS_DURATION).call(mm.zoom.transform, t);
}

/** Plain lowercase text of a node's (HTML) label. */
function nodeText(node: MarkmapNode): string {
  const div = document.createElement("div");
  div.innerHTML = node.content ?? "";
  return (div.textContent ?? "").toLowerCase();
}

/**
 * Fold the tree so only branches containing a match stay expanded. Returns the
 * number of matching nodes.
 */
function foldToMatches(node: MarkmapNode, query: string): { has: boolean; count: number } {
  const selfMatch = query.length > 0 && nodeText(node).includes(query);
  let count = selfMatch ? 1 : 0;
  let childHas = false;
  for (const child of node.children ?? []) {
    const r = foldToMatches(child, query);
    count += r.count;
    if (r.has) childHas = true;
  }
  const has = selfMatch || childHas;
  if (node.children && node.children.length > 0) {
    node.payload = { ...(node.payload ?? {}), fold: has ? 0 : 1 };
  }
  return { has, count };
}

export function MarkmapView({ markdown }: { markdown: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const mmRef = useRef<MarkmapInstance | null>(null);
  const rootRef = useRef<MarkmapNode | null>(null);

  const [view, setView] = useState<"map" | "outline">("map");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const [mapQuery, setMapQuery] = useState("");
  const [mapCount, setMapCount] = useState(0);

  useEffect(() => {
    if (view !== "map") return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    ensureMarkmap()
      .then((mk) => {
        if (cancelled || !svgRef.current) return;
        svgRef.current.innerHTML = "";
        const transformer = new mk.Transformer();
        const { root } = transformer.transform(escapeHtmlTags(markdown));
        rootRef.current = root;
        // Start with every branch collapsed (root + its top-level nodes visible).
        setFoldAll(root, true);
        // autoFit is off on purpose: after a click we focus the opened branch
        // instead of re-fitting the whole map.
        const mm = mk.Markmap.create(svgRef.current, { autoFit: false, duration: 250 }, root);
        mmRef.current = mm;
        // Wrap node toggling (what a click on a node's circle does) so the
        // branch that was just opened/closed is centred on the canvas.
        const originalToggle = mm.toggleNode.bind(mm);
        mm.toggleNode = async (node, recursive) => {
          await originalToggle(node, recursive);
          if (mmRef.current === mm) focusSubtree(mm, node);
        };
        mm.fit();
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
      mmRef.current?.destroy?.();
      mmRef.current = null;
    };
  }, [markdown, view]);

  // Keep fullscreen state in sync and refit when it changes.
  useEffect(() => {
    const onChange = () => {
      const full = document.fullscreenElement === wrapRef.current;
      setIsFull(full);
      setTimeout(() => mmRef.current?.fit(), 120);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const fit = useCallback(() => mmRef.current?.fit(), []);
  const zoomIn = useCallback(() => mmRef.current?.rescale(1.25), []);
  const zoomOut = useCallback(() => mmRef.current?.rescale(0.8), []);

  const collapseAll = useCallback(() => {
    if (!rootRef.current || !mmRef.current) return;
    setFoldAll(rootRef.current, true);
    mmRef.current.setData(rootRef.current);
    setTimeout(() => mmRef.current?.fit(), 60);
  }, []);
  const expandAll = useCallback(() => {
    if (!rootRef.current || !mmRef.current) return;
    setFoldAll(rootRef.current, false);
    mmRef.current.setData(rootRef.current);
    setTimeout(() => mmRef.current?.fit(), 60);
  }, []);

  // Highlight node labels whose text matches the query (post-render).
  const highlightNodes = useCallback((query: string) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.querySelectorAll<HTMLElement>("[data-yt-node-hl]").forEach((el) => {
      el.style.background = "";
      el.removeAttribute("data-yt-node-hl");
    });
    if (!query) return;
    svg.querySelectorAll<HTMLElement>("foreignObject div").forEach((div) => {
      if ((div.textContent ?? "").toLowerCase().includes(query)) {
        div.style.background = "rgba(245,158,11,.45)";
        div.style.borderRadius = "3px";
        div.setAttribute("data-yt-node-hl", "");
      }
    });
  }, []);

  const runMapSearch = useCallback(
    (raw: string) => {
      setMapQuery(raw);
      const root = rootRef.current;
      const mm = mmRef.current;
      if (!root || !mm) return;
      const query = raw.trim().toLowerCase();
      if (!query) {
        // Clearing the search returns to the collapsed default.
        setFoldAll(root, true);
        mm.setData(root);
        setMapCount(0);
        setTimeout(() => {
          mm.fit();
          highlightNodes("");
        }, 60);
        return;
      }
      const { count } = foldToMatches(root, query);
      root.payload = { ...(root.payload ?? {}), fold: 0 };
      mm.setData(root);
      setMapCount(count);
      setTimeout(() => {
        mm.fit();
        highlightNodes(query);
      }, 90);
    },
    [highlightNodes],
  );

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen?.();
  }, []);

  return (
    <div
      ref={wrapRef}
      className={`overflow-hidden rounded-lg border bg-card ${isFull ? "flex h-screen flex-col" : ""}`}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-2 py-1.5">
        <div className="inline-flex overflow-hidden rounded-md border">
          <Button
            variant={view === "map" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("map")}
          >
            <Network className="size-4" /> Mindmap
          </Button>
          <Button
            variant={view === "outline" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("outline")}
          >
            <List className="size-4" /> Outline
          </Button>
        </div>

        {view === "map" ? (
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" title="Expand all" aria-label="Expand all" onClick={expandAll}>
              <ChevronsUpDown className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Collapse all" aria-label="Collapse all" onClick={collapseAll}>
              <ChevronsDownUp className="size-4" />
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button variant="ghost" size="icon" title="Zoom out" aria-label="Zoom out" onClick={zoomOut}>
              <ZoomOut className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Zoom in" aria-label="Zoom in" onClick={zoomIn}>
              <ZoomIn className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Fit to view" aria-label="Fit to view" onClick={fit}>
              <Scan className="size-4" />
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              title={isFull ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFull ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFull}
            >
              {isFull ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Map search row (filters the tree to matching branches) */}
      {view === "map" ? (
        <div className="border-b px-2 py-1.5">
          <div className="max-w-xs">
            <SearchBar
              value={mapQuery}
              onChange={runMapSearch}
              count={mapCount}
              activeIndex={0}
              onClear={() => runMapSearch("")}
              showNav={false}
              placeholder="Search nodes… (collapses to matches)"
            />
          </div>
        </div>
      ) : null}

      {/* Body */}
      {view === "outline" ? (
        <SearchableMarkdown markdown={markdown} className="rounded-none border-0" />
      ) : (
        <div className={`relative ${isFull ? "min-h-0 flex-1" : ""}`}>
          {loading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-muted-foreground">
              <Spinner size="sm" /> Rendering mind map…
            </div>
          ) : null}
          {error ? (
            <div className="p-4 text-sm text-destructive">Could not render the mind map: {error}</div>
          ) : (
            <svg
              ref={svgRef}
              className={isFull ? "h-full w-full" : "h-[80vh] w-full"}
              role="img"
              aria-label="Mind map"
            />
          )}
        </div>
      )}
    </div>
  );
}
