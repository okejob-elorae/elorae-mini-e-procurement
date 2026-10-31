"use client";

import { LayoutGrid, Rows3, SquareKanban } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { JenisTampilan } from "@/lib/tampilan/tampilan";

const IKON = { tabel: Rows3, galeri: LayoutGrid, papan: SquareKanban } as const;

/**
 * Tombol ganti tampilan ala Notion/Airtable: Tabel · Galeri · Papan.
 * Satu kelompok tombol radio — panah kiri/kanan berpindah pilihan.
 */
export function PilihTampilan({
  nilai,
  pilihan,
  onUbah,
  className,
}: {
  nilai: JenisTampilan;
  pilihan: readonly JenisTampilan[];
  onUbah: (v: JenisTampilan) => void;
  className?: string;
}) {
  const t = useTranslations("tampilan");
  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className={cn("inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const i = pilihan.indexOf(nilai);
        const j = (i + (e.key === "ArrowRight" ? 1 : pilihan.length - 1)) % pilihan.length;
        onUbah(pilihan[j]);
      }}
    >
      {pilihan.map((p) => {
        const Ikon = IKON[p];
        const aktif = p === nilai;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={aktif}
            tabIndex={aktif ? 0 : -1}
            onClick={() => onUbah(p)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              aktif ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Ikon className="h-4 w-4" aria-hidden />
            {t(p)}
          </button>
        );
      })}
    </div>
  );
}
