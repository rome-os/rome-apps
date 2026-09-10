import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type ComboboxOption = {
  /** The stored value (also used for search matching). */
  value: string;
  /** What the user sees in the list and the trigger. Defaults to `value`. */
  label?: string;
  /** Extra terms cmdk should match on, beyond value/label. */
  keywords?: string[];
};

export type ComboboxGroup = {
  heading?: string;
  options: ComboboxOption[];
};

/**
 * Standard shadcn Combobox (Popover + cmdk Command): a searchable single-select.
 * Pass flat `options` or pre-`groups`; grouped headings render as cmdk groups.
 */
export function Combobox({
  value,
  onChange,
  options,
  groups,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options?: ComboboxOption[];
  groups?: ComboboxGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const resolvedGroups: ComboboxGroup[] = groups ?? [{ options: options ?? [] }];
  const selected = resolvedGroups
    .flatMap((g) => g.options)
    .find((o) => o.value === value);
  const triggerLabel = selected?.label ?? selected?.value ?? "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? triggerLabel : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {resolvedGroups.map((group, i) => (
              <CommandGroup key={group.heading ?? i} heading={group.heading}>
                {group.options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    keywords={opt.keywords}
                    onSelect={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("size-4", value === opt.value ? "opacity-100" : "opacity-0")}
                    />
                    {opt.label ?? opt.value}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
