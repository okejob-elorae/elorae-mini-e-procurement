"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ClipboardCheck, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { saveCountsAction } from "@/app/actions/store-stocktakes";
import { SpgStocktakeAddItemSheet, type AddableItem } from "./SpgStocktakeAddItemSheet";

export type SpgStocktakeLine = {
  lineId: string;
  itemId: string;
  itemSku: string;
  variantSku: string;
  productName: string;
  expectedQty: number;
  countedQty: number | null;
  isAdded: boolean;
};

type PendingLine = { key: string; itemId: string; itemSku: string; variantSku: string; productName: string };

/** Blank means "not counted" — never coerced to 0, never treated as invalid. */
function parseCountedInput(raw: string): { value: number | null; valid: boolean } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, valid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return { value: null, valid: false };
  return { value: n, valid: true };
}

export function SpgStocktakeShell({ storeId, storeName, lines }: { storeId: string; storeName: string; lines: SpgStocktakeLine[] }) {
  const t = useTranslations("storeStocktakes.spg");
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [pendingLines, setPendingLines] = useState<PendingLine[]>([]);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener("online", set);
    window.addEventListener("offline", set);
    return () => {
      window.removeEventListener("online", set);
      window.removeEventListener("offline", set);
    };
  }, []);

  const existingKeys = useMemo(() => {
    const keys = new Set(lines.map((l) => `${l.itemId}::${l.variantSku}`));
    for (const p of pendingLines) keys.add(`${p.itemId}::${p.variantSku}`);
    return keys;
  }, [lines, pendingLines]);

  function rawFor(lineId: string, storedCountedQty: number | null): string {
    return counts[lineId] ?? (storedCountedQty === null ? "" : String(storedCountedQty));
  }

  function updateCount(key: string, value: string): void {
    setCounts((prev) => ({ ...prev, [key]: value }));
  }

  function addPendingLine(item: AddableItem): void {
    setPendingLines((prev) => [...prev, { key: `new:${item.itemId}::${item.variantSku}`, ...item }]);
  }

  function removePendingLine(key: string): void {
    setPendingLines((prev) => prev.filter((p) => p.key !== key));
    setCounts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const computedExisting = lines.map((l) => {
    const raw = rawFor(l.lineId, l.countedQty);
    const { value, valid } = parseCountedInput(raw);
    return { line: l, raw, counted: value, valid };
  });
  const computedPending = pendingLines.map((p) => {
    const raw = rawFor(p.key, null);
    const { value, valid } = parseCountedInput(raw);
    return { line: p, raw, counted: value, valid };
  });

  const countedCount = [...computedExisting, ...computedPending].filter((c) => c.counted !== null).length;
  const totalCount = lines.length + pendingLines.length;
  const hasInvalidInput = [...computedExisting, ...computedPending].some((c) => !c.valid);

  const needle = q.trim().toLowerCase();
  const filteredExisting = needle
    ? computedExisting.filter(
        (c) => c.line.productName.toLowerCase().includes(needle) || c.line.itemSku.toLowerCase().includes(needle),
      )
    : computedExisting;
  const filteredPending = needle
    ? computedPending.filter(
        (c) => c.line.productName.toLowerCase().includes(needle) || c.line.itemSku.toLowerCase().includes(needle),
      )
    : computedPending;

  const canSubmit = online && !submitting && !hasInvalidInput;

  function onSubmit(): void {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    (async () => {
      try {
        const payloadLines = computedExisting.map((c) => ({ lineId: c.line.lineId, countedQty: c.counted }));
        const addedLines = computedPending.map((c) => ({
          itemId: c.line.itemId,
          variantSku: c.line.variantSku,
          countedQty: c.counted,
        }));
        const result = await saveCountsAction({ storeId, lines: payloadLines, addedLines, submit: true });
        if (result.ok) {
          setSubmitted(true);
          return;
        }
        setSubmitError(t(`err.${result.code}`));
      } catch {
        setSubmitError(t("err.ERROR"));
      } finally {
        setSubmitting(false);
      }
    })();
  }

  if (submitted) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="rounded-full bg-primary p-3">
              <ClipboardCheck className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <p className="text-lg font-semibold">{t("success.title")}</p>
              <p className="mt-2 text-sm text-muted-foreground">{t("success.body")}</p>
            </div>
          </CardContent>
        </Card>
        <Button asChild className="w-full py-3 text-lg font-medium">
          <Link href="/pwa">{t("success.backHome")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa">
            <ArrowLeft className="h-4 w-4" />
            {t("back")}
          </Link>
        </Button>
      </header>

      <div>
        <h1 className="text-lg font-semibold">{storeName}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {!online && (
        <Alert className="border-amber-500/50 text-amber-700 [&>svg]:text-amber-600">
          <AlertDescription className="text-amber-700">{t("offlineNotice")}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Input placeholder={t("searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} className="h-10" />
        <Button type="button" variant="outline" size="icon-lg" onClick={() => setAddItemOpen(true)} aria-label={t("addItem.button")}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {totalCount === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          </CardContent>
        </Card>
      )}

      {totalCount > 0 && filteredExisting.length === 0 && filteredPending.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("noResults")}</p>
      )}

      <div className="flex flex-col gap-2">
        {filteredExisting.map((c) => (
          <Card key={c.line.lineId} className="flex flex-row items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{c.line.productName}</p>
                {c.line.isAdded && (
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {t("addedBadge")}
                  </Badge>
                )}
              </div>
              {c.line.variantSku && <p className="truncate text-xs text-muted-foreground">{c.line.variantSku}</p>}
              <p className="text-xs text-muted-foreground">{t("expectedLabel", { qty: c.line.expectedQty })}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={`${t("countInputLabel")} ${c.line.productName}`}
                placeholder={t("countPlaceholder")}
                className="h-10 w-24 text-right tabular-nums"
                disabled={submitting}
                value={c.raw}
                onChange={(e) => updateCount(c.line.lineId, e.target.value)}
              />
              {!c.valid && <p className="text-right text-xs text-destructive">{t("countInvalid")}</p>}
            </div>
          </Card>
        ))}

        {filteredPending.map((c) => (
          <Card key={c.line.key} className="flex flex-row items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{c.line.productName}</p>
                <Badge variant="outline" className="shrink-0 text-xs">
                  {t("addedBadge")}
                </Badge>
              </div>
              {c.line.variantSku && <p className="truncate text-xs text-muted-foreground">{c.line.variantSku}</p>}
              <p className="text-xs text-muted-foreground">{t("expectedLabel", { qty: 0 })}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex flex-col items-end gap-1">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  aria-label={`${t("countInputLabel")} ${c.line.productName}`}
                  placeholder={t("countPlaceholder")}
                  className="h-10 w-24 text-right tabular-nums"
                  disabled={submitting}
                  value={c.raw}
                  onChange={(e) => updateCount(c.line.key, e.target.value)}
                />
                {!c.valid && <p className="text-right text-xs text-destructive">{t("countInvalid")}</p>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                disabled={submitting}
                onClick={() => removePendingLine(c.line.key)}
                aria-label={t("removeAdded")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div aria-hidden style={{ height: 84 }} />

      <div className="sticky bottom-0 -mx-4 -mb-4 space-y-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("footer.tally", { counted: countedCount, total: totalCount })}</span>
        </div>
        <Button type="button" className="w-full" size="lg" onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("footer.submitting")}
            </>
          ) : (
            t("footer.submit")
          )}
        </Button>
      </div>

      <SpgStocktakeAddItemSheet
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        existingKeys={existingKeys}
        onAdd={(item) => {
          addPendingLine(item);
          setAddItemOpen(false);
        }}
      />
    </div>
  );
}
