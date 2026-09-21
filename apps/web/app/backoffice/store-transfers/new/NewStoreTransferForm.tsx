"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import {
  createStoreTransferAction,
  getSourceStockAction,
  type StoreTransferActionResult,
} from "@/app/actions/store-transfers";
import type { StoreStockOptionRow } from "@/lib/stores/transfer/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";

type StoreOption = { id: string; name: string };

// One line = one item/variant, keyed on "itemId::variantSku" so duplicate selection is
// structurally impossible — same idiom LoadVanForm uses one level up (item-only) for van loads.
type Line = { id: string; key: string; qty: string };

type Props = {
  storeOptions: StoreOption[];
};

type SourceStockState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; rows: StoreStockOptionRow[] }
  | { status: "error" };

type ActionErrorCode = Exclude<StoreTransferActionResult, { ok: true }>["code"];

function errKey(code: ActionErrorCode): string {
  return `err.${code}`;
}

function emptyLine(): Line {
  return { id: `ln-${Date.now()}-${Math.random().toString(36).slice(2)}`, key: "", qty: "" };
}

/**
 * Splits a "itemId::variantSku" composite key on the FIRST separator only. A naive
 * `.split("::")` truncates a `variantSku` that itself contains "::" to its first segment — the
 * writer then finds no matching source `StoreStock` row under the truncated key, `sourceAvgCost`
 * falls to 0, and `moveStoreStock` opens a brand-new phantom row at negative quantity while the
 * real row's stock sits untouched (and the ledger is append-only, so that split can never be
 * merged back). `itemId` is a cuid and never contains "::", so the separator is always the FIRST
 * one and everything after it — however many more "::" the variant SKU itself holds — is the
 * variant.
 */
function splitLineKey(key: string): { itemId: string; variantSku: string } {
  const sepIdx = key.indexOf("::");
  return sepIdx === -1 ? { itemId: key, variantSku: "" } : { itemId: key.slice(0, sepIdx), variantSku: key.slice(sepIdx + 2) };
}

