"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, Coins, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RecapDetailRow } from "@/lib/spg-commission/compute";
import type { CommissionRecap } from "@/lib/spg-commission/queries";
import { compareYearMonth } from "@/lib/spg-commission/month";
import {
  detailKey,
  formatSignedRupiah,
  ratesByDetail,
  recapMonthOptions,
  shiftYearMonth,
  storeLabel,
  sumRecapRows,
  type DetailRates,
} from "@/lib/spg-commission/recap-display";
import { formatYearMonth } from "@/app/backoffice/settings/spg-commission/format";
import { SpgCommissionExportButtons } from "./SpgCommissionExportButtons";

const BASE_PATH = "/backoffice/spg-commission";
const RATES_SETTINGS_PATH = "/backoffice/settings/spg-commission";
/* Two years back covers a payroll correction; an older month still opens by URL and joins the list. */
const MONTH_OPTION_COUNT = 24;
const COLUMN_COUNT = 7;

type Props = {
  recap: CommissionRecap | null;
  month: string;
  currentMonth: string;
  canManageRates: boolean;
};

const NEGATIVE_CLASS = "text-red-600 dark:text-red-400";

function signedClass(value: number): string {
  return value < 0 ? NEGATIVE_CLASS : "";
}

function formatPieces(pieces: number): string {
  return pieces.toLocaleString("id-ID");
}

