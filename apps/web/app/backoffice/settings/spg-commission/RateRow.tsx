"use client";

import { useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, ChevronDown, Loader2 } from "lucide-react";
import {
  setSpgCommissionRate,
  type SetSpgCommissionRateReason,
  type SpgCommissionCategory,
  type SpgCommissionRateEntry,
} from "@/app/actions/settings/spg-commission";
import { compareYearMonth } from "@/lib/spg-commission/month";
import { resolveRate } from "@/lib/spg-commission/resolve-rate";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah, formatSavedDate, formatYearMonth, sanitizeAmountInput } from "./format";

/** Refusals that mean the page's own data is stale, so it reloads before the user retries. */
const RELOAD_ON_REASON: ReadonlySet<SetSpgCommissionRateReason> = new Set<SetSpgCommissionRateReason>([
  "MONTH_CLOSED",
  "CATEGORY_NOT_FOUND",
  "CATEGORY_INACTIVE",
]);

const REASON_MESSAGE_KEY: Record<SetSpgCommissionRateReason, string> = {
  FORBIDDEN: "err.FORBIDDEN",
  INVALID_AMOUNT: "err.INVALID_AMOUNT",
  INVALID_MONTH: "err.INVALID_MONTH",
  MONTH_CLOSED: "err.MONTH_CLOSED",
  CATEGORY_NOT_FOUND: "err.CATEGORY_NOT_FOUND",
  CATEGORY_INACTIVE: "err.CATEGORY_INACTIVE",
  UNEXPECTED: "err.UNEXPECTED",
};

/** The first rate that starts after `yearMonth`, i.e. the one that will take over from it. */
function earliestRateAfter(rates: SpgCommissionRateEntry[], yearMonth: string): SpgCommissionRateEntry | null {
  let earliest: SpgCommissionRateEntry | null = null;
  for (const rate of rates) {
    if (compareYearMonth(rate.effectiveFrom, yearMonth) <= 0) continue;
    if (earliest === null || compareYearMonth(rate.effectiveFrom, earliest.effectiveFrom) < 0) earliest = rate;
  }
  return earliest;
}

type RateRowProps = {
  category: SpgCommissionCategory;
  currentMonth: string;
  openMonths: string[];
  readOnly?: boolean;
  onChanged: () => Promise<void>;
};

