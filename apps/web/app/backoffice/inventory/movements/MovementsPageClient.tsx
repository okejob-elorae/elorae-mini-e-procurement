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
import { MultiSelectFilter, type MultiSelectOption } from "@/components/ui/multi-select-filter";
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
import { WAREHOUSE_OPTION_KEY, WAREHOUSE_TYPES, type WarehouseType } from "@/lib/inventory/warehouse-option-display";
/* Subpath import, not the main barrel: this is a "use client" file, and the barrel
   eagerly pulls in Prisma and the mariadb driver. STOCK_LEDGER_REF_TYPES is a plain
   string tuple with no such baggage on its own — only the barrel does. The type import
   is erased entirely at compile time, so it carries no bundle risk either. */
import { STOCK_LEDGER_REF_TYPES, type StockLedgerRefType } from "@elorae/db/stock-ledger-ref";

const ALL_VARIANTS_VALUE = "__all__";

/*
 * `StockLedgerEntry.refType` is a free-form column and genuinely holds values the
 * registry does not know about (a fixture row, or a writer shipped before its registry
 * entry landed) — see ledger-ref-display.ts's own comment. This sentinel represents
 * that whole class as ONE more item in the movement-type list, so it participates in
 * "select all" and the empty-selection guard exactly like any registered member.
 *
 * It never reaches the wire as a string. The fetch effect below splits it back out into
 * its own boolean (`includeUnregisteredRefTypes`) before calling the action — the query
 * layer takes a separate flag, never a sentinel folded into the refTypes array, because
 * a sentinel string travelling inside an `in`/`notIn` list can leak straight through if
 * anything downstream forgets to strip it first.
 */
const UNREGISTERED_REF_TYPE_VALUE = "__unregistered__";

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
  /* Both default to "everything ticked", which is what "all, no filter" looks like in
     this control (see MultiSelectFilter's doc comment for why that can never collapse
     to an empty array on its own). refTypes' default includes the unregistered
     sentinel too, for the same reason. */
  const [locationTypes, setLocationTypes] = useState<WarehouseType[]>([...WAREHOUSE_TYPES]);
  const [refTypes, setRefTypes] = useState<string[]>([...STOCK_LEDGER_REF_TYPES, UNREGISTERED_REF_TYPE_VALUE]);

  const warehouseOptions: MultiSelectOption[] = WAREHOUSE_TYPES.map((wt) => ({
    value: wt,
    label: t(WAREHOUSE_OPTION_KEY[wt]),
  }));

  /*
   * The unregistered sentinel is appended as one more plain option, deliberately not a
   * special case inside MultiSelectFilter — it just rides along with "select all" and
   * the empty-selection guard for free. Everything registry-shaped is untouched: the
   * sentinel is stripped back out into includeUnregisteredRefTypes below, right before
   * the wire call.
   */
  const refTypeOptions: MultiSelectOption[] = [
    ...STOCK_LEDGER_REF_TYPES.map((refType) => {
      const messageKey = ledgerRefMessageKey(refType);
      return { value: refType, label: messageKey ? t(messageKey) : refType };
    }),
    { value: UNREGISTERED_REF_TYPE_VALUE, label: t("otherMovementType") },
  ];

  /*
   * Split the sentinel back out of `refTypes` here, at the component's top level rather
   * than inside the fetch effect below — these three are pure derivations of `refTypes`
   * state and are needed in TWO places: the wire payload (the effect) and the
   * "which of the three controls, if any, is narrowing this view" test the empty-state
   * copy below depends on. Computing it twice would let the two silently drift apart on
   * what "narrowed" means; one calculation, two readers.
   */
  const includeUnregisteredRefTypes = refTypes.includes(UNREGISTERED_REF_TYPE_VALUE);
  const registeredRefTypes = refTypes.filter(
    (v): v is StockLedgerRefType => v !== UNREGISTERED_REF_TYPE_VALUE,
  );
  const allRefTypesSelected =
    registeredRefTypes.length === STOCK_LEDGER_REF_TYPES.length && includeUnregisteredRefTypes;

  /*
   * Whether ANY of the three filter controls (variant, warehouse, movement type) is
   * currently narrowing the view — used below to pick between "no history at all" and
   * "nothing matches the current filters". The variant filter predates this branch but
   * carries the exact same defect (it can just as easily zero out `hasAnyHistory`), so
   * it belongs in this test too, not just the two controls this branch added.
   */
  const isAnyFilterNarrowed =
    variantSku !== "" ||
    locationTypes.length !== WAREHOUSE_TYPES.length ||
    !allRefTypesSelected;

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
    /*
     * registeredRefTypes/includeUnregisteredRefTypes/allRefTypesSelected are computed
     * once at the component's top level (see the comment there) — reused here as-is,
     * both undefined ("no filter") or both defined together: sending one without the
     * other would leave getItemMovementCard's buildRefTypeCondition guessing at a state
     * this control never actually produces.
     */
    getItemMovementsAction({
      itemId,
      variantSku: variantSku || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      /* "Everything ticked" is this control's spelling of "all" — send nothing rather
         than the full list, matching how variantSku/dateFrom/dateTo already collapse
         their own "no filter" state to undefined above. Registry-all-ticked-but-
         unregistered-unticked is a REAL filter, not "no filter" — it must still send
         both fields explicitly, which is exactly what allRefTypesSelected being false
         does here. */
      locationTypes: locationTypes.length === WAREHOUSE_TYPES.length ? undefined : locationTypes,
      refTypes: allRefTypesSelected ? undefined : registeredRefTypes,
      includeUnregisteredRefTypes: allRefTypesSelected ? undefined : includeUnregisteredRefTypes,
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
    /* registeredRefTypes/includeUnregisteredRefTypes/allRefTypesSelected deliberately
       omitted: each is a pure derivation of `refTypes`, which IS listed, recomputed
       fresh on every render — listing them too would fire this effect on every render
       instead of only when refTypes actually changes, since a derived array's
       reference is never stable across renders even when its contents are not. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, variantSku, dateFrom, dateTo, locationTypes, refTypes, reloadToken]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
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
            <div className="space-y-2">
              <Label>{t("warehouseLabel")}</Label>
              <MultiSelectFilter
                options={warehouseOptions}
                selected={locationTypes}
                onChange={(next) => setLocationTypes(next as WarehouseType[])}
                allLabel={t("allWarehouses")}
                selectedCountLabel={(count) => t("filterSelectedCount", { count })}
                placeholder={t("allWarehouses")}
                triggerClassName="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("movementTypeLabel")}</Label>
              <MultiSelectFilter
                options={refTypeOptions}
                selected={refTypes}
                onChange={setRefTypes}
                allLabel={t("allMovementTypes")}
                selectedCountLabel={(count) => t("filterSelectedCount", { count })}
                placeholder={t("allMovementTypes")}
                searchable
                triggerClassName="min-h-[44px]"
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
              {/*
               * Three distinct states, not two: hasAnyHistory already ignores the date
               * window (see the comment on historyWhere in stock-ledger-card.ts), so a
               * false reading here can ALSO mean "the variant/warehouse/movement-type
               * filters rule out every row", which is not the same claim as "no history
               * at all" — that claim must stay true whenever it renders, and it was not
               * before this filter was narrowed to something other than "everything".
               */}
              {data.hasAnyHistory
                ? t("noMovementsInRange")
                : isAnyFilterNarrowed
                  ? t("noMovementsForFilters")
                  : t("noLedgerHistory")}
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
