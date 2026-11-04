"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronRight, PackageSearch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatIDR } from "@/lib/sales-orders/format";
import { kunciBarisTukar, type ArahTukar, type BarisTukar } from "@/lib/salesman/tukar-barang";
import type { BahanTukar, BarangTukar } from "@/lib/salesman/tukar-queries";
import { cn } from "@/lib/utils";
import { labelVarian } from "./barang";

const BATAS_HASIL = 30;

/**
 * Lembar pemilih barang untuk satu arah.
 *
 * MASUK (dikembalikan toko) dibuka dengan barang yang PERNAH DIKIRIM ke toko
 * ini — itulah yang biasanya kembali. KELUAR (diberikan ke toko) dibuka dengan
 * ukuran/warna lain dari barang yang dikembalikan — itulah wujud tukar barang
 * yang paling sering. Barang lain dicari dengan mengetik.
 */
export function PilihBarangSheet({
  arah,
  onTutup,
  bahan,
  baris,
  onTambah,
}: {
  arah: ArahTukar | null;
  onTutup: () => void;
  bahan: BahanTukar;
  baris: BarisTukar[];
  onTambah: (direction: ArahTukar, itemId: string, variantSku: string) => void;
}) {
  const t = useTranslations("pwa.tukar.pilih");
  const [cari, setCari] = useState("");
  const [terbuka, setTerbuka] = useState<string | null>(null);

  const barangById = useMemo(() => new Map(bahan.barang.map((b) => [b.itemId, b])), [bahan.barang]);
  const dipilih = (itemId: string, variantSku: string) =>
    baris.find((b) => b.direction === arah && kunciBarisTukar(b.itemId, b.variantSku) === kunciBarisTukar(itemId, variantSku))?.qty ?? 0;

  const jarum = cari.trim().toLowerCase();
  const cocok = (b: BarangTukar) => b.nama.toLowerCase().includes(jarum) || b.sku.toLowerCase().includes(jarum);

  const dibeli =
    arah === "MASUK"
      ? bahan.dibeli.filter((d) => {
          if (!jarum) return true;
          const b = barangById.get(d.itemId);
          return !!b && (cocok(b) || (labelVarian(b, d.variantSku) ?? "").toLowerCase().includes(jarum));
        })
      : [];

  const serupa =
    arah === "KELUAR" && !jarum
      ? [...new Set(baris.filter((b) => b.direction === "MASUK").map((b) => b.itemId))]
          .map((id) => barangById.get(id))
          .filter((b): b is BarangTukar => !!b && b.bisaKeluar)
      : [];

  const hasil =
    jarum.length >= 2
      ? bahan.barang.filter((b) => (arah === "KELUAR" ? b.bisaKeluar : true) && cocok(b)).slice(0, BATAS_HASIL)
      : [];

  const tutup = () => {
    setCari("");
    setTerbuka(null);
    onTutup();
  };

  const barisBarang = (b: BarangTukar) => {
    const tanpaVarian = b.varian.length === 0;
    const qtyItem = tanpaVarian ? dipilih(b.itemId, "") : b.varian.reduce((s, v) => s + dipilih(b.itemId, v.variantSku), 0);
    const habis = arah === "KELUAR" && tanpaVarian && dipilih(b.itemId, "") >= b.tersedia;
    const buka = terbuka === b.itemId;
    return (
      <li key={b.itemId} className="rounded-lg border">
        <Button
          type="button"
          variant="ghost"
          disabled={habis}
          aria-expanded={tanpaVarian ? undefined : buka}
          onClick={() => (tanpaVarian ? arah && onTambah(arah, b.itemId, "") : setTerbuka(buka ? null : b.itemId))}
          className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal px-3 py-2 text-left"
        >
          {b.gambar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={b.gambar} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-md border object-cover" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted">
              <PackageSearch className="h-4 w-4 text-muted-foreground" aria-hidden />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium leading-tight">{b.nama}</span>
            <span className="block text-xs text-muted-foreground">
              {b.sku} · {b.harga ? formatIDR(b.harga) : t("hargaBelumDiset")}
              {arah === "KELUAR" && tanpaVarian ? ` · ${b.tersedia > 0 ? t("stok", { n: b.tersedia }) : t("habis")}` : ""}
            </span>
          </span>
          {qtyItem > 0 ? <Badge variant="secondary">{t("dipilih", { qty: qtyItem })}</Badge> : null}
          {tanpaVarian ? null : buka ? (
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          )}
        </Button>
        {!tanpaVarian && buka ? (
          <ul className="space-y-1 border-t p-2" aria-label={t("pilihVarian")}>
            {b.varian.map((v) => {
              const q = dipilih(b.itemId, v.variantSku);
              const penuh = arah === "KELUAR" && q >= v.tersedia;
              return (
                <li key={v.variantSku}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={penuh}
                    onClick={() => arah && onTambah(arah, b.itemId, v.variantSku)}
                    className="h-auto min-h-11 w-full justify-between gap-2 whitespace-normal py-2 text-left"
                  >
                    <span className="min-w-0 text-sm">{v.label}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {arah === "KELUAR" ? (
                        <Badge variant={v.tersedia > 0 ? "secondary" : "destructive"}>
                          {v.tersedia > 0 ? t("stok", { n: v.tersedia }) : t("habis")}
                        </Badge>
                      ) : null}
                      {q > 0 ? (
                        <Badge>
                          <Check className="h-3 w-3" aria-hidden />
                          {q}
                        </Badge>
                      ) : null}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <Sheet open={arah !== null} onOpenChange={(v) => (v ? undefined : tutup())}>
      <SheetContent side="bottom" className="flex max-h-[88vh] flex-col gap-0 p-0">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{arah === "KELUAR" ? t("judulKeluar") : t("judulMasuk")}</SheetTitle>
          <SheetDescription>{arah === "KELUAR" ? t("deskripsiKeluar") : t("deskripsiMasuk")}</SheetDescription>
        </SheetHeader>

        <div className="px-4 pt-3">
          <Input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={t("cari")}
            aria-label={t("cari")}
          />
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {arah === "MASUK" && dibeli.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("dibeli")}</h3>
              <ul className="space-y-2">
                {dibeli.map((d) => {
                  const b = barangById.get(d.itemId);
                  if (!b) return null;
                  const label = labelVarian(b, d.variantSku);
                  const q = dipilih(d.itemId, d.variantSku);
                  return (
                    <li key={kunciBarisTukar(d.itemId, d.variantSku)}>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onTambah("MASUK", d.itemId, d.variantSku)}
                        className="h-auto min-h-14 w-full justify-between gap-2 whitespace-normal px-3 py-2 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-tight">{b.nama}</span>
                          {label ? <span className="block text-xs">{label}</span> : null}
                          <span className="block text-xs text-muted-foreground">
                            {t("dibeliBaris", { qty: d.qty, tanggal: d.terakhir })}
                          </span>
                        </span>
                        {q > 0 ? (
                          <Badge>
                            <Check className="h-3 w-3" aria-hidden />
                            {q}
                          </Badge>
                        ) : null}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {serupa.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("serupa")}</h3>
              <ul className="space-y-2">{serupa.map(barisBarang)}</ul>
            </section>
          ) : null}

          {jarum.length >= 2 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("hasil")}</h3>
              {hasil.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{t("tidakAda")}</p>
              ) : (
                <ul className="space-y-2">{hasil.map(barisBarang)}</ul>
              )}
            </section>
          ) : (
            <p className={cn("text-center text-sm text-muted-foreground", (dibeli.length > 0 || serupa.length > 0) && "pt-2")}>
              {arah === "MASUK" && bahan.dibeli.length === 0 ? t("belumPernahDikirim") : t("ketikCari")}
            </p>
          )}
        </div>

        <SheetFooter className="border-t pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button type="button" className="w-full" onClick={tutup}>
            {t("selesai")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
