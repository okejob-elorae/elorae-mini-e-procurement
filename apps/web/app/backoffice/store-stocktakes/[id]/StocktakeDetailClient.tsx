"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Plus,
  ShoppingBag,
  Trash2,
  XCircle,
} from "lucide-react";
import type {
  StoreStocktakeCauseValue,
  StoreStocktakeDetail,
  StoreStocktakeLineDetail,
  StoreStocktakeStatusValue,
} from "@/lib/stores/stocktake/queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { getItems } from "@/app/actions/items";
import { itemHasSkuVariants, parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import {
  saveCountsAction,
  approveAction,
  cancelAction,
  type StoreStocktakeActionResult,
} from "@/app/actions/store-stocktakes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SearchableCombobox, type SearchableComboboxOption } from "@/components/ui/searchable-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPEN_STATUSES: ReadonlySet<StoreStocktakeStatusValue> = new Set(["DRAFT", "PENDING_VERIFICATION"]);
const CAUSE_VALUES: StoreStocktakeCauseValue[] = ["SHRINKAGE", "UNRECORDED_SALE"];

const STATUS_BADGE_VARIANT: Record<StoreStocktakeStatusValue, "secondary" | "destructive" | "default" | "outline"> = {
  DRAFT: "secondary",
  PENDING_VERIFICATION: "outline",
  APPROVED: "default",
  CANCELLED: "destructive",
};

const STATUS_BADGE_CLASS: Record<StoreStocktakeStatusValue, string> = {
  DRAFT: "",
  PENDING_VERIFICATION: "border-amber-500/40 text-amber-700",
  APPROVED: "",
  CANCELLED: "",
};

/**
 * Every `StoreStocktakeActionResult` failure code, derived from the action module's own type
 * rather than duplicated here — a future code added there is a type error here, not a silent gap.
 */
type ActionErrorCode = Exclude<StoreStocktakeActionResult, { ok: true }>["code"];

function errKey(code: ActionErrorCode): string {
  return `err.${code}`;
}

/** Blank means "not counted" — never coerced to 0, never treated as invalid. */
function parseCountedInput(raw: string): { value: number | null; valid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, valid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { value: null, valid: false };
  return { value: n, valid: true };
}

type PendingAddedLine = {
  key: string;
  itemId: string;
  itemSku: string;
  variantSku: string;
  productName: string;
};

type EditableRow = {
  key: string;
  isPending: boolean;
  itemId: string;
  itemSku: string;
  variantSku: string;
  productName: string;
  expectedQty: number;
  isAdded: boolean;
  liveQty: number;
  storedCountedQty: number | null;
  storedCause: StoreStocktakeCauseValue | null;
  storedReason: string | null;
};

function toEditableRow(l: StoreStocktakeLineDetail): EditableRow {
  return {
    key: l.id,
    isPending: false,
    itemId: l.itemId,
    itemSku: l.itemSku,
    variantSku: l.variantSku,
    productName: l.productName,
    expectedQty: l.expectedQty,
    isAdded: l.isAdded,
    liveQty: l.liveQty,
    storedCountedQty: l.countedQty,
    storedCause: l.cause,
    storedReason: l.reason,
  };
}

function pendingToEditableRow(p: PendingAddedLine): EditableRow {
  return {
    key: p.key,
    isPending: true,
    itemId: p.itemId,
    itemSku: p.itemSku,
    variantSku: p.variantSku,
    productName: p.productName,
    expectedQty: 0,
    isAdded: true,
    liveQty: 0,
    storedCountedQty: null,
    storedCause: null,
    storedReason: null,
  };
}

function VarianceBadge({ counted, variance }: { counted: number | null; variance: number | null }) {
  const t = useTranslations("storeStocktakes.detail");
  if (counted === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30">
        {t("varianceUncounted")}
      </Badge>
    );
  }
  if (variance === 0) {
    return <Badge variant="secondary">{t("varianceMatch")}</Badge>;
  }
  if (variance !== null && variance > 0) {
    return <Badge variant="secondary">{t("varianceSurplus", { n: variance })}</Badge>;
  }
  return <Badge variant="destructive">{t("varianceShort", { n: Math.abs(variance ?? 0) })}</Badge>;
}

