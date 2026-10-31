"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarX, ListChecks, Loader2, RefreshCw, TrendingDown, Unlink, UserRoundSearch, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { BAGIAN_PERIKSA, tautanKol, type BagianPeriksa, type BarisPeriksa, type GrupPeriksa, type HasilPeriksa, type JenisPeriksa } from "@/lib/creative/periksa-data";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { dinamis, type TerjemahDinamis } from "@/lib/i18n/dinamis";

const IKON_BAGIAN: Record<BagianPeriksa, LucideIcon> = {
  kembar: UserRoundSearch,
  yatim: Unlink,
  tanggal: CalendarX,
  angka: TrendingDown,
  kelengkapan: ListChecks,
};

export function PeriksaClient({ hasil }: { hasil: HasilPeriksa }) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [memuat, mulai] = useTransition();
  const waktu = formatDisplayDateTime(hasil.diperiksaPada, locale);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.periksa")}
        meta={hasil.total > 0 ? t("periksa.meta", { n: angkaTitik(hasil.total), waktu }) : t("periksa.metaBersih", { waktu })}
        actions={
          <Button variant="outline" onClick={() => mulai(() => router.refresh())} disabled={memuat}>
            {memuat ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            {t("periksa.ulang")}
          </Button>
        }
      />
      {BAGIAN_PERIKSA.map((bagian) => {
        const grup = hasil.grup.filter((g) => g.bagian === bagian);
        if (!grup.length) return null;
        const Ikon = IKON_BAGIAN[bagian];
        const jumlah = grup.reduce((s, g) => s + g.jumlah, 0);
        return (
          <Card key={bagian} className="gap-4">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ikon className="h-4 w-4" aria-hidden />
                {td(`periksa.bagian.${bagian}`)}
              </CardTitle>
              <StatusPill tone={jumlah > 0 ? "attention" : "settled"}>{jumlah > 0 ? t("periksa.temuan", { n: angkaTitik(jumlah) }) : t("periksa.bersih")}</StatusPill>
            </CardHeader>
            <CardContent className="space-y-4">
              {grup.map((g) => (
                <Grup key={g.jenis} g={g} td={td} locale={locale} />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Grup({ g, td, locale }: { g: GrupPeriksa; td: TerjemahDinamis; locale: string }) {
  const sisa = g.jumlah - g.baris.length;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{td(`periksa.jenis.${g.jenis}`)}</h3>
        <span className={g.jumlah > 0 ? "text-sm font-semibold tabular-nums text-red-600 dark:text-red-400" : "text-sm tabular-nums text-muted-foreground"}>
          {g.jumlah > 0 ? angkaTitik(g.jumlah) : td("periksa.tidakAda")}
        </span>
      </div>
      {g.baris.length ? (
        <ul className="divide-y rounded-md border">
          {g.baris.map((b) => (
            <li key={`${g.jenis}:${b.id}`} className="space-y-0.5 px-3 py-2 text-sm">
              {b.tautan ? (
                <Link href={b.tautan} className="font-medium text-tautan hover:underline">
                  {b.judul}
                </Link>
              ) : (
                <span className="font-medium">{b.judul}</span>
              )}
              {b.sub ? <p className="truncate text-xs text-muted-foreground">{b.sub}</p> : null}
              <Rincian jenis={g.jenis} b={b} td={td} locale={locale} />
            </li>
          ))}
        </ul>
      ) : null}
      {sisa > 0 ? <p className="text-xs text-muted-foreground">{td("periksa.lainnya", { n: angkaTitik(sisa) })}</p> : null}
    </section>
  );
}

function Rincian({ jenis, b, td, locale }: { jenis: JenisPeriksa; b: BarisPeriksa; td: TerjemahDinamis; locale: string }) {
  const r = b.rincian;
  const kelas = "text-xs text-muted-foreground";
  switch (r.macam) {
    case "KEMBAR":
      return (
        <div className="space-y-1">
          <p className={kelas}>
            {[r.waSama ? td("periksa.rincian.waSama", { wa: `+${r.waSama}` }) : null, r.handleSama ? td("periksa.rincian.handleSama", { handle: `@${r.handleSama}` }) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {r.anggota.map((a) => (
              <Link key={a.id} href={tautanKol(a.id)} className="text-tautan hover:underline">
                {a.nama}
              </Link>
            ))}
          </div>
        </div>
      );
    case "YATIM":
      return (
        <p className={kelas}>
          {td("periksa.rincian.yatim", { id: r.indukId })}
          {r.waktu ? ` · ${formatDisplayDateTime(r.waktu, locale)}` : ""}
        </p>
      );
    case "TANGGAL":
      return (
        <p className={kelas}>
          {td(jenis === "CAMPAIGN_TANGGAL_TERBALIK" ? "periksa.rincian.tanggalCampaign" : "periksa.rincian.tanggalKolaborasi", {
            mulai: formatDisplayDate(r.mulai, locale),
            selesai: formatDisplayDate(r.selesai, locale),
          })}
        </p>
      );
    case "TAYANG":
      return <p className={kelas}>{td("periksa.rincian.tayang", { tanggal: formatDisplayDateTime(r.tayang, locale) })}</p>;
    case "LIKE_VIEWS":
      return (
        <p className={kelas}>
          {td("periksa.rincian.likeViews", { likes: angkaTitik(r.likes), views: angkaTitik(r.views), waktu: formatDisplayDateTime(r.waktu, locale) })}
          {r.kali > 1 ? ` · ${td("periksa.rincian.kali", { n: r.kali })}` : ""}
        </p>
      );
    case "VIEWS_TURUN":
      return (
        <p className={kelas}>
          {td("periksa.rincian.viewsTurun", {
            sebelum: angkaTitik(r.sebelum),
            waktuSebelum: formatDisplayDateTime(r.waktuSebelum, locale),
            sesudah: angkaTitik(r.sesudah),
            waktu: formatDisplayDateTime(r.waktu, locale),
          })}
          {r.kali > 1 ? ` · ${td("periksa.rincian.kali", { n: r.kali })}` : ""}
        </p>
      );
    case "TAHAP":
      return <p className={kelas}>{td("periksa.rincian.tahap", { tahap: td(`tahap.${r.tahap}`) })}</p>;
    case "KOSONG":
      return null;
  }
}
