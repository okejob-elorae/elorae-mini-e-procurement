"use client";

import { useTranslations } from "next-intl";
import type { AngkaSetoranWo } from "@/lib/production/setoran-wo";
import { cn } from "@/lib/utils";

const angka = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

/**
 * Satu kalimat angka setoran WO, sama di rincian, layar terima dan
 * rekonsiliasi: "Target 120 pcs · Disetor 120 pcs (cacat 2) · Masuk stok 118 pcs · Kurang 2 pcs".
 * Angkanya selalu dari `angkaSetoranWo` (lib/production/setoran-wo.ts).
 */
export function RingkasSetoran({ angkaWo, className }: { angkaWo: AngkaSetoranWo; className?: string }) {
  const t = useTranslations("workOrders.setoran");
  const bagian = [
    t("target", { qty: angka(angkaWo.target) }),
    angkaWo.cacat > 0
      ? t("disetorCacat", { qty: angka(angkaWo.disetor), cacat: angka(angkaWo.cacat) })
      : t("disetor", { qty: angka(angkaWo.disetor) }),
    t("masukStok", { qty: angka(angkaWo.masukStok) }),
    angkaWo.lebih > 0
      ? t("lebih", { qty: angka(angkaWo.lebih) })
      : angkaWo.kurang > 0
        ? t("kurang", { qty: angka(angkaWo.kurang) })
        : t("terpenuhi"),
  ];
  return (
    <span className={cn("flex flex-wrap gap-x-2 gap-y-0.5", className)}>
      {bagian.map((b, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 ? <span aria-hidden className="mr-2 text-muted-foreground">·</span> : null}
          {b}
        </span>
      ))}
    </span>
  );
}

/** Peringatan bila kolom setoran WO tidak cocok dengan dokumen penerimaannya (data lama/contoh). */
export function CatatanTanpaDokumen({ angkaWo }: { angkaWo: AngkaSetoranWo }) {
  const t = useTranslations("workOrders.setoran");
  if (angkaWo.tanpaDokumen === 0) return null;
  return (
    <p className="text-sm text-amber-800 dark:text-amber-300">
      {t("tanpaDokumen", { qty: angka(Math.abs(angkaWo.tanpaDokumen)) })}
    </p>
  );
}
