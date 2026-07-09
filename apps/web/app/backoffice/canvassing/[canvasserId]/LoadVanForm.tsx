"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { loadVanAction } from "@/app/actions/canvassing";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type ItemOption = { id: string; sku: string; nameId: string; variants?: unknown };

type LineRow = { id: string; itemId: string; variantSku: string | null; qty: number };

type ShortLine = { itemId: string; variantSku: string | null; requested: number; available: number };

type Props = {
  canvasserId: string;
  itemOptions: ItemOption[];
};

function emptyLine(): LineRow {
  return { id: `line-${Date.now()}-${Math.random().toString(36).slice(2)}`, itemId: "", variantSku: null, qty: 0 };
}

export function LoadVanForm({ canvasserId, itemOptions }: Props) {
  const t = useTranslations("canvassing");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [note, setNote] = useState("");
  const [shortLines, setShortLines] = useState<ShortLine[]>([]);

  function updateLine(id: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));
  }

  function itemLabel(itemId: string): string {
    const opt = itemOptions.find((i) => i.id === itemId);
    return opt ? `${opt.sku} - ${opt.nameId}` : itemId;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    setShortLines([]);

    // Van loading is item-level (stock is tracked per item, not per variant — see BOUNDARY D15).
    const validLines = lines
      .filter((l) => l.itemId && l.qty > 0)
      .map((l) => ({ itemId: l.itemId, variantSku: null, qty: l.qty }));

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
          setLines([emptyLine()]);
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
                  {sl.variantSku ? ` (${sl.variantSku})` : ""} — {t("shortLineDetail", { requested: sl.requested, available: sl.available })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {lines.map((line) => {
          return (
            <div key={line.id} className="space-y-2 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("item")}</Label>
                <SearchableCombobox
                  options={itemOptions.map((i) => ({ value: i.id, label: `${i.sku} - ${i.nameId}` }))}
                  value={line.itemId}
                  onValueChange={(value) => updateLine(line.id, { itemId: value })}
                  placeholder={t("selectItem")}
                  disabled={pending}
                />
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">{t("colQty")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    disabled={pending}
                    value={line.qty || ""}
                    onChange={(e) => updateLine(line.id, { qty: parseFloat(e.target.value) || 0 })}
                    placeholder="0"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={pending || lines.length === 1}
                  onClick={() => removeLine(line.id)}
                  aria-label={t("removeLine")}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={addLine}>
        <Plus className="mr-2 h-4 w-4" />
        {t("addLine")}
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