export function NewStoreTransferForm({ storeOptions }: Props) {
  const t = useTranslations("storeTransfers");
  const tNew = useTranslations("storeTransfers.new");
  const router = useRouter();
  const [pending, startSubmitTransition] = useTransition();
  const [, startStockTransition] = useTransition();

  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [sourceStock, setSourceStock] = useState<SourceStockState>({ status: "idle" });
  // Only surface a started-but-empty-qty row as an error AFTER a submit was attempted — flagging
  // it the instant an item is picked, before the operator has had a chance to type a quantity,
  // would nag rather than inform.
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const fromOptions = useMemo(
    () => storeOptions.filter((s) => s.id !== toStoreId).map((s) => ({ value: s.id, label: s.name })),
    [storeOptions, toStoreId],
  );
  const toOptions = useMemo(
    () => storeOptions.filter((s) => s.id !== fromStoreId).map((s) => ({ value: s.id, label: s.name })),
    [storeOptions, fromStoreId],
  );

  const stockRows = sourceStock.status === "loaded" ? sourceStock.rows : [];
  const rowByKey = useMemo(() => {
    const m = new Map<string, StoreStockOptionRow>();
    for (const r of stockRows) m.set(`${r.itemId}::${r.variantSku}`, r);
    return m;
  }, [stockRows]);

  function loadSourceStock(storeId: string): void {
    setLines([emptyLine()]);
    if (!storeId) {
      setSourceStock({ status: "idle" });
      return;
    }
    setSourceStock({ status: "loading" });
    startStockTransition(async () => {
      try {
        const rows = await getSourceStockAction(storeId);
        setSourceStock({ status: "loaded", rows });
      } catch {
        setSourceStock({ status: "error" });
      }
    });
  }

  // A key already used on another line can't be picked again — mirrors LoadVanForm's
  // "one block owns an item" rule, just at item+variant granularity since each row here is
  // already a distinct item/variant.
  function lineOptionsFor(lineId: string) {
    const taken = new Set(lines.filter((l) => l.id !== lineId && l.key).map((l) => l.key));
    return stockRows
      .filter((r) => !taken.has(`${r.itemId}::${r.variantSku}`))
      .map((r) => ({
        value: `${r.itemId}::${r.variantSku}`,
        label: r.variantSku
          ? `${r.itemSku} — ${r.productName} · ${r.variantSku} (${tNew("stockShort", { qty: r.qty })})`
          : `${r.itemSku} — ${r.productName} (${tNew("stockShort", { qty: r.qty })})`,
      }));
  }

  function updateLine(id: string, patch: Partial<Line>): void {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine(): void {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string): void {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  // A "started" line is one with an item picked (it has a matching source-stock row) — an
  // untouched blank row at the end is never started and is silently ignored, same as before.
  // A STARTED row with no positive quantity is different: it used to be dropped from the
  // submitted payload with no warning, quietly shrinking a four-line transfer to two. Now it
  // blocks submission instead (see `invalidQtyLineIds` and the inline error under each such
  // row's quantity input) — silence was the actual defect, not which of the two fixes was
  // picked.
  const qtyOf = (l: Line): number => parseFloat(l.qty) || 0;
  const startedLines = lines.filter((l) => rowByKey.get(l.key) != null);
  const invalidQtyLineIds = new Set(startedLines.filter((l) => !(qtyOf(l) > 0)).map((l) => l.id));
  const hasInvalidQty = invalidQtyLineIds.size > 0;

  const validLines = startedLines
    .filter((l) => qtyOf(l) > 0)
    .map((l) => ({ ...splitLineKey(l.key), qty: qtyOf(l) }));

  const sameStore = !!fromStoreId && !!toStoreId && fromStoreId === toStoreId;
  // What the SUBMIT BUTTON is gated on — everything except quantity validity. Quantity errors
  // are deliberately left able to reach `onSubmit` (rather than disabling the button for them
  // too) so a click with an empty qty on a started row actually fires the handler below and
  // surfaces the inline error, instead of the button just sitting inertly disabled with no
  // feedback at all.
  const formReady = !!fromStoreId && !!toStoreId && !sameStore && startedLines.length > 0 && !pending;
  const canSubmit = formReady && !hasInvalidQty;

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!canSubmit) return;

    startSubmitTransition(async () => {
      try {
        const result = await createStoreTransferAction({
          fromStoreId,
          toStoreId,
          note: note.trim() || undefined,
          lines: validLines,
        });
        if (result.ok) {
          toast.success(tNew("success", { docNo: result.docNo ?? "" }));
          router.push(`/backoffice/store-transfers/${result.id}`);
          return;
        }
        toast.error(t(errKey(result.code)));
      } catch {
        toast.error(t(errKey("ERROR")));
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/backoffice/store-transfers">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("back")}
          </Link>
        </Button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{tNew("title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{tNew("fromStore")}</Label>
                <SearchableCombobox
                  options={fromOptions}
                  value={fromStoreId}
                  onValueChange={(v) => {
                    setFromStoreId(v);
                    loadSourceStock(v);
                  }}
                  placeholder={tNew("selectStore")}
                  searchPlaceholder={tNew("searchStore")}
                  emptyMessage={tNew("noStores")}
                  disabled={pending}
                  triggerClassName="w-full min-h-[44px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{tNew("toStore")}</Label>
                <SearchableCombobox
                  options={toOptions}
                  value={toStoreId}
                  onValueChange={setToStoreId}
                  placeholder={tNew("selectStore")}
                  searchPlaceholder={tNew("searchStore")}
                  emptyMessage={tNew("noStores")}
                  disabled={pending}
                  triggerClassName="w-full min-h-[44px]"
                />
              </div>
            </div>
            {sameStore && <p className="text-sm text-destructive">{tNew("sameStoreError")}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="transfer-note">{tNew("note")}</Label>
              <Textarea
                id="transfer-note"
                rows={2}
                maxLength={500}
                disabled={pending}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={tNew("notePlaceholder")}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tNew("linesTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!fromStoreId ? (
              <p className="text-sm text-muted-foreground">{tNew("selectFromStoreFirst")}</p>
            ) : sourceStock.status === "loading" ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : sourceStock.status === "error" ? (
              <p className="text-sm text-destructive">{tNew("stockLoadError")}</p>
            ) : stockRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tNew("noStock")}</p>
            ) : (
              <>
                {lines.map((line) => {
                  const row = rowByKey.get(line.key);
                  const qtyNum = parseFloat(line.qty) || 0;
                  const over = row != null && qtyNum > row.qty;
                  const invalidQty = submitAttempted && invalidQtyLineIds.has(line.id);
                  return (
                    <div key={line.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label className="text-xs">{tNew("item")}</Label>
                          <SearchableCombobox
                            options={lineOptionsFor(line.id)}
                            value={line.key}
                            onValueChange={(v) => updateLine(line.id, { key: v })}
                            placeholder={tNew("selectItem")}
                            searchPlaceholder={tNew("searchItem")}
                            emptyMessage={tNew("noMatchingItem")}
                            disabled={pending}
                            triggerClassName="w-full"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-6 shrink-0"
                          disabled={pending || lines.length <= 1}
                          onClick={() => removeLine(line.id)}
                          aria-label={tNew("removeLine")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      {row && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <p
                              className={`flex-1 text-xs ${
                                over ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"
                              }`}
                            >
                              {tNew("available")}: <span className="tabular-nums">{row.qty}</span>
                              {over && ` — ${tNew("overNote")}`}
                            </p>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              inputMode="decimal"
                              disabled={pending}
                              aria-invalid={invalidQty}
                              value={line.qty}
                              onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                              placeholder="0"
                              className={`w-28 shrink-0 text-right min-h-[40px] ${
                                invalidQty ? "border-destructive focus-visible:ring-destructive/20" : ""
                              }`}
                            />
                          </div>
                          {invalidQty && (
                            <p className="text-right text-xs text-destructive" role="alert">
                              {tNew("qtyRequired")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={addLine}>
                  <Plus className="mr-2 h-4 w-4" />
                  {tNew("addLine")}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Button type="submit" disabled={!formReady} className="w-full sm:w-auto min-h-[44px]">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {pending ? tNew("submitting") : tNew("submit")}
        </Button>
      </form>
    </div>
  );
}
