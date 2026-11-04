"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, Lightbulb, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { arahPorsi, PERIODE_ANALISA, type Arah, type BagianLabel, type Wawasan } from "@/lib/salesman/analisa-toko";
import type { HasilAnalisaToko } from "@/lib/salesman/analisa-toko-queries";
import { namaBulan } from "@/lib/salesman/komisi";
import type { DariSpg, HasilPenyerapan } from "@/lib/salesman/penyerapan-queries";
import { cn } from "@/lib/utils";
import { DariSpgKartu, RekomendasiKartu } from "./DariSpgKartu";
import { PenyerapanKartu } from "./PenyerapanKartu";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/**
 * Analisa satu toko di HP. Kalimat ringkas di atas, lalu angkanya: laku vs
 * kiriman (konsinyasi), kategori, artikel teratas dengan ukuran dan warnanya,
 * dan tren bulanan. Rupiah HANYA untuk toko putus — datanya untuk toko
 * konsinyasi memang tidak membawa rupiah (null), bukan sekadar disembunyikan.
 *
 * Pilihan periode di alamat (`?periode=`), berpindah dengan `replace`.
 *
 * Penyerapan per artikel (masuk vs laku vs sisa, dengan saran isi ulang /
 * jangan kirim) menggantikan daftar "laku cepat / belum laku" lama bila
 * datanya disertakan — keduanya membaca sumber yang sama, dan dua daftar untuk
 * pertanyaan yang sama hanya membingungkan. "Dari SPG" dan ajakan membuat
 * rekomendasi tampil juga untuk toko yang belum punya riwayat.
 */
