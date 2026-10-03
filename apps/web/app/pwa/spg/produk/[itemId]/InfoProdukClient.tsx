"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BellRing, PackagePlus, Ruler, Shirt, Store, Tag } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { alamatMintaProduk, alamatTitipProduk, type InfoProduk, type LabelGudang } from "@/lib/spg/produk";
import { cn } from "@/lib/utils";

const NADA_GUDANG: Record<LabelGudang, string> = {
  ADA: "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  SEDIKIT: "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  KOSONG: "border-border bg-muted text-muted-foreground",
};

/**
 * Info produk untuk pembeli. Urutannya mengikuti pertanyaan pembeli: seperti
 * apa barangnya (foto), berapa harganya (dan promonya), bahannya apa, ukurannya
 * pas atau tidak — lalu ada atau tidak ukuran itu (di rak, di gudang, di toko
 * SPG lain), dan apa yang bisa SPG lakukan kalau tidak ada.
 *
 * Stok gudang hanya keterangan; angkanya tidak pernah sampai ke HP.
 */
export function InfoProdukClient({ info, namaToko, varianAwal }: { info: InfoProduk; namaToko: string; varianAwal: string | null }) {
  const t = useTranslations("pwaSpgProduk");
  const td = dinamis(t);
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 2 });
  // Barang tanpa varian punya satu baris (`""`) yang selalu terpilih.
  const [terpilih, setTerpilih] = useState<string | null>(info.bervarian ? varianAwal : "");
  const varian = info.varian.find((v) => v.variantSku === terpilih) ?? null;
  const labelVarian = (label: string) => label || t("noSize");

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/produk" />
      </Button>

      <FotoGeser foto={info.foto} terpilih={terpilih} nama={info.nama} />

      <header className="min-w-0 space-y-1">
        <h1 className="text-2xl font-bold leading-tight">{info.nama}</h1>
        <p className="text-sm text-muted-foreground">{[info.sku, info.kategori].filter(Boolean).join(" · ")}</p>
        {!info.aktif ? (
          <Badge variant="outline" className="border-amber-600/40 text-amber-700 dark:text-amber-300">
            {t("inactive")}
          </Badge>
        ) : null}
      </header>

      {/* Harga di barisnya sendiri — uang tidak pernah dipotong. */}
      <section className="beranda-kartu space-y-1">
        <h2 className="beranda-judul">{t("priceTitle")}</h2>
        {info.harga !== null ? (
          <p className="text-2xl font-semibold tabular-nums">{formatRupiah(info.harga)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noPrice")}</p>
        )}
      </section>

      {info.promo.length > 0 ? (
        <section className="beranda-kartu space-y-3" aria-labelledby="produk-promo">
          <h2 id="produk-promo" className="beranda-judul flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" aria-hidden />
            {t("promoTitle")}
          </h2>
          <ul className="space-y-3">
            {info.promo.map((p) => (
              <li key={p.id} className="space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 font-medium leading-tight">
                  {p.nama}
                  {!p.berlaku ? <Badge variant="outline">{t("promoUpcoming")}</Badge> : null}
                </p>
                <p className="text-sm">{p.ringkas}</p>
                {!p.berlaku && p.mulaiLabel ? (
                  <p className="text-xs text-muted-foreground">{t("promoStarts", { date: p.mulaiLabel })}</p>
                ) : p.sampaiLabel ? (
                  <p className="text-xs text-muted-foreground">{t("promoUntil", { date: p.sampaiLabel })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {info.bahan || info.caraRawat || info.deskripsi ? (
        <section className="beranda-kartu space-y-3" aria-labelledby="produk-bahan">
          <h2 id="produk-bahan" className="beranda-judul">
            {t("detailTitle")}
          </h2>
          <dl className="space-y-3 text-sm">
            {info.bahan ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t("material")}</dt>
                <dd className="font-medium">{info.bahan}</dd>
              </div>
            ) : null}
            {info.caraRawat ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t("care")}</dt>
                <dd className="whitespace-pre-line">{info.caraRawat}</dd>
              </div>
            ) : null}
            {info.deskripsi ? (
              <div>
                <dt className="text-xs text-muted-foreground">{t("description")}</dt>
                <dd className="whitespace-pre-line">{info.deskripsi}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      {info.tabelUkuran ? (
        <section className="beranda-kartu min-w-0 space-y-3 overflow-hidden" aria-labelledby="produk-ukuran">
          <div>
            <h2 id="produk-ukuran" className="beranda-judul flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5" aria-hidden />
              {t("sizeChartTitle", { unit: td(`unit.${info.tabelUkuran.satuan}`) })}
            </h2>
            <p className="text-xs text-muted-foreground">{info.tabelUkuran.nama}</p>
          </div>
          {/* Tabel lebar digeser menyamping di dalam kartunya; kolom ukuran tetap terlihat. */}
          <div className="-mx-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 bg-[var(--kpi-surface)] pl-4">{t("sizeColumn")}</TableHead>
                  {info.tabelUkuran.kolom.map((k) => (
                    <TableHead key={k} className="text-right">
                      {k}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {info.tabelUkuran.baris.map((b) => (
                  <TableRow key={b.ukuran}>
                    <TableCell className="sticky left-0 z-10 bg-[var(--kpi-surface)] pl-4 font-semibold">{b.ukuran}</TableCell>
                    {b.nilai.map((n, i) => (
                      <TableCell key={i} className="text-right tabular-nums">
                        {n === null ? "—" : angka.format(n)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {info.tabelUkuran.catatan ? <p className="whitespace-pre-line text-xs text-muted-foreground">{info.tabelUkuran.catatan}</p> : null}
        </section>
      ) : null}

      {/* Stok per ukuran. Mengetuk satu ukuran memilihnya untuk toko lain dan tombol di bawah. */}
      <section className="space-y-2" aria-labelledby="produk-stok">
        <div className="px-1">
          <h2 id="produk-stok" className="beranda-judul">
            {t("stockTitle")}
          </h2>
          {info.bervarian ? <p className="text-xs text-muted-foreground">{t("stockPickHint")}</p> : null}
        </div>
        {!info.bukuDimulai ? <p className="px-1 text-xs text-muted-foreground">{t("bookNotStarted")}</p> : null}
        <ul className="beranda-kartu beranda-kartu-daftar divide-y">
          {info.varian.map((v) => {
            const dipilih = terpilih === v.variantSku;
            const isi = (
              <>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block font-medium leading-tight">{labelVarian(v.label)}</span>
                  {v.variantSku ? <span className="block truncate text-xs text-muted-foreground">{v.variantSku}</span> : null}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {v.stokToko !== null ? (
                    <span className={cn("text-sm font-semibold tabular-nums", v.stokToko < 0 && "text-destructive")}>
                      {t("inStore", { n: v.stokToko })}
                    </span>
                  ) : null}
                  <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", NADA_GUDANG[v.gudang])}>
                    {td(`warehouse.${v.gudang}`)}
                  </span>
                </span>
              </>
            );
            return (
              <li key={v.variantSku || "_"}>
                {info.bervarian ? (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-pressed={dipilih}
                    onClick={() => setTerpilih(dipilih ? null : v.variantSku)}
                    className={cn(
                      "h-auto min-h-14 w-full justify-between gap-3 rounded-none px-4 py-2 whitespace-normal",
                      dipilih && "bg-primary/10 ring-2 ring-inset ring-primary hover:bg-primary/15",
                    )}
                  >
                    {isi}
                  </Button>
                ) : (
                  <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">{isi}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="beranda-kartu space-y-3" aria-labelledby="produk-aksi">
        <h2 id="produk-aksi" className="beranda-judul">
          {varian && info.bervarian ? t("forSize", { size: labelVarian(varian.label) }) : t("actionsTitle")}
        </h2>

        {varian ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Store className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t("otherStoresTitle")}
            </p>
            {varian.tokoLain.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("otherStoresNone")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {varian.tokoLain.map((s) => (
                  <li key={s.nama} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">{s.nama}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{t("pcs", { n: s.qty })}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("pickSizeHint")}</p>
        )}

        {/* Ubin, bukan tombol sebaris: label boleh dua baris tanpa terpotong. */}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={alamatTitipProduk(info.itemId, terpilih ?? "")}
            className="flex min-h-16 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium leading-tight transition-colors hover:bg-muted active:bg-muted"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <BellRing className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">{t("holdRequest")}</span>
          </Link>
          <Link
            href={alamatMintaProduk(info.itemId, terpilih ?? "")}
            className="flex min-h-16 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium leading-tight transition-colors hover:bg-muted active:bg-muted"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <PackagePlus className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">{t("requestStock")}</span>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">{t("requestHint", { store: namaToko })}</p>
      </section>
    </div>
  );
}

/**
 * Foto barang yang bisa digeser. Memilih ukuran menggeser ke foto pertama
 * ukuran itu (kalau ada).
 */
function FotoGeser({ foto, terpilih, nama }: { foto: InfoProduk["foto"]; terpilih: string | null; nama: string }) {
  const t = useTranslations("pwaSpgProduk");
  const wadah = useRef<HTMLDivElement>(null);
  const [indeks, setIndeks] = useState(0);

  useEffect(() => {
    if (!terpilih || !wadah.current) return;
    const i = foto.findIndex((f) => f.variantSku === terpilih);
    if (i < 0) return;
    const el = wadah.current;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }, [terpilih, foto]);

  if (foto.length === 0) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-muted text-muted-foreground">
        <span className="flex flex-col items-center gap-1 text-sm">
          <Shirt className="h-8 w-8" aria-hidden />
          {t("noPhoto")}
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={wadah}
        className="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto rounded-xl bg-muted [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== indeks) setIndeks(i);
        }}
        aria-label={t("photosLabel", { name: nama })}
        role="region"
      >
        {foto.map((f, i) => (
          <div key={f.url} className="h-full w-full shrink-0 snap-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.url}
              alt={t("photoAlt", { name: nama, n: i + 1, total: foto.length })}
              loading={i === 0 ? "eager" : "lazy"}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
      {foto.length > 1 ? (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium tabular-nums text-white">
          {indeks + 1} / {foto.length}
        </span>
      ) : null}
    </div>
  );
}
