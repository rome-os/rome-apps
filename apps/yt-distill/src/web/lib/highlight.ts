/**
 * DOM text highlighting used by the in-view search boxes. It wraps matches of a
 * query in <mark> elements with inline styles (no CSS plumbing needed) and marks
 * one as the "active" match for prev/next navigation.
 *
 * Safe to mutate the DOM here ONLY because callers render the searched content
 * via a memoized element, so React does not re-render (and therefore does not
 * reconcile against) the nodes we mutate.
 */

const HL_ATTR = "data-yt-hl";
const ACTIVE_ATTR = "data-yt-active";
const IDX_ATTR = "data-yt-index";

const BASE_STYLE = "background: rgba(234,179,8,.35); border-radius: 2px; padding: 0 1px;";
const ACTIVE_STYLE = "background: rgb(245,158,11); color: #111; border-radius: 2px; padding: 0 1px;";

/** Remove all highlight <mark> wrappers, restoring plain text. */
export function clearHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll(`mark[${HL_ATTR}]`);
  marks.forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
    parent.normalize();
  });
}

/**
 * Wrap every case-insensitive occurrence of `query` inside `root` in a styled
 * <mark>. Marks the match at `activeIndex` (wrapped) as active. Returns the
 * total match count.
 */
export function applyHighlights(root: HTMLElement, query: string, activeIndex: number): number {
  clearHighlights(root);
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const value = node.nodeValue;
      if (!value || !value.toLowerCase().includes(q)) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent || parent.closest("script,style,mark")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  let count = 0;
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    const low = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let i = 0;
    let idx = low.indexOf(q, i);
    while (idx !== -1) {
      if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
      const mark = document.createElement("mark");
      mark.setAttribute(HL_ATTR, "");
      mark.setAttribute(IDX_ATTR, String(count));
      mark.style.cssText = BASE_STYLE;
      mark.textContent = text.slice(idx, idx + q.length);
      frag.appendChild(mark);
      count++;
      i = idx + q.length;
      idx = low.indexOf(q, i);
    }
    if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  if (count > 0) {
    const active = ((activeIndex % count) + count) % count;
    const el = root.querySelector<HTMLElement>(`mark[${HL_ATTR}][${IDX_ATTR}="${active}"]`);
    if (el) {
      el.setAttribute(ACTIVE_ATTR, "");
      el.style.cssText = ACTIVE_STYLE;
    }
  }
  return count;
}

/** Scroll the active match into the middle of its scroll container. */
export function scrollActiveIntoView(root: HTMLElement): void {
  const el = root.querySelector<HTMLElement>(`mark[${ACTIVE_ATTR}]`);
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}
