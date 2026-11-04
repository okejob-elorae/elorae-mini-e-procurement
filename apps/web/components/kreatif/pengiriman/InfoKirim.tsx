"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDisplayDate } from "@/lib/date-only";
import { LABEL_PLATFORM, type Platform } from "@/lib/creative/aturan";
import { alamatAda, alamatLengkap, barisKota, nomorHpTampil, type PeringatanDobel } from "@/lib/creative/sampel-aturan";
import type { KolRingkas } from "@/lib/creative/sampel-queries";
import { cn } from "@/lib/utils";

/*
 * Potongan tampilan yang sama di antrean Sampel dan panel Pengiriman: siapa
 * KOL-nya, ke mana paketnya, dan apakah orang yang sama pernah dikirimi.
 */

/** "@handle" tebal, di bawahnya "Platform · 0812-…" — atau "no HP kosong" merah. */
export function KolSampel({ kol }: { kol: KolRingkas }) {
  const t = useTranslations("kreatifRuang.sampel");
  const hp = nomorHpTampil(kol);
  const platform = kol.platform && kol.platform in LABEL_PLATFORM ? LABEL_PLATFORM[kol.platform as Platform] : kol.platform;
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{kol.handle ? `@${kol.handle}` : kol.nama}</div>
      {kol.handle ? <div className="truncate text-xs text-muted-foreground">{kol.nama}</div> : null}
      <div className="text-xs text-muted-foreground">
        {platform ? `${platform} · ` : ""}
        {hp ? <span className="tabular-nums">{hp}</span> : <span className="font-semibold text-destructive">{t("noHpKosong")}</span>}
      </div>
    </div>
  );
}

/**
 * Alamat LENGKAP (bukan hanya kota — bug KOL Manager): dua baris terlihat,
 * sisanya dibuka di tempat; "Salin alamat" menyalin nama penerima, HP, alamat,
 * dan kota sekaligus untuk ditempel ke aplikasi kurir.
 */
export function AlamatKirim({ kol, className }: { kol: KolRingkas; className?: string }) {
  const t = useTranslations("kreatifRuang.sampel");
  const [buka, setBuka] = useState(false);
  const data = { ...kol, name: kol.nama };
  if (!alamatAda(data)) {
    return <span className={cn("text-sm font-semibold text-destructive", className)}>{t("alamatKosong")}</span>;
  }
  const kota = barisKota(data);
  const panjang = (kol.address ?? "").length > 60;
  const salin = async () => {
    try {
      await navigator.clipboard.writeText(alamatLengkap(data));
      toast.success(t("alamatTersalin"));
    } catch {
      toast.error(t("salinGagal"));
    }
  };
  return (
    <div className={cn("min-w-0 text-sm", className)}>
      {kol.recipientName?.trim() && kol.recipientName.trim() !== kol.nama ? (
        <div className="text-xs text-muted-foreground">{kol.recipientName}</div>
      ) : null}
      <div className={cn("break-words whitespace-pre-line", !buka && "line-clamp-2")}>{kol.address}</div>
      {kota ? <div className="text-xs text-muted-foreground">{kota}</div> : null}
      <div className="mt-1 flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={salin}>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t("salinAlamat")}
        </Button>
        {panjang ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-expanded={buka} onClick={() => setBuka((b) => !b)}>
            {buka ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
            {buka ? t("tutupAlamat") : t("lihatAlamat")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Peringatan kirim dobel — peringatan, bukan penolakan. */
export function PeringatanKirimDobel({ dobel, rinci = false }: { dobel: readonly PeringatanDobel[]; rinci?: boolean }) {
  const t = useTranslations("kreatifRuang.sampel.dobel");
  const locale = useLocale();
  if (dobel.length === 0) return null;
  const pertama = dobel[0];
  const teks = (d: PeringatanDobel) =>
    [
      d.docNo,
      d.kolNama,
      t(`sebab.${d.sebab}`),
      d.campaignSama ? t("campaignSama") : d.campaignNama,
      d.sentAt ? formatDisplayDate(d.sentAt, locale) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  if (rinci) {
    return (
      <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm" role="status">
        <p className="font-medium text-amber-800 dark:text-amber-300">{t("judul")}</p>
        <ul className="space-y-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
          {dobel.map((d) => (
            <li key={d.kolaborasiId}>{teks(d)}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <StatusPill
      tone="waiting"
      detail={
        <span className="text-xs text-muted-foreground" title={dobel.map(teks).join("\n")}>
          {teks(pertama)}
          {dobel.length > 1 ? ` ${t("lainnya", { n: dobel.length - 1 })}` : ""}
        </span>
      }
    >
      {t("judul")}
    </StatusPill>
  );
}
