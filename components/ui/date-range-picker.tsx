"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { toDisplayDate } from "@/lib/date-only";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface DateRangePickerProps {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
  triggerClassName?: string;
  numberOfMonths?: number;
}

function formatRangeLabel(range: DateRange | undefined, placeholder: string): string {
  if (!range?.from) return placeholder;
  if (!range.to) return toDisplayDate(range.from);
  return `${toDisplayDate(range.from)} – ${toDisplayDate(range.to)}`;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  disabled = false,
  className,
  id,
  "aria-invalid": ariaInvalid,
  triggerClassName,
  numberOfMonths: numberOfMonthsProp,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [months, setMonths] = React.useState(2);

  React.useEffect(() => {
    if (numberOfMonthsProp != null) {
      setMonths(numberOfMonthsProp);
      return;
    }
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setMonths(mq.matches ? 2 : 1);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [numberOfMonthsProp]);

  const displayLabel = formatRangeLabel(value, placeholder);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          disabled={disabled}
          data-empty={!value?.from}
          className={cn(
            "border-input flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm font-normal shadow-xs transition-[color,box-shadow] outline-none hover:bg-transparent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[empty=true]:text-muted-foreground",
            triggerClassName,
            className
          )}
        >
          <span className="truncate text-left">{displayLabel}</span>
          <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          defaultMonth={value?.from}
          numberOfMonths={months}
          onSelect={(range) => {
            onChange(range);
            if (range?.from && range?.to) {
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
