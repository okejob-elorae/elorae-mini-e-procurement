"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, History, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
/* Subpath import, not the main barrel: this is a "use client" file, and the barrel
   eagerly pulls in Prisma and the mariadb driver. STOCK_LEDGER_REF_TYPES is a plain
   string tuple with no such baggage on its own — only the barrel does. The type import
   is erased entirely at compile time, so it carries no bundle risk either. */
import { STOCK_LEDGER_REF_TYPES, type StockLedgerRefType } from "@elorae/db/stock-ledger-ref";

const ALL_VARIANTS_VALUE = "__all__";

/* Closed set the query layer accepts for `locationTypes` (getItemMovementCard /
   LedgerLocationType). Kept local rather than imported: the only exported home for this
   union is stock-ledger-card.ts, which is a server module (imports the @elorae/db
   barrel) — a type-only import would likely get erased before bundling, but a plain
   local literal removes any doubt for a "use client" file. */
const WAREHOUSE_TYPES = ["MAIN", "STORE", "VAN"] as const;
type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

const WAREHOUSE_OPTION_KEY: Record<WarehouseType, string> = {
  MAIN: "warehouseOption.main",
  STORE: "warehouseOption.store",
  VAN: "warehouseOption.van",
};

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

type MultiSelectOption = { value: string; label: string };

/**
 * Multi-select filter, built on the same Popover + Command shell as the single-select
 * combobox above (`SearchableCombobox`) rather than a new control idiom — the only real
 * differences are that a selection toggles membership instead of replacing it, and the
 * popover stays open across clicks so several boxes can be ticked in one pass.
 *
 * `selected` is guarded to NEVER become an empty array, and that guard is now a UX choice
 * rather than a correctness one — keep both halves, they defend different things. The query
 * layer used to read an empty `locationTypes`/`refTypes` array as "no filter, match
 * everything", so an operator who unticked every box was handed the entire unfiltered set;
 * it now fails closed, sending `in: []`, which matches nothing. So a slipped empty array is
 * no longer a silent inversion. This control still refuses the toggle that would produce
 * one, because an empty result screen with every box unticked is a worse thing to hand an
 * operator than simply declining the last uncheck: unchecking the last remaining box is a
 * no-op. Do NOT drop this refusal on the grounds that the query layer is safe now, and do
 * NOT relax the query layer on the grounds that this control cannot produce an empty. The
 * "everything ticked" state is reported upward as `options.length === selected.length`
 * and it is the CALLER's job (see the two call sites below) to collapse that back to
 * "send nothing" on the wire.
 */
function MultiSelectFilter({
  options,
  selected,
  onChange,
  allLabel,
  selectedCountLabel,
  placeholder,
  searchable = false,
  triggerClassName,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  selectedCountLabel: (count: number) => string;
  placeholder: string;
  searchable?: boolean;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

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
    if (next.length === 0) return; /* the empty-selection trap — see doc comment above */
    onChange(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
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
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allLabel}
                onSelect={() => onChange(options.map((opt) => opt.value))}
                className="min-h-[40px] font-medium"
              >
                <Checkbox checked={allSelected} tabIndex={-1} className="pointer-events-none mr-2" />
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
                    onSelect={() => toggle(opt.value)}
                    className="min-h-[40px]"
                  >
                    <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none mr-2" />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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
     * Split the sentinel back out of `refTypes` into its own boolean here, at the very
     * last moment before the wire call — see UNREGISTERED_REF_TYPE_VALUE's doc comment.
     * `registeredRefTypes` and `includeUnregisteredRefTypes` always travel TOGETHER as
     * either both undefined ("no filter") or both defined: sending one without the
     * other would leave getItemMovementCard's buildRefTypeCondition guessing at a state
     * this control never actually produces.
     */
    const includeUnregisteredRefTypes = refTypes.includes(UNREGISTERED_REF_TYPE_VALUE);
    const registeredRefTypes = refTypes.filter(
      (v): v is StockLedgerRefType => v !== UNREGISTERED_REF_TYPE_VALUE,
    );
    const allRefTypesSelected =
      registeredRefTypes.length === STOCK_LEDGER_REF_TYPES.length && includeUnregisteredRefTypes;
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
