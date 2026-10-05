"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Minus, Package, Store, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { namaBulan } from "@/lib/salesman/komisi";
import type { BarangTeratasBaris, TokoTeratasBaris } from "@/lib/salesman/riwayat-penjualan-queries";
import type { CapaianTarget, RingkasanBulan, TitikBulan } from "@/lib/salesman/riwayat-penjualan";
import { cn } from "@/lib/utils";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export type DataPenjualan = {
  daftarBulan: string[];
  bulan: string;
  bulanIni: string;
  seri: TitikBulan[];
  ringkas: RingkasanBulan;
  target: CapaianTarget | null;
  toko: TokoTeratasBaris[];
  barang: BarangTeratasBaris[];
};

// Nada dari warna tema, seperti kartu beranda: putus paling pekat, van paling pudar.
const nada = (persen: number) => `color-mix(in oklab, var(--primary) ${persen}%, transparent)`;
const KANAL = [
  { kunci: "putus", label: "channelPutus", warna: nada(100) },
  { kunci: "konsi", label: "channelKonsi", warna: nada(55) },
  { kunci: "van", label: "channelVan", warna: nada(28) },
] as const;
// Kanal di kartu utama (latar warna tema): warna tulisan-di-atas-tema.
const nadaUtama = (persen: number) => `color-mix(in oklab, var(--primary-foreground) ${persen}%, transparent)`;
const NADA_UTAMA = { putus: nadaUtama(90), konsi: nadaUtama(55), van: nadaUtama(28) } as const;

/**
 * Riwayat penjualan per bulan: total dan rinciannya, kemajuan ke target bulan
 * itu, perbandingan dengan bulan lalu dan bulan yang sama tahun lalu, grafik
 * 12 bulan, serta toko dan barang teratas.
 *
 * Pilihan bulan disimpan di alamat (`?bulan=`) dan berpindah dengan `replace`,
 * jadi "Kembali" tidak berjalan mundur melewati setiap bulan yang dilihat.
 */
