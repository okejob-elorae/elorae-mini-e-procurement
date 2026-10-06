"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle, PackageX, PlusCircle, Loader2 } from "lucide-react";
import { getItems } from "@/app/actions/items";
import { itemHasSkuVariants, parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { createKonsiPushOrderAction, type KonsiPushActionResult } from "@/app/actions/field-sales-orders";
import type { KonsiAssortmentGapSuggestion, KonsiSuggestion } from "@/lib/field-sales/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { suggestedGapQty } from "./suggested-qty";

type Props = {
  store: { id: string; name: string };
  gaps: KonsiAssortmentGapSuggestion[];
  neverSent: KonsiSuggestion[];
  /* True when that suggestion query failed and its list was replaced with an empty one. */
  gapsFailed: boolean;
  neverSentFailed: boolean;
  salesmen: Array<{ id: string; name: string }>;
  defaultSalesmanId: string | null;
};

type PushSource = "GAP" | "NEVER_SENT" | "ADDED";

type PushRow = {
  itemId: string;
  variantSku: string;
  label: string;
  source: PushSource;
  available: number | null;
  target: number | null;
  onHand: number | null;
  inTransit: number | null;
  priceUnset: boolean;
  checked: boolean;
  qtyRaw: string;
};

type CatalogMeta = {
  itemId: string;
  variantSku: string;
  sku: string;
  name: string;
  variantLabel: string | null;
  priceUnset: boolean;
};

type CatalogState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; options: SearchableComboboxOption[]; metaByKey: Map<string, CatalogMeta> }
  | { status: "error" };

function rowKey(itemId: string, variantSku: string): string {
  return `${itemId}::${variantSku}`;
}

function productLabel(sku: string, name: string, variantLabel: string | null): string {
  return variantLabel ? `${sku} — ${name} · ${variantLabel}` : `${sku} — ${name}`;
}

/* The line qty column is a 32-bit Int; the action refuses anything above it, so the form does too. */
const MAX_QTY = 2147483647;

function isValidQty(raw: string): boolean {
  return /^\d+$/.test(raw) && Number(raw) > 0 && Number(raw) <= MAX_QTY;
}

function buildInitialRows(gaps: KonsiAssortmentGapSuggestion[], neverSent: KonsiSuggestion[]): Map<string, PushRow> {
  const rows = new Map<string, PushRow>();
  for (const g of gaps) {
    const key = rowKey(g.itemId, g.variantSku);
    const qty = suggestedGapQty({ target: g.targetQty, onHand: g.onHandQty, inTransit: g.inTransitQty, available: g.available });
    rows.set(key, {
      itemId: g.itemId,
      variantSku: g.variantSku,
      label: productLabel(g.sku, g.name, g.variantLabel),
      source: "GAP",
      available: g.available,
      target: g.targetQty,
      onHand: g.onHandQty,
      inTransit: g.inTransitQty,
      priceUnset: g.priceUnset,
      checked: qty !== null,
      qtyRaw: qty === null ? "" : String(qty),
    });
  }
  for (const s of neverSent) {
    const key = rowKey(s.itemId, s.variantSku);
    if (rows.has(key)) continue;
    rows.set(key, {
      itemId: s.itemId,
      variantSku: s.variantSku,
      label: productLabel(s.sku, s.name, s.variantLabel),
      source: "NEVER_SENT",
      available: s.available,
      target: null,
      onHand: null,
      inTransit: null,
      priceUnset: s.priceUnset,
      checked: false,
      qtyRaw: "",
    });
  }
  return rows;
}

