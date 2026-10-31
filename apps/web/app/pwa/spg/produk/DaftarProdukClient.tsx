"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronRight, Search, Shirt } from "lucide-react";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { PemindaiBarcode } from "@/components/spg/PemindaiBarcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRupiah } from "@/lib/format/rupiah";
import { alamatInfoProduk, type ProdukDaftar } from "@/lib/spg/produk";
import { cocokkanKode, type BarisKatalogKode } from "@/lib/spg/stok";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Baris yang dirender sekaligus — katalog bisa ribuan barang. */
const BATAS_TAMPIL = 30;
const ID_TOAST_PINDAI = "produk-pindai";

/**
 * Daftar Info produk. Pindai barcode/SKU (kamera, pemindai Bluetooth, atau
 * ketik + Enter) langsung membuka barangnya — dengan ukurannya terpilih kalau
 * kodenya kode varian. Pencarian menyaring nama, SKU, SKU varian, dan barcode.
 */
export function DaftarProdukClient({ namaToko, daftar }: { namaToko: string; daftar: ProdukDaftar[] }) {
  const t = useTranslations("pwaSpgProduk");
  const router = useRouter();
  const [cari, setCari] = useState("");

  const katalogKode = useMemo<BarisKatalogKode[]>(
    () =>
      daftar.flatMap((p): BarisKatalogKode[] =>
        p.varian.length === 0
          ? [{ itemId: p.itemId, sku: p.sku, variantSku: null, barcode: null }]
          : p.varian.map((v) => ({ itemId: p.itemId, sku: p.sku, variantSku: v.variantSku, barcode: v.barcode })),
      ),
    [daftar],
  );

  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return daftar;
    return daftar.filter(
      (p) =>
        p.nama.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.varian.some((v) => v.variantSku.toLowerCase().includes(q) || (v.barcode ?? "").toLowerCase().includes(q)),
    );
  }, [daftar, cari]);
  const tampil = cocok.slice(0, BATAS_TAMPIL);

  const onKode = (kode: string): void | "tutup" => {
    const h = cocokkanKode(kode, katalogKode);
    if (!h) {
      toast.error(t("scanUnknown", { code: kode }), { id: ID_TOAST_PINDAI });
      return;
    }
    router.push(alamatInfoProduk(h.itemId, h.jenis === "varian" ? h.variantSku : null));
    // Layar berpindah — kamera penuh layar harus ditutup supaya tidak menutupinya.
    return "tutup";
  };

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/lainnya" />
      </Button>

      <header className="min-w-0">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle", { store: namaToko })}</p>
      </header>

      <section className="space-y-2" aria-label={t("findLabel")}>
        <PemindaiBarcode onKode={onKode} placeholder={t("scanPlaceholder")} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="pl-9"
          />
        </div>
      </section>

      {daftar.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Shirt className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{t("emptyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
          </div>
        </section>
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
            {cari.trim()
              ? t("matchCount", { shown: tampil.length, total: cocok.length })
              : t("allCount", { shown: tampil.length, total: daftar.length })}
          </p>
          <section className="beranda-kartu beranda-kartu-daftar">
            {tampil.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
            ) : (
              <ul className="divide-y">
                {tampil.map((p) => (
                  <li key={p.itemId}>
                    <Link
                      href={alamatInfoProduk(p.itemId)}
                      className="flex min-h-16 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted active:bg-muted"
                    >
                      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                        {p.foto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.foto} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <span className="grid h-full w-full place-items-center text-muted-foreground">
                            <Shirt className="h-5 w-5" aria-hidden />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-tight">{p.nama}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.sku}</span>
                        {/* Harga di barisnya sendiri — uang tidak pernah dipotong. */}
                        <span className="block text-sm font-semibold tabular-nums">
                          {p.harga !== null ? formatRupiah(p.harga) : <span className="font-normal text-muted-foreground">{t("noPrice")}</span>}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {cocok.length > tampil.length ? <p className="px-1 text-xs text-muted-foreground">{t("refineHint")}</p> : null}
        </>
      )}
    </div>
  );
}
