"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type MultiSelectOption = { value: string; label: string };

export interface MultiSelectFilterProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  selectedCountLabel: (count: number) => string;
  placeholder: string;
  searchable?: boolean;
  triggerClassName?: string;
  /** Allow the last ticked box to be unticked. Defaults to false. */
  allowEmpty?: boolean;
}

/**
 * Multi-select filter, built on the same Popover + Command shell as the single-select
 * combobox (`SearchableCombobox`) rather than a new control idiom — the only real
 * differences are that a selection toggles membership instead of replacing it, and the
 * popover stays open across clicks so several boxes can be ticked in one pass.
 *
 * By default `selected` is guarded to NEVER become an empty array: unchecking the last
 * remaining box is a no-op. That refusal is a UX policy, not a correctness guard — an empty
 * result screen with every box unticked is a worse thing to hand an operator than simply
 * declining the last uncheck. `allowEmpty` opts out of it. A caller that enables
 * `allowEmpty` must make its own query layer read `[]` as "match nothing" (`in: []`), never
 * as "no filter", or an operator who unticks every box is handed the whole unfiltered set.
 *
 * Nothing is reported upward about "everything ticked" — there is no such callback. It is
 * simply `options.length === selected.length`, a test each CALLER recomputes on its own
 * `selected` state, and it is that caller's job to collapse the result back to "send
 * nothing" on the wire.
 */
export function MultiSelectFilter({
  options,
  selected,
  onChange,
  allLabel,
  selectedCountLabel,
  placeholder,
  searchable = false,
  triggerClassName,
  allowEmpty = false,
}: MultiSelectFilterProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const allSelected = selected.length === options.length;
  const label = allSelected
    ? allLabel
    : selected.length === 1
      ? options.find((opt) => opt.value === selected[0])?.label ?? selected[0]
      : selectedCountLabel(selected.length);

  const filtered = searchable
    ? options.filter((opt) => opt.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  function toggle(value: string) {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    if (next.length === 0 && !allowEmpty) return;
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "border-input flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm font-normal shadow-xs transition-[color,box-shadow] outline-none hover:bg-transparent focus-visible:ring-[3px] focus-visible:ring-ring/50",
            triggerClassName,
          )}
        >
          <span className="truncate">{label || placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[10rem] p-0" align="start">
        <Command shouldFilter={false}>
          {searchable && <CommandInput placeholder="Search..." value={query} onValueChange={setQuery} />}
          <CommandList aria-multiselectable="true">
            <CommandEmpty>No results found.</CommandEmpty>
            {/*
             * With `shouldFilter={false}`, cmdk's own "is there anything to show" count is
             * the number of mounted Item components, not our hand-filtered array — so
             * CommandEmpty only renders when NOTHING below is mounted either. The "All" row
             * used to be unconditional, which kept that count above zero even when a search
             * matched no option, leaving a lone "All" as the only clickable thing on screen
             * with no explanation for why it was alone. Gating both groups on the same
             * `filtered.length > 0` is what lets CommandEmpty actually fire.
             */}
            {filtered.length > 0 && (
              <>
                <CommandGroup>
                  <CommandItem
                    value={allLabel}
                    /* disabled, not just a no-op handler: this is the same prop
                       SearchableCombobox already uses for an inert row, so it gets that
                       row's "data-[disabled=true]:opacity-50" treatment for free — the
                       row reads as deliberately inert rather than stuck, and cmdk itself
                       refuses the click, so selecting an already-complete set never fires
                       onChange (no pointless refetch of up to 2000 rows for a no-op). */
                    disabled={allSelected}
                    onSelect={() => onChange(options.map((opt) => opt.value))}
                    className="min-h-[40px] font-medium"
                  >
                    <Checkbox checked={allSelected} tabIndex={-1} aria-hidden="true" className="pointer-events-none mr-2" />
                    <span className="truncate">{allLabel}</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup>
                  {filtered.map((opt) => {
                    const checked = selected.includes(opt.value);
                    return (
                      <CommandItem
                        key={opt.value}
                        value={opt.label}
                        aria-checked={checked}
                        onSelect={() => toggle(opt.value)}
                        className="min-h-[40px]"
                      >
                        <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" className="pointer-events-none mr-2" />
                        <span className="truncate">{opt.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