export function KonsiPushForm({ store, gaps, neverSent, gapsFailed, neverSentFailed, salesmen, defaultSalesmanId }: Props) {
  const t = useTranslations("konsiPush");
  const router = useRouter();

  const [rows, setRows] = useState<Map<string, PushRow>>(() => buildInitialRows(gaps, neverSent));
  const [salesmanId, setSalesmanId] = useState(defaultSalesmanId ?? "");
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();
  const inFlight = useRef(false);

  const [catalog, setCatalog] = useState<CatalogState>({ status: "idle" });
  const catalogRequested = useRef(false);
  const [addKey, setAddKey] = useState("");

  const gapRows = useMemo(() => Array.from(rows.values()).filter((r) => r.source === "GAP"), [rows]);
  const neverSentRows = useMemo(() => Array.from(rows.values()).filter((r) => r.source === "NEVER_SENT"), [rows]);
  const addedRows = useMemo(() => Array.from(rows.values()).filter((r) => r.source === "ADDED"), [rows]);

  const checkedRows = useMemo(() => Array.from(rows.values()).filter((r) => r.checked), [rows]);
  const selectedUnits = checkedRows.reduce((sum, r) => (isValidQty(r.qtyRaw) ? sum + Number(r.qtyRaw) : sum), 0);
  const blockReason =
    salesmanId === ""
      ? t("needSalesman")
      : checkedRows.length === 0
        ? t("needLine")
        : checkedRows.some((r) => !isValidQty(r.qtyRaw))
          ? t("invalidQty")
          : null;
  const canSubmit = !isPending && blockReason === null;

  const filteredCatalogOptions = useMemo(() => {
    if (catalog.status !== "loaded") return [];
    return catalog.options.filter((opt) => !rows.has(opt.value));
  }, [catalog, rows]);

  function toggleRow(key: string): void {
    setRows((prev) => {
      const row = prev.get(key);
      if (!row) return prev;
      const next = new Map(prev);
      /* Ticking an empty row starts it at 1, so it does not open on a qty error; unticking keeps the value. */
      const checked = !row.checked;
      next.set(key, { ...row, checked, qtyRaw: checked && row.qtyRaw === "" ? "1" : row.qtyRaw });
      return next;
    });
  }

  function setQty(key: string, qtyRaw: string): void {
    setRows((prev) => {
      const row = prev.get(key);
      if (!row) return prev;
      const next = new Map(prev);
      next.set(key, { ...row, qtyRaw });
      return next;
    });
  }

  async function loadCatalog(): Promise<void> {
    setCatalog({ status: "loading" });
    try {
      const items = await getItems({ isActive: true, type: "FINISHED_GOOD" });
      const list = Array.isArray(items) ? items : [];
      const options: SearchableComboboxOption[] = [];
      const metaByKey = new Map<string, CatalogMeta>();
      for (const item of list as unknown as Array<{ id: string; sku: string; nameId: string; variants: unknown; sellingPrice: number | null }>) {
        const priceUnset = item.sellingPrice == null;
        const variantRows = parseItemVariants(item.variants);
        if (itemHasSkuVariants(item.variants)) {
          for (const variant of variantSelectOptions(variantRows)) {
            const key = rowKey(item.id, variant.sku);
            options.push({ value: key, label: `${item.sku} — ${item.nameId} · ${variant.label}` });
            metaByKey.set(key, { itemId: item.id, variantSku: variant.sku, sku: item.sku, name: item.nameId, variantLabel: variant.label, priceUnset });
          }
        } else {
          const key = rowKey(item.id, "");
          options.push({ value: key, label: `${item.sku} — ${item.nameId}` });
          metaByKey.set(key, { itemId: item.id, variantSku: "", sku: item.sku, name: item.nameId, variantLabel: null, priceUnset });
        }
      }
      setCatalog({ status: "loaded", options, metaByKey });
    } catch {
      setCatalog({ status: "error" });
    }
  }

  /* Loaded on mount rather than on first open, so a keyboard user opening the list never finds it empty. */
  useEffect(() => {
    if (catalogRequested.current) return;
    catalogRequested.current = true;
    void loadCatalog();
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; a retry calls loadCatalog directly */
  }, []);

  function handleAddProduct(key: string): void {
    if (!key || catalog.status !== "loaded") return;
    const meta = catalog.metaByKey.get(key);
    if (!meta) return;
    setRows((prev) => {
      if (prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, {
        itemId: meta.itemId,
        variantSku: meta.variantSku,
        label: productLabel(meta.sku, meta.name, meta.variantLabel),
        source: "ADDED",
        available: null,
        target: null,
        onHand: null,
        inTransit: null,
        priceUnset: meta.priceUnset,
        checked: true,
        qtyRaw: "1",
      });
      return next;
    });
    setAddKey("");
  }

  function errorMessage(result: Extract<KonsiPushActionResult, { ok: false }>): string {
    if (result.reason === "INSUFFICIENT_STOCK") {
      const products = (result.shortLines ?? [])
        .map((s) => rows.get(rowKey(s.itemId, s.variantSku))?.label ?? s.itemId)
        .join(", ");
      return t("err.INSUFFICIENT_STOCK", { products });
    }
    if (result.reason === "REPLAY_MISMATCH") return t("err.REPLAY_MISMATCH", { orderNo: result.detail ?? "" });
    const key = `err.${result.reason}`;
    if (!t.has(key)) return t("err.UNEXPECTED");
    if (result.detail) {
      const product = rows.get(result.detail)?.label ?? result.detail;
      return t(key, { product });
    }
    return t(key);
  }

  function submit(): void {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const result = await createKonsiPushOrderAction({
          storeId: store.id,
          salesmanId,
          note: note.trim() || undefined,
          idempotencyKey,
          lines: checkedRows.map((r) => ({ itemId: r.itemId, variantSku: r.variantSku, qty: Number(r.qtyRaw) })),
        });
        if (result.ok) {
          toast.success(t("success", { orderNo: result.orderNo }));
          setIdempotencyKey(crypto.randomUUID());
          router.push(`/backoffice/field-sales-orders/${result.orderId}`);
          return;
        }
        toast.error(errorMessage(result));
      } catch {
        toast.error(t("err.UNEXPECTED"));
      } finally {
        inFlight.current = false;
      }
    });
  }

  function renderRow(row: PushRow, showGapColumns: boolean) {
    const key = rowKey(row.itemId, row.variantSku);
    return (
      <TableRow key={key}>
        <TableCell>
          <Checkbox checked={row.checked} onCheckedChange={() => toggleRow(key)} aria-label={row.label} />
        </TableCell>
        <TableCell className="max-w-[220px]">
          <span className="block truncate" title={row.label}>
            {row.label}
          </span>
          {row.priceUnset && <span className="block truncate text-xs italic text-muted-foreground">{t("priceUnset")}</span>}
        </TableCell>
        {showGapColumns && (
          <>
            <TableCell className="text-right tabular-nums">{row.target ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              <span>{row.onHand ?? "—"}</span>
              {row.inTransit !== null && row.inTransit > 0 && (
                <p className="text-xs text-muted-foreground">{t("onOrder", { n: row.inTransit })}</p>
              )}
            </TableCell>
          </>
        )}
        <TableCell className="text-right tabular-nums">{row.available ?? "—"}</TableCell>
        <TableCell>
          <Input
            inputMode="numeric"
            className="h-10 w-24 tabular-nums"
            aria-label={t("qtyFor", { product: row.label })}
            disabled={!row.checked}
            value={row.qtyRaw}
            onChange={(e) => setQty(key, e.target.value)}
          />
          {row.checked && !isValidQty(row.qtyRaw) && <p className="text-xs text-destructive">{t("invalidQty")}</p>}
          {row.checked && row.available !== null && isValidQty(row.qtyRaw) && Number(row.qtyRaw) > row.available && (
            <p className="text-xs text-muted-foreground">{t("overAvailable", { available: row.available })}</p>
          )}
        </TableCell>
      </TableRow>
    );
  }

  function renderTable(list: PushRow[], showGapColumns: boolean) {
    return (
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>{t("colProduct")}</TableHead>
              {showGapColumns && (
                <>
                  <TableHead className="text-right">{t("colTarget")}</TableHead>
                  <TableHead className="text-right">{t("colOnHand")}</TableHead>
                </>
              )}
              <TableHead className="text-right">{t("colAvailable")}</TableHead>
              <TableHead>{t("colQty")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{list.map((row) => renderRow(row, showGapColumns))}</TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-40 lg:pb-6">
      <div className="flex flex-col gap-1">
        <Button asChild variant="ghost" className="-ml-2 h-10 w-fit">
          <Link href={`/backoffice/stores/${store.id}`}>
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle", { store: store.name })}</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1.5">
            <Label htmlFor="konsi-push-salesman">{t("salesman")}</Label>
            <SearchableCombobox
              id="konsi-push-salesman"
              options={salesmen.map((s) => ({ value: s.id, label: s.name }))}
              value={salesmanId}
              onValueChange={setSalesmanId}
              disabled={isPending}
              placeholder={t("salesmanPlaceholder")}
              searchPlaceholder={t("salesmanPlaceholder")}
              emptyMessage={t("noSalesman")}
              triggerClassName="h-10 w-full sm:w-80"
            />
            {salesmen.length === 0 && <p className="text-xs text-muted-foreground">{t("noSalesman")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="konsi-push-note">{t("note")}</Label>
            <Textarea
              id="konsi-push-note"
              maxLength={500}
              disabled={isPending}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            {t("gaps")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({gapRows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gapRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {gapsFailed ? t("suggestionsError") : t("emptyGaps")}
            </p>
          ) : (
            renderTable(gapRows, true)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageX className="h-4 w-4" />
            {t("neverSent")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({neverSentRows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {neverSentRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {neverSentFailed ? t("suggestionsError") : t("emptyNeverSent")}
            </p>
          ) : (
            renderTable(neverSentRows, false)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlusCircle className="h-4 w-4" />
            {t("added")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">({addedRows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={catalog.status === "loaded" ? "konsi-push-add-product" : undefined}>{t("addProduct")}</Label>
            {(catalog.status === "idle" || catalog.status === "loading") && (
              <p className="text-sm text-muted-foreground">{t("catalogLoading")}</p>
            )}
            {catalog.status === "error" && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-destructive">{t("catalogError")}</p>
                <Button variant="outline" className="h-10" onClick={() => void loadCatalog()}>
                  {t("catalogRetry")}
                </Button>
              </div>
            )}
            {catalog.status === "loaded" && (
              <SearchableCombobox
                id="konsi-push-add-product"
                options={filteredCatalogOptions}
                value={addKey}
                onValueChange={handleAddProduct}
                disabled={isPending}
                placeholder={t("searchProduct")}
                searchPlaceholder={t("searchProduct")}
                emptyMessage={t("noProductMatch")}
                triggerClassName="h-10 w-full sm:w-96"
              />
            )}
          </div>

          {addedRows.length > 0 && renderTable(addedRows, false)}
        </CardContent>
      </Card>

      {checkedRows.some((r) => r.priceUnset) && <p className="text-xs text-muted-foreground">{t("priceUnsetNote")}</p>}

      {/**
        * `pr-28` (112px) clears `QuickActionFAB` (`components/QuickActionFAB.tsx`), which is
        * `fixed bottom-6 right-6 z-50` with an `h-14 w-14` button on every backoffice route —
        * without this clearance an operator on a phone taps the FAB instead of Submit. `lg:`
        * drops back to a normal in-flow row once there is room beside it, matching the settlement
        * approval bar's sticky footer.
        */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 py-3 pl-3 pr-28 backdrop-blur lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:pr-0 lg:backdrop-blur-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{t("selected", { lines: checkedRows.length, units: selectedUnits })}</p>
            {!isPending && blockReason !== null && <p className="text-xs text-muted-foreground">{blockReason}</p>}
          </div>
          <Button className="h-10 w-full sm:w-auto" disabled={!canSubmit} onClick={submit}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPending ? t("submitting") : t("submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
