"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, History, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDateOnly, parseDateOnly } from "@/lib/date-only";
import { getCurrentStockSummary, getItemVariantOptions } from "@/app/actions/stock-card";
import { getItemMovementsAction, type ItemMovementsResult } from "@/app/actions/stock-movements";
import { ledgerRefMessageKey } from "@/lib/inventory/ledger-ref-display";

const ALL_VARIANTS_VALUE = "__all__";

type LedgerSection = ItemMovementsResult["sections"][number];

function sectionTitleKey(section: LedgerSection): "sectionTitle.main" | "sectionTitle.store" | "sectionTitle.van" {
  if (section.locationType === "MAIN") return "sectionTitle.main";
  return section.locationType === "STORE" ? "sectionTitle.store" : "sectionTitle.van";
}

export function MovementsPageClient() {
  const t = useTranslations("stockMovements");

  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getCurrentStockSummary>>>([]);
  const [itemId, setItemId] = useState("");
  const [variantOptions, setVariantOptions] = useState<string[]>([]);
  const [variantSku, setVariantSku] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [data, setData] = useState<ItemMovementsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestIdRef = useRef(0);
  const variantRequestIdRef = useRef(0);

  useEffect(() => {
    getCurrentStockSummary()
      .then(setSummary)
      .catch(() => toast.error(t("loadError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once, translation fn is stable enough for a toast
  }, []);

  useEffect(() => {
    if (!itemId) {
      setVariantOptions([]);
      return;
    }
    /* Same out-of-order guard as the movements fetch below: switching items fast enough
       that an earlier item's response resolves last would otherwise leave this dropdown
       showing the wrong item's SKUs against the item actually selected. */
    const requestId = ++variantRequestIdRef.current;
    getItemVariantOptions(itemId)
      .then((options) => {
        if (variantRequestIdRef.current !== requestId) return;
        setVariantOptions(options);
      })
      .catch(() => {
        if (variantRequestIdRef.current !== requestId) return;
        setVariantOptions([]);
      });
  }, [itemId]);

  useEffect(() => {
    if (!itemId) {
      setData(null);
      setLoadError(false);
      setIsLoading(false);
      return;
    }
    /*
     * Guards against an out-of-order response: switching item/variant/range quickly can let
     * an earlier request resolve after a later one, which would overwrite fresher data with
     * stale results. Only the most recently dispatched request is allowed to commit state.
     */
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(false);
    getItemMovementsAction({
      itemId,
      variantSku: variantSku || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    })
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setIsLoading(false);
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return;
        setData(null);
        setLoadError(true);
        setIsLoading(false);
      });
  }, [itemId, variantSku, dateFrom, dateTo, reloadToken]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 lg:col-span-2">
              <Label>{t("itemLabel")}</Label>
              <SearchableCombobox
                options={summary.map((s) => ({
                  value: s.itemId,
                  label: `${s.item?.sku ?? "-"} – ${s.item?.nameId ?? "-"}`,
                }))}
                value={itemId}
                onValueChange={(v) => {
                  setItemId(v);
                  setVariantSku("");
                  setData(null);
                }}
                placeholder={t("itemPlaceholder")}
                triggerClassName="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("variantLabel")}</Label>
              <SearchableCombobox
                options={[
                  { value: ALL_VARIANTS_VALUE, label: t("allVariants") },
                  ...variantOptions.map((sku) => ({ value: sku, label: sku })),
                ]}
                value={variantSku || ALL_VARIANTS_VALUE}
                onValueChange={(v) => setVariantSku(v === ALL_VARIANTS_VALUE ? "" : v)}
                placeholder={t("allVariants")}
                triggerClassName="min-h-[44px]"
                disabled={!itemId}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("dateRangeLabel")}</Label>
              <DateRangePicker
                id="stock-movements-date-range"
                triggerClassName="min-h-[44px]"
                placeholder={t("dateRangePlaceholder")}
                value={{
                  from: parseDateOnly(dateFrom),
                  to: parseDateOnly(dateTo),
                }}
                onChange={(range) => {
                  setDateFrom(range?.from ? formatDateOnly(range.from) : "");
                  setDateTo(range?.to ? formatDateOnly(range.to) : "");
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/*
       * Always visible, regardless of item/loading state — without it an empty range on a
       * freshly-cutover item reads as "nothing happened" rather than "not recorded yet",
       * which is the single most likely misreading of this whole screen.
       */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>{t("cutoverBanner")}</AlertDescription>
      </Alert>

      {!itemId ? (
        <Card>
          <CardContent className="py-12 text-center">
            <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">{t("noItemSelected")}</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </CardContent>
        </Card>
      ) : loadError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t("loadError")}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((n) => n + 1)}
              className="min-h-[40px]"
            >
              {t("retryButton")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : data && data.sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {data.hasAnyHistory ? t("noMovementsInRange") : t("noLedgerHistory")}
            </p>
          </CardContent>
        </Card>
      ) : data ? (
        <div className="space-y-4">
          {/*
           * Card-level truncation, rendered above every section and independent of any
           * section's own `truncated` flag: an item whose entries spread thin across several
           * locations can blow the query ceiling while every section reports itself complete.
           */}
          {data.queryTruncated && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t("queryTruncated", { limit: data.queryEntryLimit })}
              </AlertDescription>
            </Alert>
          )}

          {data.sections.map((section) => {
            /*
             * The query layer does not slice — it returns every fetched entry for the
             * section. Sections are sorted ascending for display, so the recent end is the
             * last `sectionLimit` entries, and the notice below ships only alongside this
             * slice so the screen never shows more rows than the cap it names.
             */
            const visibleEntries = section.entries.slice(-data.sectionLimit);
            const sectionKey = `${section.locationType}:${section.locationId}:${section.variantSku}`;

            return (
              <Collapsible key={sectionKey} defaultOpen={section.locationType === "MAIN"}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="flex flex-row flex-wrap cursor-pointer items-center justify-between gap-2 space-y-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <span>{t(sectionTitleKey(section), { name: section.locationLabel })}</span>
                        {!section.locationResolved && (
                          <Badge variant="outline" className="text-xs font-normal">
                            {t("unresolvedLocation")}
                          </Badge>
                        )}
                        {section.variantSku && (
                          <Badge variant="secondary" className="text-xs font-normal">
                            {t("sectionVariantLabel", { sku: section.variantSku })}
                          </Badge>
                        )}
                      </CardTitle>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {t("closingBalanceLabel")}:{" "}
                          <span className="font-medium tabular-nums text-foreground">
                            {section.closingBalance.toLocaleString()}
                          </span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-3">
                      <div className="overflow-x-auto rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("colDate")}</TableHead>
                              <TableHead>{t("colRefType")}</TableHead>
                              <TableHead>{t("colDocNumber")}</TableHead>
                              <TableHead className="text-right">{t("colQty")}</TableHead>
                              <TableHead className="text-right">{t("colBalance")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {visibleEntries.map((entry) => {
                              const messageKey = ledgerRefMessageKey(entry.refType);
                              return (
                                <TableRow key={entry.id}>
                                  <TableCell className="whitespace-nowrap">
                                    {format(new Date(entry.createdAt), "dd/MM/yyyy HH:mm")}
                                  </TableCell>
                                  <TableCell className="max-w-[200px] truncate">
                                    {messageKey ? t(messageKey) : entry.refType}
                                  </TableCell>
                                  <TableCell className="max-w-[160px] truncate font-medium">
                                    {/* refDocNumber defaults to "" for the opening-balance
                                        migration rows and a few writers that omit it —
                                        render a placeholder rather than a dead cell. */}
                                    {entry.refDocNumber || (
                                      <span className="font-normal text-muted-foreground">{t("noDocument")}</span>
                                    )}
                                  </TableCell>
                                  <TableCell
                                    className={cn(
                                      "text-right tabular-nums whitespace-nowrap",
                                      entry.qty > 0 && "text-emerald-600 dark:text-emerald-400",
                                      entry.qty < 0 && "text-red-600 dark:text-red-400",
                                    )}
                                  >
                                    {entry.qty > 0
                                      ? `+${entry.qty.toLocaleString()}`
                                      : entry.qty.toLocaleString()}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums whitespace-nowrap">
                                    {entry.balanceQty.toLocaleString()}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      {section.truncated && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {t("sectionTruncated", { limit: data.sectionLimit })}
                        </p>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
