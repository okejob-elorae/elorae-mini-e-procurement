"use client";

import * as React from "react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { toDisplayDate } from "@/lib/date-only";
import {
  DATE_RANGE_PRESETS,
  type DateRangePresetId,
  resolveDateRangePreset,
} from "@/lib/date-range-presets";
import {
  buildAppliedRange,
  formatTimeDisplay,
  rangeHasExplicitTime,
  toTimeInputValue,
} from "@/lib/date-range-time";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";

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
  /** When true, shows an include-time toggle and time inputs inside the popover. */
  allowTime?: boolean;
  /** Show preset shortcuts in the left sidebar. Default true. */
  showPresets?: boolean;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

type DraftState = {
  range: DateRange | undefined;
  includeTime: boolean;
  startTime: string;
  endTime: string;
  activePreset: DateRangePresetId | null;
};

const DEFAULT_END_TIME = "23:59";

function formatRangeLabel(
  range: DateRange | undefined,
  placeholder: string,
  showTimeInLabel: boolean
): string {
  if (!range?.from) return placeholder;
  const fromLabel = toDisplayDate(range.from);
  const toDate = range.to;
  const toLabel = toDate ? toDisplayDate(toDate) : null;

  if (!toLabel || !toDate) {
    if (showTimeInLabel && rangeHasExplicitTime({ from: range.from })) {
      return `${fromLabel} ${formatTimeDisplay(range.from)}`;
    }
    return fromLabel;
  }

  const fromTime =
    showTimeInLabel && rangeHasExplicitTime({ from: range.from })
      ? ` ${formatTimeDisplay(range.from)}`
      : "";
  const toTime =
    showTimeInLabel && rangeHasExplicitTime({ to: toDate })
      ? ` ${formatTimeDisplay(toDate)}`
      : "";

  return `${fromLabel}${fromTime} – ${toLabel}${toTime}`;
}

function draftFromValue(value: DateRange | undefined, allowTime: boolean): DraftState {
  const includeTime = allowTime && rangeHasExplicitTime(value);
  return {
    range: value,
    includeTime,
    startTime: value?.from ? toTimeInputValue(value.from) : "00:00",
    endTime: value?.to ? toTimeInputValue(value.to) : DEFAULT_END_TIME,
    activePreset: null,
  };
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
  allowTime = false,
  showPresets = true,
  weekStartsOn = 1,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [months, setMonths] = React.useState(2);
  const [presetQuery, setPresetQuery] = React.useState("");
  const [draft, setDraft] = React.useState<DraftState>(() => draftFromValue(value, allowTime));

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

  React.useEffect(() => {
    if (!open) return;
    setDraft(draftFromValue(value, allowTime));
    setPresetQuery("");
  }, [open, value, allowTime]);

  const filteredPresets = React.useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    if (!q) return DATE_RANGE_PRESETS;
    return DATE_RANGE_PRESETS.filter((preset) => preset.label.toLowerCase().includes(q));
  }, [presetQuery]);

  const displayLabel = formatRangeLabel(
    value,
    placeholder,
    allowTime && rangeHasExplicitTime(value)
  );

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setDraft(draftFromValue(value, allowTime));
      setPresetQuery("");
    }
  };

  const handlePresetSelect = (presetId: DateRangePresetId) => {
    const resolved = resolveDateRangePreset(presetId, { weekStartsOn });
    setDraft((prev) => ({
      ...prev,
      range: { from: resolved.from, to: resolved.to },
      activePreset: presetId,
    }));
  };

  const handleApply = () => {
    const applied = buildAppliedRange(
      draft.range,
      allowTime && draft.includeTime,
      draft.startTime,
      draft.endTime
    );
    onChange(applied);
    setOpen(false);
  };

  const canApply = Boolean(draft.range?.from && draft.range?.to);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
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
      <PopoverContent
        className="w-auto max-w-[min(100vw-1.5rem,56rem)] overflow-hidden p-0"
        align="start"
      >
        <div className="flex max-h-[min(85vh,40rem)] flex-col sm:flex-row">
          {showPresets ? (
            <div className="flex w-full shrink-0 flex-col border-b sm:w-52 sm:border-r sm:border-b-0">
              <div className="border-b p-2">
                <p className="px-1 pb-2 text-sm font-medium">Date range</p>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={presetQuery}
                    onChange={(e) => setPresetQuery(e.target.value)}
                    placeholder="Search presets"
                    className="h-8 pl-8"
                    aria-label="Search date presets"
                  />
                </div>
              </div>
              <ScrollArea className="h-56 sm:h-auto sm:max-h-[22rem] sm:flex-1">
                <div className="space-y-0.5 p-2">
                  {filteredPresets.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">No presets found</p>
                  ) : (
                    filteredPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePresetSelect(preset.id)}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                          draft.activePreset === preset.id &&
                            "bg-accent font-medium text-accent-foreground"
                        )}
                      >
                        {preset.label}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="overflow-x-auto p-1">
              <Calendar
                mode="range"
                selected={draft.range}
                defaultMonth={draft.range?.from ?? value?.from}
                numberOfMonths={months}
                onSelect={(range) => {
                  setDraft((prev) => ({
                    ...prev,
                    range,
                    activePreset: null,
                  }));
                }}
              />
            </div>

            <div className="space-y-3 border-t p-3">
              {allowTime ? (
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`${id ?? "date-range"}-include-time`} className="text-sm">
                    Include time
                  </Label>
                  <Switch
                    id={`${id ?? "date-range"}-include-time`}
                    checked={draft.includeTime}
                    onCheckedChange={(checked) => {
                      setDraft((prev) => ({
                        ...prev,
                        includeTime: checked,
                        startTime: checked ? prev.startTime : "00:00",
                        endTime: checked ? prev.endTime : "00:00",
                      }));
                    }}
                  />
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`${id ?? "date-range"}-start-date`} className="text-xs text-muted-foreground">
                    Start date
                  </Label>
                  <Input
                    id={`${id ?? "date-range"}-start-date`}
                    readOnly
                    value={draft.range?.from ? toDisplayDate(draft.range.from) : ""}
                    placeholder="—"
                    className="h-8 bg-muted/30"
                  />
                </div>
                {allowTime && draft.includeTime ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id ?? "date-range"}-start-time`} className="text-xs text-muted-foreground">
                      Start time
                    </Label>
                    <Input
                      id={`${id ?? "date-range"}-start-time`}
                      type="time"
                      value={draft.startTime}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          startTime: e.target.value,
                          activePreset: null,
                        }))
                      }
                      className="h-8"
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor={`${id ?? "date-range"}-end-date`} className="text-xs text-muted-foreground">
                    End date
                  </Label>
                  <Input
                    id={`${id ?? "date-range"}-end-date`}
                    readOnly
                    value={draft.range?.to ? toDisplayDate(draft.range.to) : ""}
                    placeholder="—"
                    className="h-8 bg-muted/30"
                  />
                </div>
                {allowTime && draft.includeTime ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id ?? "date-range"}-end-time`} className="text-xs text-muted-foreground">
                      End time
                    </Label>
                    <Input
                      id={`${id ?? "date-range"}-end-time`}
                      type="time"
                      value={draft.endTime}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          endTime: e.target.value,
                          activePreset: null,
                        }))
                      }
                      className="h-8"
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t p-3">
              <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" disabled={!canApply} onClick={handleApply}>
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