export function AnalisaTokoClient({
  data,
  penyerapan = null,
  dariSpg = null,
  bolehRekomendasi = false,
}: {
  data: HasilAnalisaToko;
  penyerapan?: HasilPenyerapan | null;
  dariSpg?: DariSpg | null;
  bolehRekomendasi?: boolean;
}) {
  const t = useTranslations("pwaAnalisaToko");
  const td = dinamis(t);
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const locale = useLocale();
  const router = useRouter();
  const [menunggu, mulai] = useTransition();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });
  const pcs = (n: number) => t("pcs", { n: angka.format(n) });
  const a = data.analisa;
  const pilih = (p: number) => {
    if (p === data.periode) return;
    mulai(() => router.replace(`/pwa/stores/${data.toko.id}/analisa?periode=${p}`, { scroll: false }));
  };
  const namaKategori = (n: string | null) => n ?? t("noCategory");

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan={`/pwa/stores/${data.toko.id}`} />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{data.toko.nama}</span>
          <Badge variant="outline">{td(`jenis.${data.toko.jenis}`)}</Badge>
        </p>
      </header>

      {/* Periode: 3/6/12 bulan terakhir, dibandingkan dengan periode sebelumnya yang sama panjang. */}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("periodLabel")}>
        {PERIODE_ANALISA.map((p) => (
          <Button
            key={p}
            variant={p === data.periode ? "default" : "outline"}
            aria-pressed={p === data.periode}
            disabled={menunggu}
            onClick={() => pilih(p)}
          >
            {t("periodOption", { n: p })}
          </Button>
        ))}
      </div>

      <div className={cn("space-y-4 transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        {data.kosong ? (
          <section className="beranda-kartu">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <BarChart3 className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h2 className="font-semibold">{t("emptyTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("emptyBody", { n: data.periode * 2 })}</p>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* Kalimat ringkas. */}
            {data.wawasan.length > 0 ? (
              <section className="beranda-kartu beranda-kartu-utama" aria-labelledby="wawasan-judul">
                <h2 id="wawasan-judul" className="beranda-judul flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden />
                  {t("insightTitle")}
                </h2>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {data.wawasan.map((w, i) => (
                    <li key={`${w.kode}-${i}`} className="flex gap-2">
                      <span aria-hidden>•</span>
                      <span>{kalimat(w)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Ringkasan angka periode ini. */}
            <section className="beranda-kartu">
              <h2 className="beranda-judul">{t("totalTitle", { n: data.periode })}</h2>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-2xl font-semibold tabular-nums">{pcs(a.totalPcs)}</span>
                {a.perubahanPcs !== null ? (
                  <span className="text-xs font-medium">
                    <Perubahan persen={a.perubahanPcs} />
                  </span>
                ) : null}
              </p>
              {a.totalNilai !== null ? <p className="text-sm font-medium tabular-nums">{formatIDR(a.totalNilai)}</p> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                {a.perubahanPcs === null
                  ? t("totalNoCompare")
                  : t("totalCompare", { prev: pcs(a.totalPcsSebelumnya), n: data.periode })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{td(`dasar.${data.dasar}`)}</p>
            </section>

            {penyerapan ? <PenyerapanKartu data={penyerapan} periode={data.periode} /> : null}

            {/* Konsinyasi: laku vs kiriman, cepat dan lambat — hanya bila penyerapan tidak disertakan. */}
            {data.laku && !penyerapan ? (
              <section className="beranda-kartu space-y-3" aria-labelledby="laku-judul">
                <div>
                  <h2 id="laku-judul" className="beranda-judul">{t("sellTitle")}</h2>
                  <p className="text-xs text-muted-foreground">{td(`sumber.${data.laku.sumber}`)}</p>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Angka label={t("sent")} nilai={angka.format(data.laku.terkirimPcs)} />
                  <Angka label={t("sold")} nilai={angka.format(data.laku.lakuPcs)} />
                  <Angka label={t("inStore")} nilai={angka.format(data.laku.sisaPcs)} />
                </dl>
                {data.laku.persenLakuDariKirim !== null && data.laku.adaDataLaku ? (
                  <div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, data.laku.persenLakuDariKirim)}
                      aria-label={t("sellTitle")}
                    >
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, data.laku.persenLakuDariKirim)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {data.laku.persenLakuDariKirim > 100 ? t("sellRateMore") : t("sellRate", { pct: data.laku.persenLakuDariKirim })}
                    </p>
                  </div>
                ) : null}

                <div className="space-y-1.5 border-t pt-3">
                  <h3 className="text-xs font-medium text-muted-foreground">{t("fastTitle")}</h3>
                  {data.laku.cepat.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("fastEmpty")}</p>
                  ) : (
                    <ul className="divide-y text-sm">
                      {data.laku.cepat.map((b) => (
                        <li key={b.itemId} className="py-2">
                          <p className="font-medium leading-tight">{b.nama}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {t("fastLine", { sold: angka.format(b.laku), left: angka.format(b.sisa), pct: b.persen })}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1.5 border-t pt-3">
                  <h3 className="text-xs font-medium text-muted-foreground">{t("slowTitle")}</h3>
                  <p className="text-xs text-muted-foreground">{t("slowHint", { n: data.periode })}</p>
                  {data.laku.lambat.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("slowEmpty")}</p>
                  ) : (
                    <>
                      <ul className="divide-y text-sm">
                        {data.laku.lambat.map((b) => (
                          <li key={b.itemId} className="py-2">
                            <p className="font-medium leading-tight">{b.nama}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {b.hariDiToko !== null
                                ? t("slowLine", { left: angka.format(b.sisa), days: b.hariDiToko })
                                : t("slowLineNoDate", { left: angka.format(b.sisa) })}
                            </p>
                          </li>
                        ))}
                      </ul>
                      {data.laku.jumlahLambat > data.laku.lambat.length ? (
                        <p className="text-xs text-muted-foreground">{t("slowMore", { n: data.laku.jumlahLambat - data.laku.lambat.length })}</p>
                      ) : null}
                    </>
                  )}
                </div>
              </section>
            ) : null}

            {/* Per kategori. */}
            <section className="beranda-kartu space-y-2" aria-labelledby="kategori-judul">
              <div>
                <h2 id="kategori-judul" className="beranda-judul">{t("categoryTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t("categoryHint", { n: data.periode })}</p>
              </div>
              {a.kategori.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("categoryEmpty")}</p>
              ) : (
                <ul className="divide-y">
                  {a.kategori.map((k) => (
                    <li key={k.kategoriId ?? "-"} className="space-y-1 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-medium leading-tight">{namaKategori(k.nama)}</span>
                        <TandaArah arah={k.arah} />
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${k.persen}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {t("categoryLine", { pcs: pcs(k.pcs), pct: k.persen })}
                        {k.persenSebelumnya !== null ? ` · ${t("categoryPrev", { pct: k.persenSebelumnya })}` : ""}
                      </p>
                      {k.nilai !== null ? <p className="text-xs font-medium tabular-nums">{formatIDR(k.nilai)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Artikel teratas dengan ukuran dan warna terlarisnya. */}
            <section className="beranda-kartu space-y-2" aria-labelledby="artikel-judul">
              <h2 id="artikel-judul" className="beranda-judul">{t("articleTitle")}</h2>
              {a.artikel.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("articleEmpty")}</p>
              ) : (
                <ol className="divide-y">
                  {a.artikel.map((x, i) => (
                    <li key={x.itemId} className="space-y-1 py-2">
                      <div className="flex items-start gap-2">
                        <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-tight">{x.nama}</p>
                          {x.sku ? <p className="truncate font-mono text-[11px] text-muted-foreground">{x.sku}</p> : null}
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {pcs(x.pcs)}
                            {x.nilai !== null ? ` · ${formatIDR(x.nilai)}` : ""}
                          </p>
                          <Varian label={t("sizes")} bagian={x.ukuran} />
                          <Varian label={t("colors")} bagian={x.warna} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* Tren bulanan (pcs). */}
            <section className="beranda-kartu" aria-labelledby="tren-judul">
              <h2 id="tren-judul" className="beranda-judul">{t("trendTitle")}</h2>
              {a.tren.some((x) => x.pcs > 0) ? (
                <div className="mt-2 h-36" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={a.tren} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                      <XAxis
                        dataKey="bulan"
                        tickFormatter={(b: string) => tBulan(`bulanPendek.${Number(b.slice(5, 7))}`)}
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      />
                      <Tooltip
                        cursor={{ fill: "color-mix(in oklab, var(--primary) 10%, transparent)" }}
                        content={({ active, payload }) => {
                          const p = active && payload?.length ? (payload[0].payload as { bulan: string; pcs: number }) : null;
                          return p ? (
                            <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                              <p className="font-medium">{namaBulan(tBulan, p.bulan, "panjang")}</p>
                              <p className="tabular-nums">{pcs(p.pcs)}</p>
                            </div>
                          ) : null;
                        }}
                      />
                      <Bar dataKey="pcs" fill="var(--primary)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{t("trendEmpty")}</p>
              )}
              {/* Daftar yang sama untuk pembaca layar dan untuk angka persis. */}
              <ul className="sr-only">
                {a.tren.map((x) => (
                  <li key={x.bulan}>
                    {namaBulan(tBulan, x.bulan, "panjang")}: {pcs(x.pcs)}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {dariSpg ? <DariSpgKartu data={dariSpg} storeId={data.toko.id} periode={data.periode} /> : null}
        {penyerapan ? <RekomendasiKartu storeId={data.toko.id} periode={data.periode} boleh={bolehRekomendasi} /> : null}
      </div>
    </div>
  );

  function kalimat(w: Wawasan): string {
    switch (w.kode) {
      case "TANPA_DATA_LAKU":
        return t("insight.noSellData");
      case "LAKU_DARI_KIRIM":
        return w.persen > 100
          ? t("insight.soldMoreThanSent", { sold: angka.format(w.laku), sent: angka.format(w.terkirim) })
          : t("insight.soldOfSent", { sold: angka.format(w.laku), sent: angka.format(w.terkirim), pct: w.persen });
      case "BELUM_LAKU":
        return t("insight.slow", { n: w.jumlah });
      case "KATEGORI_UTAMA": {
        const arah = arahPorsi(w.persen, w.persenSebelumnya);
        if (arah === null) return t("insight.topCategory", { category: w.kategori, pct: w.persen });
        if (arah === "sama") return t("insight.topCategorySame", { category: w.kategori, pct: w.persen });
        return td(arah === "naik" ? "insight.topCategoryUp" : "insight.topCategoryDown", {
          category: w.kategori,
          pct: w.persen,
          prev: w.persenSebelumnya ?? 0,
        });
      }
      case "KATEGORI_NAIK":
        return t("insight.risingCategory", { category: w.kategori, from: w.dari, to: w.ke });
      case "UKURAN":
        return t("insight.topSize", { size: w.ukuran, pct: w.persen });
      case "WARNA":
        return t("insight.topColor", { color: w.warna, pct: w.persen });
      case "TOTAL":
        if (w.persen === null) return t("insight.total", { pcs: pcs(w.pcs), n: data.periode });
        if (w.persen === 0) return t("insight.totalSame", { pcs: pcs(w.pcs), n: data.periode });
        return td(w.persen > 0 ? "insight.totalUp" : "insight.totalDown", { pcs: pcs(w.pcs), pct: Math.abs(w.persen), n: data.periode });
    }
  }
}

function Angka({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2">
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{nilai}</dd>
    </div>
  );
}

function Perubahan({ persen }: { persen: number }) {
  const t = useTranslations("pwaAnalisaToko");
  if (persen === 0) return <span>{t("same")}</span>;
  const Ikon = persen > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5", persen > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
      <Ikon className="h-3.5 w-3.5" aria-hidden />
      {persen > 0 ? t("up", { pct: persen }) : t("down", { pct: Math.abs(persen) })}
    </span>
  );
}

function TandaArah({ arah }: { arah: Arah }) {
  const t = useTranslations("pwaAnalisaToko");
  if (arah === "baru") {
    return (
      <Badge variant="outline" className="shrink-0 border-transparent bg-primary/15 text-foreground">
        {t("arah.baru")}
      </Badge>
    );
  }
  const Ikon = arah === "naik" ? TrendingUp : arah === "turun" ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium",
        arah === "naik" && "text-emerald-700 dark:text-emerald-400",
        arah === "turun" && "text-destructive",
        arah === "tetap" && "text-muted-foreground",
      )}
    >
      <Ikon className="h-3.5 w-3.5" aria-hidden />
      {t(`arah.${arah}`)}
    </span>
  );
}

function Varian({ label, bagian }: { label: string; bagian: BagianLabel[] }) {
  if (bagian.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      {bagian.map((b) => (
        <span key={b.label} className="rounded-full bg-muted px-2 py-0.5 tabular-nums">
          {b.label} · {b.persen}%
        </span>
      ))}
    </p>
  );
}
