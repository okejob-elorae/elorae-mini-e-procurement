"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { KeadaanInden } from "@/lib/field-sales/inden";

/** Warna keadaan: hijau = menerima pesanan, kuning = menunggu barang datang, biru = sudah dirilis. */
const NADA: Record<KeadaanInden, string> = {
  BELUM_BUKA: "bg-muted text-muted-foreground",
  BUKA: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  TUTUP: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DIRILIS: "bg-primary/20 text-foreground",
  NONAKTIF: "bg-muted text-muted-foreground line-through",
};

export function LencanaKeadaan({ keadaan, className }: { keadaan: KeadaanInden; className?: string }) {
  const t = useTranslations("inden.keadaan");
  return (
    <Badge variant="outline" className={cn("border-transparent", NADA[keadaan], className)}>
      {t(keadaan)}
    </Badge>
  );
}