export function StocktakeDetailClient({
  stocktake,
  canManage,
}: {
  stocktake: StoreStocktakeDetail;
  canManage: boolean;
}) {
  const t = useTranslations("storeStocktakes");
  const tDetail = useTranslations("storeStocktakes.detail");
  const tFooter = useTranslations("storeStocktakes.footer");
  const tAddItem = useTranslations("storeStocktakes.addItem");
  const tApprove = useTranslations("storeStocktakes.approve");
  const tCancel = useTranslations("storeStocktakes.cancel");
  const tSoldWindow = useTranslations("storeStocktakes.soldWindow");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [causes, setCauses] = useState<Record<string, StoreStocktakeCauseValue | "">>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pendingAdded, setPendingAdded] = useState<PendingAddedLine[]>([]);
  const [saving, startSaveTransition] = useTransition();

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, startApproveTransition] = useTransition();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, startCancelTransition] = useTransition();

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemValue, setAddItemValue] = useState("");
  const [catalog, setCatalog] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; options: SearchableComboboxOption[]; metaByKey: Map<string, { itemId: string; itemSku: string; variantSku: string; productName: string }> }
    | { status: "error" }
  >({ status: "idle" });
  const [catalogPending, startCatalogTransition] = useTransition();

  const isOpenStatus = OPEN_STATUSES.has(stocktake.status);
  const canEdit = canManage && isOpenStatus;
  const canApprove = canManage && isOpenStatus;
  const canCancel = canManage && isOpenStatus;

  const rows: EditableRow[] = [
    ...stocktake.lines.map(toEditableRow),
    ...pendingAdded.map(pendingToEditableRow),
  ];

  function effectiveCountedRaw(row: EditableRow): string {
    return counts[row.key] ?? (row.storedCountedQty === null ? "" : String(row.storedCountedQty));
  }

  function effectiveCause(row: EditableRow): StoreStocktakeCauseValue | "" {
    return causes[row.key] ?? (row.storedCause ?? "");
  }

  function effectiveReason(row: EditableRow): string {
    return reasons[row.key] ?? (row.storedReason ?? "");
  }

  const computedRows = rows.map((row) => {
    const raw = effectiveCountedRaw(row);
    const { value, valid } = parseCountedInput(raw);
    const variance = value === null ? null : value - row.expectedQty;
    return { row, raw, counted: value, valid, variance };
  });

  const countedCount = computedRows.filter((c) => c.counted !== null).length;
  const netVariance = computedRows.reduce((sum, c) => sum + (c.variance ?? 0), 0);
  const hasInvalidInput = computedRows.some((c) => !c.valid);

  const existingKeys = new Set(rows.map((r) => `${r.itemId}::${r.variantSku}`));

  function updateCount(key: string, value: string): void {
    setCounts((prev) => ({ ...prev, [key]: value }));
  }

  function updateCause(key: string, value: StoreStocktakeCauseValue | ""): void {
    setCauses((prev) => ({ ...prev, [key]: value }));
  }

  function updateReason(key: string, value: string): void {
    setReasons((prev) => ({ ...prev, [key]: value }));
  }

  function removePendingRow(key: string): void {
    setPendingAdded((prev) => prev.filter((p) => p.key !== key));
  }

  function resetLocalOverrides(): void {
    setCounts({});
    setCauses({});
    setReasons({});
    setPendingAdded([]);
  }

  function handleSave(): void {
    if (hasInvalidInput) return;
    const lines = computedRows
      .filter((c) => !c.row.isPending)
      .map((c) => ({
        lineId: c.row.key,
        countedQty: c.counted,
        cause: c.variance !== null && c.variance < 0 ? effectiveCause(c.row) || null : null,
        reason: effectiveReason(c.row).trim() || null,
      }));
    const addedLines = computedRows
      .filter((c) => c.row.isPending)
      .map((c) => ({
        itemId: c.row.itemId,
        variantSku: c.row.variantSku,
        countedQty: c.counted,
        cause: c.variance !== null && c.variance < 0 ? effectiveCause(c.row) || null : null,
        reason: effectiveReason(c.row).trim() || null,
      }));

    startSaveTransition(async () => {
      try {
        const result = await saveCountsAction({ stocktakeId: stocktake.id, lines, addedLines, submit: false });
        if (result.ok) {
          toast.success(tFooter("saved"));
          resetLocalOverrides();
          router.refresh();
          return;
        }
        toast.error(t(errKey(result.code)));
      } catch {
        toast.error(t(errKey("ERROR")));
      }
    });
  }

  function callApprove(): void {
    startApproveTransition(async () => {
      try {
        const result = await approveAction(stocktake.id);
        setApproveOpen(false);
        if (result.ok) {
          toast.success(tApprove("success"));
          router.refresh();
          return;
        }
        toast.error(t(errKey(result.code)));
      } catch {
        setApproveOpen(false);
        toast.error(t(errKey("ERROR")));
      }
    });
  }

  function callCancel(): void {
    if (!cancelReason.trim()) return;
    startCancelTransition(async () => {
      try {
        const result = await cancelAction({ stocktakeId: stocktake.id, reason: cancelReason.trim() });
        setCancelOpen(false);
        if (result.ok) {
          toast.success(tCancel("success"));
          setCancelReason("");
          router.refresh();
          return;
        }
        toast.error(t(errKey(result.code)));
      } catch {
        setCancelOpen(false);
        toast.error(t(errKey("ERROR")));
      }
    });
  }

  function openAddItemDialog(): void {
    setAddItemOpen(true);
    setAddItemValue("");
    setCatalog({ status: "loading" });
    startCatalogTransition(async () => {
      try {
        const items = await getItems({ isActive: true });
        const list = Array.isArray(items) ? items : [];
        const options: SearchableComboboxOption[] = [];
        const metaByKey = new Map<
          string,
          { itemId: string; itemSku: string; variantSku: string; productName: string }
        >();
        for (const item of list as Array<{ id: string; sku: string; nameId: string; variants: unknown }>) {
          const variantRows = parseItemVariants(item.variants);
          if (itemHasSkuVariants(item.variants)) {
            for (const variant of variantSelectOptions(variantRows)) {
              const key = `${item.id}::${variant.sku}`;
              if (existingKeys.has(key)) continue;
              options.push({ value: key, label: `${item.sku} — ${item.nameId} · ${variant.label}` });
              metaByKey.set(key, { itemId: item.id, itemSku: item.sku, variantSku: variant.sku, productName: item.nameId });
            }
          } else {
            const key = `${item.id}::`;
            if (existingKeys.has(key)) continue;
            options.push({ value: key, label: `${item.sku} — ${item.nameId}` });
            metaByKey.set(key, { itemId: item.id, itemSku: item.sku, variantSku: "", productName: item.nameId });
          }
        }
        setCatalog({ status: "loaded", options, metaByKey });
      } catch {
        setCatalog({ status: "error" });
      }
    });
  }

  function confirmAddItem(): void {
    if (catalog.status !== "loaded" || !addItemValue) return;
    const meta = catalog.metaByKey.get(addItemValue);
    if (!meta) return;
    setPendingAdded((prev) => [
      ...prev,
      {
        key: `new:${meta.itemId}::${meta.variantSku}`,
        itemId: meta.itemId,
        itemSku: meta.itemSku,
        variantSku: meta.variantSku,
        productName: meta.productName,
      },
    ]);
    setAddItemOpen(false);
  }

  const driftLines = stocktake.lines.filter((l) => l.liveQty !== l.expectedQty);

  const periodLabel = stocktake.periodFrom
    ? tSoldWindow("since", { date: formatDateOnlyJakarta(stocktake.periodFrom) })
    : tSoldWindow("sinceInception");
  const totalSold = stocktake.lines.reduce((sum, l) => sum + l.soldInPeriodQty, 0);
  const soldRows = stocktake.lines.filter((l) => l.soldInPeriodQty > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/backoffice/store-stocktakes">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {tDetail("back")}
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold font-mono">{stocktake.docNo}</h1>
          <Badge variant={STATUS_BADGE_VARIANT[stocktake.status]} className={STATUS_BADGE_CLASS[stocktake.status]}>
            {t(`status.${stocktake.status}`)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {canCancel && (
            <Button variant="outline" className="h-10 text-destructive" disabled={cancelling} onClick={() => setCancelOpen(true)}>
              <XCircle className="h-4 w-4" />
              {tCancel("button")}
            </Button>
          )}
          {canApprove && (
            <Button className="h-10" disabled={approving} onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              {tApprove("button")}
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 space-y-2">
        <h2 className="font-semibold">{tDetail("summaryTitle")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("store")}</span>
            <span className="text-right">{stocktake.storeName}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("countedAt")}</span>
            <span className="text-right">{formatDateOnlyJakarta(stocktake.countedAt)}</span>
          </div>
          <div className="flex justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{tDetail("createdBy")}</span>
            <span className="text-right">{stocktake.createdByLabel}</span>
          </div>
          {stocktake.submittedByLabel && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("submittedBy")}</span>
              <span className="text-right">{stocktake.submittedByLabel}</span>
            </div>
          )}
          {stocktake.approvedByLabel && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("approvedBy")}</span>
              <span className="text-right">{stocktake.approvedByLabel}</span>
            </div>
          )}
          {stocktake.cancelledByLabel && (
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{tDetail("cancelledBy")}</span>
              <span className="text-right">{stocktake.cancelledByLabel}</span>
            </div>
          )}
        </div>
        {stocktake.cancelReason && (
          <p className="text-sm text-muted-foreground">
            {tDetail("cancelReason")}: {stocktake.cancelReason}
          </p>
        )}
        {stocktake.note && (
          <p className="text-sm text-muted-foreground">
            {tDetail("note")}: {stocktake.note}
          </p>
        )}
      </Card>

      <Collapsible defaultOpen>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="flex flex-row cursor-pointer items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="h-4 w-4" />
                {tSoldWindow("title")}
              </CardTitle>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {periodLabel} {tSoldWindow("until", { date: formatDateOnlyJakarta(stocktake.countedAt) })}
              </p>
              {totalSold === 0 ? (
                <p className="text-sm text-muted-foreground">{tSoldWindow("empty")}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{tSoldWindow("total", { count: totalSold })}</p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{tSoldWindow("colProduct")}</TableHead>
                          <TableHead>{tSoldWindow("colVariant")}</TableHead>
                          <TableHead className="text-right">{tSoldWindow("colQty")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {soldRows.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>{l.productName}</TableCell>
                            <TableCell className="font-mono text-sm">{l.variantSku || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{l.soldInPeriodQty}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {tDetail("linesTitle")}
          </CardTitle>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={openAddItemDialog} disabled={saving}>
              <Plus className="h-4 w-4" />
              {tAddItem("button")}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!canEdit && (
            <p className="mb-3 text-sm text-muted-foreground">{tDetail("readOnlyNote")}</p>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tDetail("colProduct")}</TableHead>
                  <TableHead>{tDetail("colVariant")}</TableHead>
                  <TableHead className="text-right">{tDetail("colExpected")}</TableHead>
                  <TableHead className="text-right">{tDetail("colCounted")}</TableHead>
                  <TableHead>{tDetail("colVariance")}</TableHead>
                  <TableHead>{tDetail("colCause")}</TableHead>
                  <TableHead>{tDetail("colReason")}</TableHead>
                  {canEdit && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {computedRows.map(({ row, raw, counted, valid, variance }) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium">{row.productName}</p>
                          <p className="text-xs text-muted-foreground font-mono">{row.itemSku}</p>
                        </div>
                        {row.isAdded && <Badge variant="outline">{tDetail("addedBadge")}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.variantSku || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.expectedQty}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        aria-label={tDetail("colCounted")}
                        placeholder={tDetail("countPlaceholder")}
                        className="h-10 w-28 text-right tabular-nums ml-auto"
                        disabled={!canEdit || saving}
                        value={raw}
                        onChange={(e) => updateCount(row.key, e.target.value)}
                      />
                      {!valid && <p className="mt-1 text-xs text-destructive">{tDetail("countInvalid")}</p>}
                    </TableCell>
                    <TableCell>
                      <VarianceBadge counted={counted} variance={variance} />
                    </TableCell>
                    <TableCell>
                      {variance !== null && variance < 0 ? (
                        <Select
                          value={effectiveCause(row) || "__none__"}
                          onValueChange={(v) => updateCause(row.key, v === "__none__" ? "" : (v as StoreStocktakeCauseValue))}
                          disabled={!canEdit || saving}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder={tDetail("causePlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{tDetail("causePlaceholder")}</SelectItem>
                            {CAUSE_VALUES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {t(`cause.${c}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={tDetail("colReason")}
                        placeholder={tDetail("reasonPlaceholder")}
                        className="h-10 min-w-[160px]"
                        disabled={!canEdit || saving}
                        value={effectiveReason(row)}
                        onChange={(e) => updateReason(row.key, e.target.value)}
                      />
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        {row.isPending && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            aria-label={tDetail("removeAdded")}
                            onClick={() => removePendingRow(row.key)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="sticky bottom-0 z-10 -mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 border-t bg-card px-6 py-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium tabular-nums">{tFooter("tally", { counted: countedCount, total: rows.length })}</span>
              <span className="text-muted-foreground">
                {tFooter("netVariance")}:{" "}
                <span
                  className={
                    netVariance < 0
                      ? "font-medium tabular-nums text-destructive"
                      : "font-medium tabular-nums text-foreground"
                  }
                >
                  {netVariance > 0 ? `+${netVariance}` : netVariance}
                </span>
              </span>
            </div>
            {canEdit && (
              <Button className="h-10" disabled={saving || hasInvalidInput} onClick={handleSave}>
                {saving ? tFooter("saving") : tFooter("save")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={addItemOpen} onOpenChange={(open) => !catalogPending && setAddItemOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tAddItem("dialogTitle")}</DialogTitle>
          </DialogHeader>
          {catalog.status === "loading" ? (
            <p className="text-sm text-muted-foreground">{tAddItem("loading")}</p>
          ) : catalog.status === "error" ? (
            <p className="text-sm text-destructive">{tAddItem("loadError")}</p>
          ) : catalog.status === "loaded" ? (
            <SearchableCombobox
              options={catalog.options}
              value={addItemValue}
              onValueChange={setAddItemValue}
              placeholder={tAddItem("searchPlaceholder")}
              searchPlaceholder={tAddItem("searchPlaceholder")}
              emptyMessage={tAddItem("emptyMessage")}
              triggerClassName="w-full"
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>
              {tAddItem("cancel")}
            </Button>
            <Button disabled={catalog.status !== "loaded" || !addItemValue} onClick={confirmAddItem}>
              {tAddItem("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={approveOpen} onOpenChange={(open) => !approving && setApproveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tApprove("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tApprove("confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          {driftLines.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
              <p className="text-xs font-medium">{tApprove("driftTitle")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {driftLines.map((l) => (
                  <li key={l.id}>
                    {tApprove("driftLine", {
                      product: l.productName,
                      variant: l.variantSku ? ` (${l.variantSku})` : "",
                      expected: l.expectedQty,
                      live: l.liveQty,
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs">{tApprove("driftNote")}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approving}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={approving}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; callApprove() closes it. */
                e.preventDefault();
                callApprove();
              }}
            >
              {approving ? tApprove("submitting") : tApprove("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={cancelOpen} onOpenChange={(open) => !cancelling && setCancelOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tCancel("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tCancel("confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="stocktake-cancel-reason" className="text-xs text-muted-foreground">
              {tCancel("reasonLabel")}
            </Label>
            <Textarea
              id="stocktake-cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={tCancel("reasonPlaceholder")}
              disabled={cancelling}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling || !cancelReason.trim()}
              onClick={(e) => {
                /* Keep the dialog open so the pending label is visible; callCancel() closes it. */
                e.preventDefault();
                callCancel();
              }}
            >
              {cancelling ? tCancel("submitting") : tCancel("confirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