export function SpgCommissionPageClient({ recap, month, currentMonth, canManageRates }: Props) {
  const t = useTranslations("spgCommission");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const monthOptions = useMemo(
    () => recapMonthOptions(currentMonth, month, MONTH_OPTION_COUNT),
    [currentMonth, month],
  );
  const detailBySpg = useMemo(() => {
    const bySpg = new Map<string, RecapDetailRow[]>();
    for (const row of recap?.detail ?? []) {
      const list = bySpg.get(row.salesmanId) ?? [];
      list.push(row);
      bySpg.set(row.salesmanId, list);
    }
    return bySpg;
  }, [recap]);
  const rates = useMemo(() => ratesByDetail(recap?.events ?? []), [recap]);
  const totals = useMemo(() => sumRecapRows(recap?.rows ?? []), [recap]);

  const monthLabel = formatYearMonth(month, locale);
  const isLatestMonth = compareYearMonth(month, currentMonth) >= 0;
  const hasRows = recap !== null && recap.rows.length > 0;

  function goToMonth(next: string): void {
    if (next === month) return;
    startTransition(() => router.push(`${BASE_PATH}?month=${next}`));
  }

  function retry(): void {
    startTransition(() => router.refresh());
  }

  function toggle(salesmanId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(salesmanId)) {
        next.delete(salesmanId);
      } else {
        next.add(salesmanId);
      }
      return next;
    });
  }

  function categoryLabel(categoryId: string | null, name?: string | null): string {
    if (categoryId === null) return t("uncategorized");
    return name ?? recap?.categoryNames[categoryId] ?? t("unknownCategory");
  }

  function rateLabel(entry: DetailRates | undefined): string {
    const parts = (entry?.rates ?? []).map((rate) => t("perPiece", { amount: formatSignedRupiah(rate) }));
    if (!entry || entry.unrated) parts.push(t("noRateShort"));
    return parts.join(" · ");
  }

  const spgName = (salesmanId: string) => recap?.spgNames[salesmanId] ?? salesmanId;
  const hasUncategorized = (recap?.noRate ?? []).some((r) => r.categoryId === null);

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <SpgCommissionExportButtons month={month} disabled={!hasRows || isPending} />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="shrink-0"
          aria-label={t("prevMonth")}
          disabled={isPending}
          onClick={() => goToMonth(shiftYearMonth(month, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Select value={month} onValueChange={goToMonth} disabled={isPending}>
          <SelectTrigger
            className="min-w-0 flex-1 data-[size=default]:h-10 sm:w-[200px] sm:flex-none"
            aria-label={t("monthLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {formatYearMonth(option, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="shrink-0"
          aria-label={t("nextMonth")}
          disabled={isPending || isLatestMonth}
          onClick={() => goToMonth(shiftYearMonth(month, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        {isPending && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {recap === null ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium">{t("loadErrorTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("loadErrorMessage")}</p>
            </div>
            <Button type="button" variant="outline" className="h-10" onClick={retry} disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              {t("retry")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {!isPending && recap.noRate.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  {t("noRate.title")}
                </CardTitle>
                <CardDescription>{t("noRate.description", { month: monthLabel })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="divide-y rounded-md border bg-background">
                  {recap.noRate.map((entry) => {
                    const category = categoryLabel(entry.categoryId, entry.categoryName);
                    const pieces = t("piecesValue", { count: formatPieces(entry.pieces) });
                    return (
                      <li
                        key={entry.categoryId ?? "uncategorized"}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate" title={category}>
                          {category}
                        </span>
                        <span className="shrink-0 tabular-nums">{pieces}</span>
                      </li>
                    );
                  })}
                </ul>
                {hasUncategorized && <p className="text-xs text-muted-foreground">{t("noRate.uncategorizedHint")}</p>}
                {canManageRates ? (
                  <Button asChild variant="outline" className="h-10">
                    <Link href={RATES_SETTINGS_PATH}>{t("noRate.setRates")}</Link>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noRate.askAdmin")}</p>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2">
                <Coins className="h-5 w-5 shrink-0" />
                <span className="truncate">{t("listTitle", { month: monthLabel })}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
                </div>
              ) : recap.rows.length === 0 ? (
                <div className="py-12 text-center">
                  <Coins className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="font-medium">{t("emptyTitle", { month: monthLabel })}</p>
                  <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <span className="sr-only">{t("colExpand")}</span>
                        </TableHead>
                        <TableHead>{t("colSpg")}</TableHead>
                        <TableHead>{t("colStores")}</TableHead>
                        <TableHead className="text-right">{t("colPieces")}</TableHead>
                        <TableHead className="text-right">{t("colEarned")}</TableHead>
                        <TableHead className="text-right">{t("colReversed")}</TableHead>
                        <TableHead className="text-right">{t("colNet")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recap.rows.map((row) => {
                        const isOpen = expanded.has(row.salesmanId);
                        const name = spgName(row.salesmanId);
                        const stores = storeLabel(row.storeIds, recap.storeNames);
                        const detailId = `spg-commission-detail-${row.salesmanId}`;
                        const toggleLabel = t(isOpen ? "collapse" : "expand", { name });
                        const breakdown = detailBySpg.get(row.salesmanId) ?? [];
                        const noRateLabel = t("rowNoRate", { count: formatPieces(row.noRatePieces) });
                        return (
                          <Fragment key={row.salesmanId}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => toggle(row.salesmanId)}
                            >
                              <TableCell className="w-12 py-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-lg"
                                  aria-expanded={isOpen}
                                  aria-controls={detailId}
                                  aria-label={toggleLabel}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(row.salesmanId);
                                  }}
                                >
                                  <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
                                </Button>
                              </TableCell>
                              <TableCell className="max-w-[200px]">
                                <span className="block truncate font-medium" title={name}>
                                  {name}
                                </span>
                                {row.noRatePieces > 0 && (
                                  <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
                                    {noRateLabel}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="max-w-[220px] truncate" title={stores}>
                                {stores}
                              </TableCell>
                              <TableCell className={cn("whitespace-nowrap text-right tabular-nums", signedClass(row.pieces))}>
                                {formatPieces(row.pieces)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                {formatSignedRupiah(row.earned)}
                              </TableCell>
                              <TableCell className={cn("whitespace-nowrap text-right tabular-nums", signedClass(row.reversed))}>
                                {formatSignedRupiah(row.reversed)}
                              </TableCell>
                              <TableCell
                                className={cn("whitespace-nowrap text-right font-medium tabular-nums", signedClass(row.net))}
                              >
                                {formatSignedRupiah(row.net)}
                              </TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow id={detailId} className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={COLUMN_COUNT} className="p-0">
                                  <div className="px-4 py-3 sm:pl-14">
                                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                      {t("breakdownTitle")}
                                    </p>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>{t("colCategory")}</TableHead>
                                          <TableHead className="text-right">{t("colPieces")}</TableHead>
                                          <TableHead className="text-right">{t("colRate")}</TableHead>
                                          <TableHead className="text-right">{t("colEarned")}</TableHead>
                                          <TableHead className="text-right">{t("colReversed")}</TableHead>
                                          <TableHead className="text-right">{t("colNet")}</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {breakdown.map((line) => {
                                          const key = detailKey(line.salesmanId, line.categoryId);
                                          const category = categoryLabel(line.categoryId);
                                          const rate = rates.get(key);
                                          const isUnrated = !rate || rate.unrated;
                                          return (
                                            <TableRow key={key}>
                                              <TableCell className="max-w-[200px] truncate" title={category}>
                                                {category}
                                              </TableCell>
                                              <TableCell
                                                className={cn("whitespace-nowrap text-right tabular-nums", signedClass(line.pieces))}
                                              >
                                                {formatPieces(line.pieces)}
                                              </TableCell>
                                              <TableCell
                                                className={cn(
                                                  "whitespace-nowrap text-right tabular-nums",
                                                  isUnrated && "text-amber-700 dark:text-amber-400",
                                                )}
                                              >
                                                {rateLabel(rate)}
                                              </TableCell>
                                              <TableCell className="whitespace-nowrap text-right tabular-nums">
                                                {formatSignedRupiah(line.earned)}
                                              </TableCell>
                                              <TableCell
                                                className={cn("whitespace-nowrap text-right tabular-nums", signedClass(line.reversed))}
                                              >
                                                {formatSignedRupiah(line.reversed)}
                                              </TableCell>
                                              <TableCell
                                                className={cn("whitespace-nowrap text-right tabular-nums", signedClass(line.net))}
                                              >
                                                {formatSignedRupiah(line.net)}
                                              </TableCell>
                                            </TableRow>
                                          );
                                        })}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={2} className="font-medium">
                          {t("totalLabel", { count: recap.rows.length })}
                        </TableCell>
                        <TableCell className={cn("whitespace-nowrap text-right tabular-nums", signedClass(totals.pieces))}>
                          {formatPieces(totals.pieces)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {formatSignedRupiah(totals.earned)}
                        </TableCell>
                        <TableCell className={cn("whitespace-nowrap text-right tabular-nums", signedClass(totals.reversed))}>
                          {formatSignedRupiah(totals.reversed)}
                        </TableCell>
                        <TableCell
                          className={cn("whitespace-nowrap text-right font-semibold tabular-nums", signedClass(totals.net))}
                        >
                          {formatSignedRupiah(totals.net)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
