"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Audiens, KeadaanPengumuman } from "@/lib/pengumuman/aturan";

/** Hijau = tampil di HP sekarang; biru = menunggu waktunya; abu = sudah tidak tampil. */
const NADA: Record<KeadaanPengumuman, string> = {
  AKTIF: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  TERJADWAL: "bg-primary/20 text-foreground",
  KEDALUWARSA: "bg-muted text-muted-foreground",
  DIARSIPKAN: "bg-muted text-muted-foreground line-through",
};

export function LencanaKeadaan({ keadaan, className }: { keadaan: KeadaanPengumuman; className?: string }) {
  const t = useTranslations("pengumuman.keadaan");
  return (
    <Badge variant="outline" className={cn("border-transparent", NADA[keadaan], className)}>
      {t(keadaan)}
    </Badge>
  );
}

export function LencanaAudiens({ audience }: { audience: Audiens }) {
  const t = useTranslations("pengumuman.audiens");
  return <Badge variant="secondary">{t(audience)}</Badge>;
}
