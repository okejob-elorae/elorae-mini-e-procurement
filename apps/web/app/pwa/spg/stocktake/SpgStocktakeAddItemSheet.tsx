"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchStocktakeItemsAction } from "@/app/actions/store-stocktakes";

export type AddableItem = { itemId: string; itemSku: string; variantSku: string; productName: string };

type CatalogState =
  | { status: "loading" }
  | { status: "loaded"; items: AddableItem[]; truncated: boolean }
  | { status: "error" };

/** Wait this long after the last keystroke before searching, so typing a word sends one request. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Add-item picker for the SPG stock count — a shelf item the ledger has no `StoreStock` row
 * for. Mirrors the backoffice's own add-item dialog (`StocktakeDetailClient.tsx`), same
 * `searchStocktakeItemsAction` server search, but as a tap-to-add bottom sheet instead of a
 * desktop combobox, matching this screen's other mobile pickers (`SpgVariantSheet`).
 */
export function SpgStocktakeAddItemSheet({
  open,
  onOpenChange,
  existingKeys,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: Set<string>;
  onAdd: (item: AddableItem) => void;
}) {
  const t = useTranslations("storeStocktakes.spg.addItem");
  const [q, setQ] = useState("");
  const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setCatalog({ status: "loading" });
    const timer = setTimeout(async () => {
      try {
        const result = await searchStocktakeItemsAction(q);
        if (!alive) return;
        if (!result.ok) {
          setCatalog({ status: "error" });
          return;
        }
        const items: AddableItem[] = result.options.map((o) => ({
          itemId: o.itemId,
          itemSku: o.itemSku,
          variantSku: o.variantSku,
          productName: o.variantLabel ? `${o.itemName} · ${o.variantLabel}` : o.itemName,
        }));
        setCatalog({ status: "loaded", items, truncated: result.truncated });
      } catch {
        if (alive) setCatalog({ status: "error" });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, q]);

  const filtered = useMemo(() => {
    if (catalog.status !== "loaded") return [];
    return catalog.items.filter((it) => !existingKeys.has(`${it.itemId}::${it.variantSku}`));
  }, [catalog, existingKeys]);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setQ("");
        onOpenChange(next);
      }}
    >
      <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("searchPlaceholder")}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pt-3">
          <Input placeholder={t("searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} className="h-10" />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {catalog.status === "loading" && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          )}
          {catalog.status === "error" && <p className="py-6 text-center text-sm text-destructive">{t("loadError")}</p>}
          {catalog.status === "loaded" && filtered.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          )}
          {catalog.status === "loaded" && filtered.length > 0 && (
            <div className="flex flex-col gap-2">
              {filtered.map((it) => {
                const key = `${it.itemId}::${it.variantSku}`;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    onClick={() => onAdd(it)}
                    className="h-auto min-h-10 w-full justify-between gap-3 p-3 text-left font-normal"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.productName}</p>
                      <p className="truncate text-xs text-muted-foreground">{it.itemSku}</p>
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Button>
                );
              })}
              {catalog.truncated && <p className="pt-1 text-center text-xs text-muted-foreground">{t("refineSearch")}</p>}
            </div>
          )}
        </div>

        <SheetFooter className="border-t pt-3">
          <Button type="button" size="lg" className="w-full" onClick={() => onOpenChange(false)}>
            <Check className="h-4 w-4" />
            {t("done")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
