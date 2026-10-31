"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";
import type { ItemImageSubmission } from "@/lib/items/images/types";

type Props = {
  variantSku: string | null;
  items: ItemImageSubmission[];
  onChange: (next: ItemImageSubmission[]) => void;
  onUpload: (files: File[], variantSku: string | null) => Promise<string[]>;
  canManage: boolean;
};

export function ImageGallery({ variantSku, items, onChange, onUpload, canManage }: Props) {
  const t = useTranslations("items.images");
  const [busy, setBusy] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const urls = await onUpload(files, variantSku);
      const startOrder = items.length;
      const additions: ItemImageSubmission[] = urls.map((url, i) => ({
        url,
        variantSku,
        sortOrder: startOrder + i,
      }));
      onChange([...items, ...additions]);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  function move(idx: number, delta: number) {
    const next = [...items];
    const target = idx + delta;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next.map((it, i) => ({ ...it, sortOrder: i })));
  }

  function remove(idx: number) {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.map((it, i) => ({ ...it, sortOrder: i })));
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {items.map((it, idx) => (
        <div
          key={it.id ?? it.url}
          className="relative w-20 h-20 rounded border overflow-hidden group"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.url} alt="" className="w-full h-full object-cover" />
          {canManage && (
            // Tetap ada di DOM (bukan display:none) supaya tombolnya bisa dicapai papan ketik.
            <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                className="text-white"
                aria-label={t("moveLeft")}
              >
                <ArrowLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => move(idx, +1)}
                className="text-white"
                aria-label={t("moveRight")}
              >
                <ArrowRight className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-white"
                aria-label={t("removeImage")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}
      {canManage && (
        <label
          className="w-20 h-20 rounded border-2 border-dashed flex items-center justify-center cursor-pointer hover:bg-muted/50 focus-within:ring-2 focus-within:ring-ring"
          title={t("addImage")}
          aria-busy={busy}
        >
          <span className="sr-only">{t("addImage")}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={handlePick}
          />
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
          )}
        </label>
      )}
    </div>
  );
}
