import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@rome-os/ui/popover";
import { cn } from "@rome-os/ui/cn";
import type { CatalogInfo } from "../api";
import { useI18n } from "../i18n";

type Platform = CatalogInfo["platforms"][number];

/**
 * Platform picker built on Popover instead of Select: Radix Select closes on
 * window resize (mobile address-bar collapse while scrolling) and its
 * item-aligned mode fights touch scrolling. Popover only closes on an outside
 * tap / Escape, and the list scrolls natively without dragging the page.
 */
export function PlatformPicker({
  platforms,
  value,
  onChange,
}: {
  platforms: Platform[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const name = (p: Platform) => p.label;
  const [open, setOpen] = useState(false);
  const current = platforms.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={t("explorer.platform")}
          aria-haspopup="listbox"
          className="w-full justify-between sm:w-56"
          disabled={platforms.length === 0}
        >
          <span className="truncate">{current ? `${name(current)} · ${current.operations}` : t("explorer.choosePlatform")}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-2rem)] gap-0 p-1">
        <div
          role="listbox"
          aria-label={t("explorer.platform")}
          className="max-h-[min(60vh,26rem)] touch-pan-y overflow-y-auto overscroll-contain"
        >
          {platforms.map((p) => {
            const selected = p.id === value;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-8 px-3 py-2 text-left text-ui hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  selected && "bg-accent",
                )}
                onClick={() => {
                  setOpen(false);
                  if (!selected) onChange(p.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{name(p)}</span>
                <span className="text-aux text-muted-foreground">{p.operations}</span>
                <Check className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
