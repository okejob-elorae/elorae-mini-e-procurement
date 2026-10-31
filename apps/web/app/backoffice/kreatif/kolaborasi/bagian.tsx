"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDisplayDate, parseDateOnly } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { LABEL_PLATFORM, type Platform } from "@/lib/creative/aturan";
import { nadaTahap } from "@/lib/creative/kolaborasi-tampil";
import { isJalurKeluar, tujuanPindah, type Tahap } from "@/lib/creative/tahap";
import type { Tenggat } from "@/lib/creative/tenggat";
import { cn } from "@/lib/utils";

/*
 * Potongan tampilan kolaborasi yang dipakai tabel, papan, campaign, dan rincian.
 */

export function PilTahap({ tahap, className }: { tahap: Tahap; className?: string }) {
  const t = dinamis(useTranslations("kreatifRuang.tahap"));
  return (
    <StatusPill tone={nadaTahap(tahap)} className={className}>
      {t(tahap)}
    </StatusPill>
  );
}

/**
 * Tahap sebagai pilihan langsung di baris. Hanya tujuan yang sah menurut
 * aturan yang ditawarkan (`tujuanPindah`); jalur keluar dipisah garis.
 */
export function PilihTahapInline({
  tahap,
  onPilih,
  disabled,
  ariaLabel,
}: {
  tahap: Tahap;
  onPilih: (ke: Tahap) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const t = dinamis(useTranslations("kreatifRuang.tahap"));
  const tujuan = tujuanPindah(tahap);
  const jalan = tujuan.filter((x) => !isJalurKeluar(x));
  const keluar = tujuan.filter((x) => isJalurKeluar(x));
  return (
    <Select value={tahap} onValueChange={(v) => v !== tahap && onPilih(v as Tahap)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-8 w-[150px] text-xs" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={tahap}>{t(tahap)}</SelectItem>
        {jalan.length ? <SelectSeparator /> : null}
        {jalan.map((x) => (
          <SelectItem key={x} value={x}>
            {t(x)}
          </SelectItem>
        ))}
        {keluar.length ? <SelectSeparator /> : null}
        {keluar.map((x) => (
          <SelectItem key={x} value={x} className="text-destructive">
            {t(x)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tenggat berikutnya: jenis + tanggal, merah dengan ⚠ bila lewat. */
export function TenggatSingkat({ tenggat, hariIni }: { tenggat: Tenggat | null; hariIni: string }) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const locale = useLocale();
  if (!tenggat) return <span className="text-muted-foreground">—</span>;
  const tanggal =
    tenggat.tanggal === hariIni ? t("kolaborasi.tenggatHariIni") : formatDisplayDate(parseDateOnly(tenggat.tanggal), locale);
  return (
    <span className={cn("inline-flex flex-col leading-tight", tenggat.lewat && "font-medium text-destructive")}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {tenggat.lewat ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
        {tk(`tenggat.${tenggat.jenis}`)}
      </span>
      <span className={cn("text-xs tabular-nums", !tenggat.lewat && "text-muted-foreground")}>
        {tenggat.lewat ? t("kolaborasi.tenggatLewat", { n: tenggat.lewatHari }) : tanggal}
      </span>
    </span>
  );
}

/** "@handle · Instagram · Bandung" */
export function subKol(kol: { handle: string | null; platform: Platform | null; city: string | null }): string {
  return [kol.handle ? `@${kol.handle}` : null, kol.platform ? LABEL_PLATFORM[kol.platform] : null, kol.city]
    .filter(Boolean)
    .join(" · ");
}

/** Umur di tahap: merah tebal bila lewat ambang Pengaturan. */
export function UmurTahap({ hari, merah }: { hari: number; merah: boolean }) {
  const t = useTranslations("kreatifRuang.kolaborasi");
  return (
    <span
      className={cn("whitespace-nowrap tabular-nums", merah ? "font-semibold text-destructive" : "text-muted-foreground")}
      title={t("umurJudul", { n: hari })}
    >
      {t("umurHariPenuh", { n: Math.max(0, hari) })}
    </span>
  );
}

/** Kartu angka kecil (views, order, GMV, ROAS, terpakai…). */
export function KartuAngka({
  label,
  children,
  bawah,
  className,
}: {
  label: string;
  children: React.ReactNode;
  bawah?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{children}</p>
      {bawah ? <div className="mt-1">{bawah}</div> : null}
    </div>
  );
}
