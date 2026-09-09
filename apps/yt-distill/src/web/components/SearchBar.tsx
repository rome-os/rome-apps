import { Button } from "@rome-os/ui/button";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

/**
 * Compact in-view search control: an input, a match counter, prev/next
 * navigation (optional), and a clear button. Purely presentational — the parent
 * owns the query/active state and the actual highlighting.
 */
export function SearchBar({
  value,
  onChange,
  count,
  activeIndex,
  onPrev,
  onNext,
  onClear,
  showNav = true,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
  activeIndex: number;
  onPrev?: () => void;
  onNext?: () => void;
  onClear: () => void;
  showNav?: boolean;
  placeholder?: string;
}) {
  const hasQuery = value.trim().length > 0;
  return (
    <div className="flex items-center gap-1 rounded-md border bg-background px-2 py-1">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onKeyDown={(e) => {
          if (e.key === "Enter" && showNav) {
            e.preventDefault();
            if (e.shiftKey) onPrev?.();
            else onNext?.();
          } else if (e.key === "Escape") {
            onClear();
          }
        }}
      />
      {hasQuery ? (
        <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
          {showNav
            ? count > 0
              ? `${(((activeIndex % count) + count) % count) + 1}/${count}`
              : "0/0"
            : `${count} match${count === 1 ? "" : "es"}`}
        </span>
      ) : null}
      {showNav ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Previous match"
            disabled={count === 0}
            onClick={onPrev}
          >
            <ChevronUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Next match"
            disabled={count === 0}
            onClick={onNext}
          >
            <ChevronDown className="size-4" />
          </Button>
        </>
      ) : null}
      {hasQuery ? (
        <Button variant="ghost" size="icon" className="size-6" aria-label="Clear search" onClick={onClear}>
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