export function RateRow({ category, currentMonth, openMonths, readOnly = false, onChanged }: RateRowProps) {
  const t = useTranslations("settings.spgCommission");
  const tToasts = useTranslations("toasts");
  const locale = useLocale();
  const inForce = resolveRate(category.rates, category.id, currentMonth);
  const [amountDigits, setAmountDigits] = useState(() => (inForce ? String(inForce.amountPerPiece) : ""));
  const [month, setMonth] = useState(currentMonth);
  const [saving, setSaving] = useState(false);

  /* After a reload past a month end, a month picked earlier may have closed; fall back to the first open one. */
  const selectedMonth = openMonths.includes(month) ? month : openMonths[0];
  const amount = amountDigits === "" ? null : Number(amountDigits);
  const inForceForSelected = resolveRate(category.rates, category.id, selectedMonth);
  const unchanged = amount !== null && inForceForSelected?.amountPerPiece === amount;
  const replaced = category.rates.find((rate) => rate.effectiveFrom === selectedMonth) ?? null;
  const nextAfterSelected = earliestRateAfter(category.rates, selectedMonth);
  const scheduled = earliestRateAfter(category.rates, currentMonth);
  const monthName = (yearMonth: string) => formatYearMonth(yearMonth, locale);
  const inputId = `spg-commission-amount-${category.id}`;
  const monthId = `spg-commission-month-${category.id}`;

  const handleSave = async () => {
    if (amount === null) {
      toast.error(t("errAmountRequired"));
      return;
    }
    setSaving(true);
    try {
      const result = await setSpgCommissionRate({
        itemCategoryId: category.id,
        amountPerPiece: amount,
        effectiveFrom: selectedMonth,
      });
      if (result.ok) {
        toast.success(t("saved", {
          category: category.name,
          amount: formatRupiah(amount),
          month: monthName(selectedMonth),
        }));
        await onChanged();
      } else {
        toast.error(t(REASON_MESSAGE_KEY[result.reason]));
        if (RELOAD_ON_REASON.has(result.reason)) await onChanged();
      }
    } catch {
      toast.error(tToasts("failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  const hints: string[] = [];
  if (unchanged) {
    hints.push(t("hintUnchanged", { month: monthName(selectedMonth) }));
  } else {
    hints.push(
      selectedMonth === currentMonth
        ? t("hintCurrentMonth", { month: monthName(selectedMonth) })
        : t("hintFutureMonth", { month: monthName(selectedMonth) }),
    );
    if (replaced) {
      hints.push(t("hintReplaces", { amount: formatRupiah(replaced.amountPerPiece), month: monthName(selectedMonth) }));
    }
    if (nextAfterSelected) {
      hints.push(t("hintUntil", {
        amount: formatRupiah(nextAfterSelected.amountPerPiece),
        month: monthName(nextAfterSelected.effectiveFrom),
      }));
    }
  }

  const inForceLabel = inForce ? t("inForce", { amount: formatRupiah(inForce.amountPerPiece) }) : t("noRate");
  const scheduledLabel = scheduled
    ? t("scheduled", { amount: formatRupiah(scheduled.amountPerPiece), month: monthName(scheduled.effectiveFrom) })
    : null;
  const amountDisplay = amount === null ? "" : amount.toLocaleString("id-ID");
  const canSave = !saving && amount !== null && !unchanged;

  const handleAmountChange = (event: ChangeEvent<HTMLInputElement>) => {
    setAmountDigits(sanitizeAmountInput(event.target.value));
  };

  return (
    <div className={cn("space-y-3 rounded-lg border p-4", readOnly && "bg-muted/40")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 space-y-1.5 lg:flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="truncate font-medium" title={category.name}>{category.name}</p>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {category.code ?? t("noCode")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {inForce ? (
              <Badge variant="secondary">{inForceLabel}</Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-amber-500/50 text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="h-3 w-3" />
                {inForceLabel}
              </Badge>
            )}
            {scheduledLabel && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                {scheduledLabel}
              </span>
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end lg:w-[34rem] lg:shrink-0">
            <div className="space-y-1.5">
              <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                {t("amountLabel")}
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                  Rp
                </span>
                <Input
                  id={inputId}
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountDisplay}
                  onChange={handleAmountChange}
                  placeholder="0"
                  disabled={saving}
                  className="h-10 pl-9 text-right tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={monthId} className="text-xs text-muted-foreground">
                {t("monthLabel")}
              </Label>
              <Select value={selectedMonth} onValueChange={setMonth} disabled={saving}>
                <SelectTrigger id={monthId} className="w-full data-[size=default]:h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {openMonths.map((openMonth) => (
                    <SelectItem key={openMonth} value={openMonth}>
                      {monthName(openMonth)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              className="h-10 w-full sm:w-24"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
            </Button>
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="space-y-0.5 text-xs text-muted-foreground lg:text-right">
          {hints.map((hint) => (
            <p key={hint}>{hint}</p>
          ))}
        </div>
      )}

      <RateHistory category={category} currentMonth={currentMonth} />
    </div>
  );
}

function RateHistory({ category, currentMonth }: { category: SpgCommissionCategory; currentMonth: string }) {
  const t = useTranslations("settings.spgCommission");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const inForceId = resolveRate(category.rates, category.id, currentMonth)?.id ?? null;

  if (category.rates.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="-ml-3 h-10 px-3 text-sm">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          {t("historyToggle", { count: category.rates.length })}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("historyMonth")}</TableHead>
              <TableHead className="text-right">{t("historyAmount")}</TableHead>
              <TableHead>{t("historySaved")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {category.rates.map((rate) => {
              const savedDate = formatSavedDate(rate.createdAt, locale);
              const editedDate = formatSavedDate(rate.updatedAt, locale);
              const isScheduled = compareYearMonth(rate.effectiveFrom, currentMonth) > 0;
              const savedLabel = rate.createdByName
                ? t("historySavedBy", { date: savedDate, name: rate.createdByName })
                : savedDate;
              const amountLabel = t("perPiece", { amount: formatRupiah(rate.amountPerPiece) });
              const editedLabel = editedDate === savedDate ? null : t("historyEdited", { date: editedDate });
              const isInForce = rate.id === inForceId;
              return (
                <TableRow key={rate.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{formatYearMonth(rate.effectiveFrom, locale)}</span>
                      {isInForce && <Badge variant="secondary">{t("badgeInForce")}</Badge>}
                      {isScheduled && <Badge variant="outline">{t("badgeScheduled")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{amountLabel}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <span>{savedLabel}</span>
                    {editedLabel && <span className="block text-xs">{editedLabel}</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}
