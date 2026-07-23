"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { loadVanAction } from "@/app/actions/canvassing";
import type { LoadableInventoryRow } from "@/lib/canvassing/queries";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type ItemOption = { id: string; sku: string; nameId: string; variants?: unknown };

// One block = one item. `qty` is keyed by variantSku; a simple item uses the "" slot.
// This makes loading many variants of one item a single item pick + several qty inputs,
// and makes duplicate item/variant selection structurally impossible.
type Block = { id: string; itemId: string; qty: Record<string, number> };

type ShortLine = { itemId: string; variantSku: string | null; requested: number; available: number };

type Props = {
  canvasserId: string;
  itemOptions: ItemOption[];
  loadableInventory: LoadableInventoryRow[];
};

function emptyBlock(): Block {
  return { id: `blk-${Date.now()}-${Math.random().toString(36).slice(2)}`, itemId: "", qty: {} };
}

export function LoadVanForm({ canvasserId, itemOptions, loadableInventory }: Props) {
  const t = useTranslations("canvassing");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [blocks, setBlocks] = useState<Block[]>([emptyBlock()]);
  const [note, setNote] = useState("");
  const [shortLines, setShortLines] = useState<ShortLine[]>([]);

  const availByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of loadableInventory) m.set(`${r.itemId}::${r.variantSku ?? ""}`, r.available);
    return m;
  }, [loadableInventory]);

  const variantOptsByItem = useMemo(() => {
    const m = new Map<string, { sku: string; label: string }[]>();
    for (const i of itemOptions) m.set(i.id, variantSelectOptions(parseItemVariants(i.variants)));
    return m;
  }, [itemOptions]);

  function availableFor(itemId: string, variantSku: string): number {
    return availByKey.get(`${itemId}::${variantSku}`) ?? 0;
  }

  // Items already chosen in OTHER blocks — one block owns an entire item, so it can't be re-picked.
  function itemOptionsFor(blockId: string): ItemOption[] {
    const taken = new Set(blocks.filter((b) => b.id !== blockId && b.itemId).map((b) => b.itemId));
    return itemOptions.filter((i) => !taken.has(i.id));
  }

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function setQty(id: string, variantSku: string, qty: number) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, qty: { ...b.qty, [variantSku]: qty } } : b)));
  }

  function addBlock() {
    setBlocks((prev) => [...prev, emptyBlock()]);
  }

  function removeBlock(id: string) {
    setBlocks((prev) => (prev.length === 1 ? prev : prev.filter((b) => b.id !== id)));
  }

  function itemLabel(itemId: string): string {
    const opt = itemOptions.find((i) => i.id === itemId);
    return opt ? `${opt.sku} - ${opt.nameId}` : itemId;
  }

  function variantLabelFor(itemId: string, sku: string): string {
    const v = (variantOptsByItem.get(itemId) ?? []).find((x) => x.sku === sku);
    return v ? v.label : sku;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    setShortLines([]);

    const validLines: Array<{ itemId: string; variantSku: string | null; qty: number }> = [];
    for (const b of blocks) {
      if (!b.itemId) continue;
      const hasVariants = (variantOptsByItem.get(b.itemId) ?? []).length > 0;
      for (const [sku, qty] of Object.entries(b.qty)) {
        if (qty > 0) validLines.push({ itemId: b.itemId, variantSku: hasVariants ? sku : null, qty });
      }
    }

    if (validLines.length === 0) {
      toast.error(t("errEmpty"));
      return;
    }

    startTransition(async () => {
      try {
        const result = await loadVanAction({ canvasserId, lines: validLines, note: note.trim() || undefined });
        if (result.ok) {
          toast.success(t("loadedSuccess", { docNo: result.docNo }));
          router.refresh();
          setBlocks([emptyBlock()]);
          setNote("");
          return;
        }
        if (result.reason === "INSUFFICIENT_STOCK") {
          setShortLines(result.shortLines ?? []);
          toast.error(t("errInsufficientStock"));
        } else if (result.reason === "FORBIDDEN") {
          toast.error(t("errForbidden"));
        } else if (result.reason === "VALIDATION") {
          toast.error(t("errValidation"));
        } else {
          toast.error(t("errEmpty"));
        }
      } catch {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {shortLines.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="mb-1 font-medium">{t("errInsufficientStock")}</p>
            <ul className="space-y-1 text-sm">
              {shortLines.map((sl, idx) => (
                <li key={idx}>
                  {itemLabel(sl.itemId)}
                  {sl.variantSku ? ` (${variantLabelFor(sl.itemId, sl.variantSku)})` : ""} — {t("shortLineDetail", { requested: sl.requested, available: sl.available })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {blocks.map((block) => {
          const vOpts = block.itemId ? variantOptsByItem.get(block.itemId) ?? [] : [];
          const hasVariants = vOpts.length > 0;
          return (
            <div key={block.id} className="space-y-3 rounded-md border p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">{t("item")}</Label>
                  <SearchableCombobox
                    options={itemOptionsFor(block.id).map((i) => ({ value: i.id, label: `${i.sku} - ${i.nameId}` }))}
                    value={block.itemId}
                    onValueChange={(value) => updateBlock(block.id, { itemId: value, qty: {} })}
                    placeholder={t("selectItem")}
                    disabled={pending}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-6"
                  disabled={pending || blocks.length === 1}
                  onClick={() => removeBlock(block.id)}
                  aria-label={t("removeLine")}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              {block.itemId && hasVariants && (() => {
                // Only variants with stock to transfer are loadable — hide 0-available ones
                // (the writer would reject them anyway) so a many-variant item stays scannable.
                const loadable = vOpts.filter((v) => availableFor(block.itemId, v.sku) > 0);
                const hiddenZero = vOpts.length - loadable.length;
                if (loadable.length === 0) {
                  return <p className="text-xs text-muted-foreground">{t("noLoadableStock")}</p>;
                }
                return (
                  <div className="space-y-2">
                    {loadable.map((v) => {
                      const avail = availableFor(block.itemId, v.sku);
                      const qty = block.qty[v.sku] ?? 0;
                      const over = qty > avail;
                      return (
                        <div key={v.sku} className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{v.label}</p>
                            <p className={`text-xs ${over ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
                              {t("available")}: <span className="tabular-nums">{avail}</span>
                            </p>
                          </div>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            disabled={pending}
                            value={qty || ""}
                            onChange={(e) => setQty(block.id, v.sku, parseFloat(e.target.value) || 0)}
                            placeholder="0"
                            className="w-24 text-right"
                          />
                        </div>
                      );
                    })}
                    {hiddenZero > 0 && (
                      <p className="text-xs text-muted-foreground">{t("zeroVariantsHidden", { count: hiddenZero })}</p>
                    )}
                  </div>
                );
              })()}

              {block.itemId && !hasVariants && (() => {
                const avail = availableFor(block.itemId, "");
                if (avail <= 0) {
                  return <p className="text-xs text-muted-foreground">{t("noLoadableStock")}</p>;
                }
                const qty = block.qty[""] ?? 0;
                const over = qty > avail;
                return (
                  <div className="flex items-center gap-3">
                    <p className={`flex-1 text-xs ${over ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>
                      {t("available")}: <span className="tabular-nums">{avail}</span>
                    </p>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={pending}
                      value={qty || ""}
                      onChange={(e) => setQty(block.id, "", parseFloat(e.target.value) || 0)}
                      placeholder="0"
                      className="w-24 text-right"
                    />
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={addBlock}>
        <Plus className="mr-2 h-4 w-4" />
        {t("addItem")}
      </Button>

      <div className="space-y-1.5">
        <Label htmlFor="van-load-note" className="text-xs">{t("note")}</Label>
        <Textarea
          id="van-load-note"
          rows={2}
          maxLength={500}
          disabled={pending}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("notePlaceholder")}
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