export function PenjualanClient({ data }: { data: DataPenjualan }) {
  const t = useTranslations("pwaPenjualan");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const locale = useLocale();
  const router = useRouter();
  const [menunggu, mulai] = useTransition();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });
  const pcs = (n: number) => t("pcs", { n: angka.format(n) });

  const nama = (b: string) => namaBulan(tBulan, b, "panjang");
  const pendek = (b: string) => tBulan(`bulanPendek.${Number(b.slice(5, 7))}`);
  const indeks = data.daftarBulan.indexOf(data.bulan);
  const pilih = (b: string) => {
    if (b === data.bulan || !data.daftarBulan.includes(b)) return;
    mulai(() => router.replace(`/pwa/penjualan?bulan=${b}`, { scroll: false }));
  };

  const j = data.ringkas.jumlah;
  // Van tetap dihitung ke omzet, tapi hampir tidak pernah jalan — sembunyikan
  // kanalnya bila setahun penuh nol, seperti kartu beranda.
  const adaVan = data.seri.some((s) => s.van > 0) || j.van > 0;
  const kanal = KANAL.filter((k) => k.kunci !== "van" || adaVan);
  const kosong = j.total === 0 && data.toko.length === 0 && data.barang.length === 0;

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
      </header>

      {/* Pemilih bulan: panah untuk bulan di sebelahnya, daftar untuk melompat. */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={t("prevMonth")}
          disabled={indeks <= 0 || menunggu}
          onClick={() => pilih(data.daftarBulan[indeks - 1])}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <Select value={data.bulan} onValueChange={pilih} disabled={menunggu}>
          <SelectTrigger className="min-w-0 flex-1" aria-label={t("pickMonth")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...data.daftarBulan].reverse().map((b) => (
              <SelectItem key={b} value={b}>
                {b === data.bulanIni ? t("thisMonthOption", { month: nama(b) }) : nama(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label={t("nextMonth")}
          disabled={indeks >= data.daftarBulan.length - 1 || menunggu}
          onClick={() => pilih(data.daftarBulan[indeks + 1])}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <div className={cn("space-y-4 transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        {/* Total bulan itu dan rinciannya per kanal. */}
        <section className="beranda-kartu beranda-kartu-utama">
          <h2 className="beranda-judul">{t("totalTitle", { month: nama(data.bulan) })}</h2>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatIDR(j.total)}</p>
          {data.ringkas.sampaiTanggal !== null ? (
            <p className="text-xs opacity-80">{t("upToDay", { day: data.ringkas.sampaiTanggal })}</p>
          ) : null}
          {j.total > 0 ? (
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full" style={{ background: nadaUtama(15) }} aria-hidden>
              {kanal
                .filter((k) => j[k.kunci] > 0)
                .map((k) => (
                  <span key={k.kunci} style={{ width: `${(j[k.kunci] / j.total) * 100}%`, background: NADA_UTAMA[k.kunci] }} />
                ))}
            </div>
          ) : null}
          {/* Satu kanal satu baris: angka uang tidak pernah terpotong. */}
          <dl className="mt-2 space-y-1">
            {kanal.map((k) => (
              <div key={k.kunci} className="flex items-baseline justify-between gap-3">
                <dt className="flex items-center gap-1.5 text-xs opacity-80">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: NADA_UTAMA[k.kunci] }} />
                  {t(k.label)}
                </dt>
                <dd className="text-sm font-semibold tabular-nums">{formatIDR(j[k.kunci])}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Kemajuan ke target bulan itu. */}
        <section className="beranda-kartu">
          <h2 className="beranda-judul">{t("targetTitle")}</h2>
          {data.target ? (
            <>
              <p className="mt-1 text-sm tabular-nums">
                {t("targetOf", { capai: formatIDR(data.target.capai), target: formatIDR(data.target.target) })}
                <span className="text-muted-foreground"> · {data.target.persen}%</span>
              </p>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, data.target.persen)}
                aria-label={t("targetTitle")}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, data.target.persen)}%` }} />
              </div>
              <p className="mt-1.5 text-xs font-medium tabular-nums">
                {data.target.tercapai ? t("targetReached") : t("targetShort", { amount: formatIDR(data.target.kurang) })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{t("targetNone")}</p>
          )}
        </section>

        {/* Perbandingan. */}
        <section className="beranda-kartu">
          <h2 className="beranda-judul">{t("compareTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("compareHint", { month: nama(data.bulan) })}
            {data.ringkas.sampaiTanggal !== null ? ` ${t("sameDaysNote", { day: data.ringkas.sampaiTanggal })}` : ""}
          </p>
          <ul className="mt-1 divide-y">
            <Banding label={t("prevLabel", { month: nama(data.ringkas.sebulanLalu.bulan) })} total={data.ringkas.sebulanLalu.total} persen={data.ringkas.sebulanLalu.persen} />
            <Banding label={t("yearLabel", { month: nama(data.ringkas.setahunLalu.bulan) })} total={data.ringkas.setahunLalu.total} persen={data.ringkas.setahunLalu.persen} />
          </ul>
        </section>

        {/* Grafik 12 bulan; batang yang dipilih pekat, sisanya pudar. */}
        <section className="beranda-kartu">
          <h2 className="beranda-judul">{t("chartTitle")}</h2>
          <div className="mt-2 h-40" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.seri}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                onClick={(s) => {
                  if (s && typeof s.activeLabel === "string") pilih(s.activeLabel);
                }}
              >
                <XAxis
                  dataKey="bulan"
                  tickFormatter={pendek}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  cursor={{ fill: nada(10) }}
                  content={({ active, payload }) => {
                    const p = active && payload?.length ? (payload[0].payload as TitikBulan) : null;
                    return p ? (
                      <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                        <p className="font-medium">{nama(p.bulan)}</p>
                        <p className="tabular-nums">{formatIDR(p.total)}</p>
                      </div>
                    ) : null;
                  }}
                />
                {kanal.map((k) => (
                  <Bar key={k.kunci} dataKey={k.kunci} stackId="jual" fill={k.warna} isAnimationActive={false} className="cursor-pointer">
                    {data.seri.map((s) => (
                      <Cell key={s.bulan} fillOpacity={s.bulan === data.bulan ? 1 : 0.4} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden>
            {kanal.map((k) => (
              <li key={k.kunci} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: k.warna }} />
                {t(k.label)}
              </li>
            ))}
          </ul>
        </section>

        {kosong ? (
          <section className="beranda-kartu">
            <p className="text-sm text-muted-foreground">{t("emptyMonth", { month: nama(data.bulan) })}</p>
          </section>
        ) : (
          <>
            <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="toko-teratas">
              <div className="px-4 pt-4">
                <h2 id="toko-teratas" className="beranda-judul">{t("storesTitle")}</h2>
              </div>
              {data.toko.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">{t("storesEmpty")}</p>
              ) : (
                <ol className="mt-2 divide-y">
                  {data.toko.map((s, i) => (
                    <li key={s.storeId}>
                      <Link href={`/pwa/stores/${s.storeId}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60">
                        <Peringkat n={i + 1} label={t("rankLabel", { rank: i + 1 })} ikon={Store} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium leading-tight">{s.nama}</span>
                          <span className="block text-xs text-muted-foreground tabular-nums">
                            {/* Pengiriman lama tanpa baris barang punya nilai tapi 0 pcs —
                                "0 pcs · Rp 12 jt" membingungkan, jadi pcs nol tidak ditulis. */}
                            {[s.pcs > 0 ? pcs(s.pcs) : null, s.nilaiTanpaKonsi > 0 ? formatIDR(s.nilaiTanpaKonsi) : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {s.pcsKonsi > 0 ? (
                            <span className="block text-xs text-muted-foreground tabular-nums">{t("konsiPcs", { n: angka.format(s.pcsKonsi) })}</span>
                          ) : null}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="barang-teratas">
              <div className="px-4 pt-4">
                <h2 id="barang-teratas" className="beranda-judul">{t("productsTitle")}</h2>
              </div>
              {data.barang.length === 0 ? (
                <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">{t("productsEmpty")}</p>
              ) : (
                <ol className="mt-2 divide-y">
                  {data.barang.map((b, i) => (
                    <li key={b.itemId} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                      <Peringkat n={i + 1} label={t("rankLabel", { rank: i + 1 })} ikon={Package} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-tight">{b.nama}</span>
                        {b.sku ? <span className="block truncate font-mono text-[11px] text-muted-foreground">{b.sku}</span> : null}
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {pcs(b.pcs)}
                          {b.nilaiTanpaKonsi > 0
                            ? ` · ${b.pcsKonsi > 0 ? t("valueNoKonsi", { amount: formatIDR(b.nilaiTanpaKonsi) }) : formatIDR(b.nilaiTanpaKonsi)}`
                            : ""}
                        </span>
                        {b.pcsKonsi > 0 ? (
                          <span className="block text-xs text-muted-foreground tabular-nums">{t("konsiPcs", { n: angka.format(b.pcsKonsi) })}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Peringkat({ n, label, ikon: Ikon }: { n: number; label: string; ikon: typeof Store }) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums",
        n === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}
      aria-label={label}
    >
      {n <= 3 ? n : <Ikon className="h-4 w-4" aria-hidden />}
    </span>
  );
}

function Banding({ label, total, persen }: { label: string; total: number; persen: number | null }) {
  const t = useTranslations("pwaPenjualan");
  const Ikon = persen === null || persen === 0 ? Minus : persen > 0 ? TrendingUp : TrendingDown;
  const teks =
    persen === null
      ? t("changeNone")
      : persen === 0
        ? t("changeSame")
        : persen > 0
          ? t("changeUp", { pct: persen })
          : t("changeDown", { pct: Math.abs(persen) });
  return (
    <li className="py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-semibold tabular-nums">{formatIDR(total)}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium",
            persen !== null && persen > 0 && "text-emerald-700 dark:text-emerald-400",
            persen !== null && persen < 0 && "text-destructive",
            (persen === null || persen === 0) && "text-muted-foreground",
          )}
        >
          <Ikon className="h-3.5 w-3.5" aria-hidden />
          {teks}
        </span>
      </div>
    </li>
  );
}
