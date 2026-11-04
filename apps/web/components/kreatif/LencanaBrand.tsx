"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { JenisBrand, LabelBrand } from "@/lib/creative/brand-collab";

/** Lencana "Elorae" / "Kompetitor" di samping handle brand (dari Kreatif → Pengaturan → Brand & kompetitor). */
export function LencanaBrand({ label }: { label: LabelBrand | null }) {
  const t = useTranslations("kreatifRuang.brand.label");
  if (!label) return null;
  return (
    <Badge variant={label === "ELORAE" ? "default" : "outline"} className="h-5 px-1.5 text-[11px]">
      {t(label)}
    </Badge>
  );
}

const NADA_JENIS: Record<JenisBrand, StatusTone> = { BERBAYAR: "progress", KOLABORASI: "waiting", TAG: "inactive" };

/** Jenis kerja sama sebuah posting: berbayar, kolaborasi, atau tag biasa. */
export function PilJenisBrand({ jenis }: { jenis: JenisBrand }) {
  const t = useTranslations("kreatifRuang.brand.jenis");
  return <StatusPill tone={NADA_JENIS[jenis]}>{t(jenis)}</StatusPill>;
}
