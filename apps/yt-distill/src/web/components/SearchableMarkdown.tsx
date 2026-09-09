import { useEffect, useMemo, useRef, useState } from "react";
import { applyHighlights, clearHighlights, scrollActiveIntoView } from "../lib/highlight";
import { MarkdownView } from "./MarkdownView";
import { SearchBar } from "./SearchBar";

/**
 * MarkdownView with an in-view search box: highlights matches, shows a counter,
 * and supports prev/next navigation. The MarkdownView element is memoized by
 * `markdown`, so typing in the search box never re-renders (or clobbers) the
 * highlighted DOM — the highlight effect owns those nodes.
 */
export function SearchableMarkdown({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [count, setCount] = useState(0);

  const content = useMemo(() => <MarkdownView markdown={markdown} />, [markdown]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const n = applyHighlights(root, query, active);
    setCount(n);
    if (n > 0) scrollActiveIntoView(root);
    return () => {
      if (containerRef.current) clearHighlights(containerRef.current);
    };
  }, [query, active, markdown]);

  const clear = () => {
    setQuery("");
    setActive(0);
  };

  return (
    <div className={`rounded-lg border bg-card ${className ?? ""}`}>
      <div className="border-b p-2">
        <SearchBar
          value={query}
          onChange={(v) => {
            setQuery(v);
            setActive(0);
          }}
          count={count}
          activeIndex={active}
          onPrev={() => setActive((a) => a - 1)}
          onNext={() => setActive((a) => a + 1)}
          onClear={clear}
          placeholder="Search this text…"
        />
      </div>
      <div ref={containerRef} className="max-h-[80vh] overflow-y-auto p-4 md:p-6">
        {content}
      </div>
    </div>
  );
}
