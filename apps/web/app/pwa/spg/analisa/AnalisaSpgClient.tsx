"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, Clock, Minus, PackagePlus, Search, TrendingDown, TrendingUp } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { Arah, BagianLabel, KategoriAnalisa } from "@/lib/salesman/analisa-toko";
import { PERIODE_SPG, type BarisMinta, type PeriodeSpg } from "@/lib/spg/analisa";
import type { HasilAnalisaSpg } from "@/lib/spg/analisa-queries";
import { alamatMinta } from "@/lib/spg/saran-minta";
import { cn } from "@/lib/utils";

/**
 * Analisa penjualan SPG. Periode di alamat (`?periode=`), berpindah dengan
 * `replace` supaya "Kembali" tidak berjalan mundur melewati setiap periode.
 * Tombol "Minta" membuka formulir minta kiriman dengan barisnya sudah terisi
 * (alasan LAKU_DI_SINI); formulir menyimpan draf, jadi beberapa "Minta" dari
 * sini terkumpul di satu permintaan.
 */
export function AnalisaSpgClient({ data, label }: { data: HasilAnalisaSpg; label: { periode: string; pembanding: string } }) {
  const t = useTranslations("pwaSpgAnalisa");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [menunggu, mulai] = useTransition();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 1 });
  const pcs = (n: number) => t("pcs", { n: angka.format(n) });
  const a = data.analisa;

  const pilih = (p: PeriodeSpg) => {
    if (p === data.periode) return;
    mulai(() => router.replace(`/pwa/spg/analisa?periode=${p}`, { scroll: false }));
  };
  const minta = (baris: BarisMinta[]) => alamatMinta(baris.map((b) => ({ ...b, alasan: "LAKU_DI_SINI" as const })));

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle", { store: data.toko.nama })}</p>
      </header>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("periodLabel")}>
        {PERIODE_SPG.map((p) => (
          <Button
            key={p}
            variant={p === data.periode ? "default" : "outline"}
            aria-pressed={p === data.periode}
            disabled={menunggu}
            onClick={() => pilih(p)}
          >
            {td(`period.${p}`)}
          </Button>
        ))}
      </div>

      <div className={cn("space-y-4 transition-opacity", menunggu && "opacity-60")} aria-busy={menunggu}>
        {/* Ringkasan periode ini dan pembandingnya. */}
        <section className="beranda-kartu beranda-kartu-utama">
          <h2 className="beranda-judul">{t("totalTitle")}</h2>
          <p className="text-xs opacity-80">{label.periode}</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{pcs(a.totalPcs)}</span>
            {a.perubahanPcs !== null ? (
              <span className="text-sm font-medium">
                <Perubahan arah={a.arah} persen={a.perubahanPcs} />
              </span>
            ) : null}
          </p>
          <p className="text-sm tabular-nums">{t("perDay", { n: angka.format(a.rataHarian) })}</p>
          <p className="mt-1 text-xs opacity-80">
            {a.totalPcsLalu > 0
              ? t("compare", { range: label.pembanding, prev: pcs(a.totalPcsLalu) })
              : t("compareNone", { range: label.pembanding })}
          </p>
        </section>

        {data.kosong ? (
          <section className="beranda-kartu flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <BarChart3 className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold leading-tight">{t("emptyTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
            </div>
          </section>
        ) : (
          <>
            {/* Artikel terlaris dengan ukuran & warnanya. */}
            <section className="space-y-2" aria-labelledby="spg-terlaris">
              <h2 id="spg-terlaris" className="beranda-judul px-1">
                {t("topTitle")}
              </h2>
              {a.artikel.length === 0 ? (
                <p className="beranda-kartu text-sm text-muted-foreground">{t("topEmpty")}</p>
              ) : (
                <ol className="beranda-kartu beranda-kartu-daftar divide-y">
                  {a.artikel.map((x, i) => (
                    <li key={x.itemId} className="flex gap-3 px-4 py-3">
                      <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-medium leading-tight">{x.nama}</p>
                        <p className="truncate text-xs text-muted-foreground">{x.sku}</p>
                        {x.ukuran.length > 0 ? (
                          <p className="text-xs text-muted-foreground">{t("sizes", { list: daftarLabel(x.ukuran) })}</p>
                        ) : null}
                        {x.warna.length > 0 ? (
                          <p className="text-xs text-muted-foreground">{t("colors", { list: daftarLabel(x.warna) })}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">{pcs(x.pcs)}</p>
                        <p className="text-xs">
                          <IkonArah arah={x.arah} />
                          <span className="sr-only">{td(`arah.${x.arah}`)}</span>
                        </p>
                        <p className="text-xs tabular-nums text-muted-foreground">{t("prevShort", { n: angka.format(x.pcsLalu) })}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {a.varian.length > 0 ? (
              <section className="space-y-2" aria-labelledby="spg-varian">
                <h2 id="spg-varian" className="beranda-judul px-1">
                  {t("topVariantTitle")}
                </h2>
                <ol className="beranda-kartu beranda-kartu-daftar divide-y">
                  {a.varian.map((v, i) => (
                    <li key={`${v.itemId}::${v.variantSku}`} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-5 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium leading-tight">{v.nama}</p>
                        <p className="truncate text-xs text-muted-foreground">{[v.label, v.sku].filter(Boolean).join(" · ")}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{pcs(v.pcs)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        )}

        {/* Cukup untuk berapa hari — jendela laju tetap, tidak ikut periode. */}
        <section className="space-y-2" aria-labelledby="spg-cukup">
          <h2 id="spg-cukup" className="beranda-judul px-1">
            {t("coverTitle")}
          </h2>
          <p className="px-1 text-xs text-muted-foreground">{t("coverHint", { days: data.hariLaju })}</p>
          {!data.bukuAda ? (
            <div className="beranda-kartu space-y-2">
              <p className="text-sm text-muted-foreground">{t("coverNoBook")}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/pwa/spg/opname">{t("coverOpname")}</Link>
              </Button>
            </div>
          ) : data.cukup.baris.length === 0 ? (
            <p className="beranda-kartu text-sm text-muted-foreground">{t("coverEmpty", { days: data.hariLaju })}</p>
          ) : (
            <>
              {data.cukup.mintaHampirHabis.length > 0 ? (
                <Button asChild className="w-full">
                  <Link href={minta(data.cukup.mintaHampirHabis)}>
                    <PackagePlus className="h-4 w-4" aria-hidden />
                    {t("coverRequestAll", { count: data.cukup.jumlahHampirHabis })}
                  </Link>
                </Button>
              ) : null}
              <ul className="beranda-kartu beranda-kartu-daftar divide-y">
                {data.cukup.baris.map((c) => (
                  <li key={c.itemId} className="space-y-2 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium leading-tight">{c.nama}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.sku}</p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {t("coverLine", { sisa: angka.format(c.sisa), laku: angka.format(c.laku), days: data.hariLaju })}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cn("text-sm font-semibold tabular-nums", c.hampirHabis && "text-destructive")}>
                          {c.hariCukup === 0 ? t("coverOut") : t("coverDays", { n: c.hariCukup })}
                        </p>
                        {c.hampirHabis ? (
                          <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                            {t("coverLow")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {c.minta.length > 0 ? (
                      <Button asChild variant="outline" size="sm" className="w-full">
                        <Link href={minta(c.minta)}>
                          <PackagePlus className="h-4 w-4" aria-hidden />
                          {t("coverRequest", { pcs: c.minta.reduce((n, m) => n + m.qty, 0) })}
                        </Link>
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {/* Barang lambat. */}
        {data.bukuAda ? (
          <section className="space-y-2" aria-labelledby="spg-lambat">
            <h2 id="spg-lambat" className="beranda-judul px-1">
              {t("slowTitle")}
            </h2>
            <p className="px-1 text-xs text-muted-foreground">{t("slowHint", { days: data.hariLambat })}</p>
            {data.lambat.baris.length === 0 ? (
              <p className="beranda-kartu text-sm text-muted-foreground">{t("slowEmpty")}</p>
            ) : (
              <ul className="beranda-kartu beranda-kartu-daftar divide-y">
                {data.lambat.baris.map((l) => (
                  <li key={l.itemId} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Clock className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{l.nama}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[l.sku, l.hariDiToko !== null ? t("slowDays", { n: l.hariDiToko }) : null].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{t("slowLine", { sisa: angka.format(l.sisa) })}</span>
                  </li>
                ))}
                {data.lambat.jumlah > data.lambat.baris.length ? (
                  <li className="px-4 py-2 text-xs text-muted-foreground">
                    {t("slowMore", { count: data.lambat.jumlah - data.lambat.baris.length })}
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        ) : null}

        {/* Porsi kategori / ukuran / warna di periode ini. */}
        {!data.kosong && a.totalPcs > 0 ? (
          <section className="beranda-kartu space-y-4" aria-labelledby="spg-porsi">
            <h2 id="spg-porsi" className="beranda-judul">
              {t("shareTitle")}
            </h2>
            <Porsi judul={t("shareCategory")} baris={a.kategori.filter((k) => k.pcs > 0).map((k) => kategoriKeLabel(k, t("noCategory")))} pcs={pcs} />
            {a.ukuran.length > 0 ? <Porsi judul={t("shareSize")} baris={a.ukuran} pcs={pcs} /> : null}
            {a.warna.length > 0 ? <Porsi judul={t("shareColor")} baris={a.warna} pcs={pcs} /> : null}
          </section>
        ) : null}

        {/* Dicari pembeli. */}
        <section className="space-y-2" aria-labelledby="spg-dicari">
          <h2 id="spg-dicari" className="beranda-judul px-1">
            {t("wantedTitle")}
          </h2>
          <p className="px-1 text-xs text-muted-foreground">{t("wantedHint")}</p>
          {data.dicari.length === 0 ? (
            <p className="beranda-kartu text-sm text-muted-foreground">{t("wantedEmpty")}</p>
          ) : (
            <ul className="beranda-kartu beranda-kartu-daftar divide-y">
              {data.dicari.map((d) => (
                <li key={d.kunci} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Search className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-tight">{d.keterangan}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{t("wantedLine", { qty: d.qty, count: d.kali })}</p>
                  </div>
                  {d.itemId ? (
                    <Button asChild variant="outline" size="sm" className="shrink-0">
                      <Link href={minta([{ itemId: d.itemId, variantSku: d.variantSku, qty: d.qty }])}>{t("wantedRequest")}</Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/pwa/spg/dicari">{t("wantedRecord")}</Link>
          </Button>
        </section>

        <p className="px-1 text-xs text-muted-foreground">{t("netNote")}</p>
      </div>
    </div>
  );
}

function daftarLabel(baris: BagianLabel[]): string {
  return baris.map((b) => `${b.label} ${b.persen}%`).join(", ");
}

function kategoriKeLabel(k: KategoriAnalisa, tanpa: string): BagianLabel {
  return { label: k.nama ?? tanpa, pcs: k.pcs, persen: k.persen };
}

function IkonArah({ arah }: { arah: Arah }) {
  if (arah === "naik") return <TrendingUp className="ml-auto inline h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (arah === "turun") return <TrendingDown className="ml-auto inline h-3.5 w-3.5 text-destructive" aria-hidden />;
  if (arah === "baru") return <TrendingUp className="ml-auto inline h-3.5 w-3.5 text-primary" aria-hidden />;
  return <Minus className="ml-auto inline h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

function Perubahan({ arah, persen }: { arah: Arah; persen: number }) {
  const t = useTranslations("pwaSpgAnalisa");
  const td = dinamis(t);
  return (
    <span className="inline-flex items-center gap-1">
      {arah === "turun" ? <TrendingDown className="h-4 w-4" aria-hidden /> : arah === "tetap" ? <Minus className="h-4 w-4" aria-hidden /> : <TrendingUp className="h-4 w-4" aria-hidden />}
      {t("change", { sign: persen > 0 ? "+" : "", n: persen })}
      <span className="sr-only">{td(`arah.${arah}`)}</span>
    </span>
  );
}

function Porsi({ judul, baris, pcs }: { judul: string; baris: BagianLabel[]; pcs: (n: number) => string }) {
  if (baris.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">{judul}</h3>
      <ul className="space-y-1.5">
        {baris.slice(0, 6).map((b) => (
          <li key={b.label} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">{b.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {pcs(b.pcs)} · {b.persen}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, b.persen)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
