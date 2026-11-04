"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { dinamis } from "@/lib/i18n/dinamis";
import type { HasilSaranMinta, SaranMintaBaris } from "@/lib/spg/saran-minta-queries";
import { ALASAN_SARAN, type AlasanSaran } from "@/lib/spg/saran-minta";
import { kunciBaris } from "@/lib/spg/stok";
import { cn } from "@/lib/utils";
import type { BarisPilihan } from "../barang-pilihan";

/** Baris saran yang langsung terlihat per kelompok; sisanya di balik "lihat semua". */
const RINGKAS = 5;

/**
 * "Saran untuk diminta": tiga kelompok (laku di toko lain, sering dikirim,
 * barang baru), masing-masing dengan alasannya dalam satu kalimat. Hanya
 * potong — tidak ada rupiah, tidak ada nama toko lain.
 *
 * Barang tanpa varian langsung ditambahkan; barang bervarian membuka lembar
 * ukuran (hanya ukuran yang tersedia di gudang). Baris yang ditambahkan dari
 * sini membawa alasan kelompoknya.
 */
export function SaranMinta({
  saran,
  pilihan,
  sudahDipilih,
  onTambah,
  disabled,
}: {
  saran: HasilSaranMinta;
  pilihan: ReadonlyMap<string, BarisPilihan>;
  sudahDipilih: ReadonlySet<string>;
  onTambah: (baris: BarisPilihan[], alasan: AlasanSaran) => void;
  disabled: boolean;
}) {
  const t = useTranslations("pwa.spgStok.saran");
  const td = dinamis(t);
  const awal = ALASAN_SARAN.find((a) => saran.kelompok[a].length > 0) ?? "LAKU_DI_TOKO_LAIN";
  const [tab, setTab] = useState<AlasanSaran>(awal);
  const [semua, setSemua] = useState(false);
  // Barang di lembar dipisah dari terbuka/tertutupnya, supaya isinya tidak
  // hilang selagi lembar beranimasi menutup.
  const [lembar, setLembar] = useState<{ baris: SaranMintaBaris; terbuka: boolean } | null>(null);

  /** Baris pilihan (katalog SPG) untuk setiap ukuran saran yang ada di katalog. */
  const varianDari = (s: SaranMintaBaris) =>
    s.varian.map((v) => pilihan.get(kunciBaris(s.itemId, v))).filter((p): p is BarisPilihan => p !== undefined);

  const daftar = saran.kelompok[tab].filter((s) => varianDari(s).length > 0);
  const tampil = semua ? daftar : daftar.slice(0, RINGKAS);

  const kalimat = (s: SaranMintaBaris): string => {
    if (s.alasan === "LAKU_DI_TOKO_LAIN") {
      const dasar = t("whyOther", { pcs: s.pcs, stores: s.toko, days: saran.hariArea });
      return s.sisa === null ? dasar : `${dasar} · ${s.sisa <= 0 ? t("notHere") : t("leftHere", { n: s.sisa })}`;
    }
    if (s.alasan === "SERING_DIKIRIM") {
      const dasar = t("whyOften", { count: s.kali, pcs: s.pcs, days: saran.hariSering });
      return `${dasar} · ${s.sisa === null ? t("stockUnknown") : s.sisa <= 0 ? t("outHere") : t("leftHere", { n: s.sisa })}`;
    }
    return t("whyNew", { n: s.umurHari });
  };

  const ketuk = (s: SaranMintaBaris) => {
    const v = varianDari(s);
    if (v.length === 1) onTambah(v, s.alasan);
    else setLembar({ baris: s, terbuka: true });
  };

  const total = ALASAN_SARAN.reduce((n, a) => n + saran.kelompok[a].length, 0);
  if (total === 0) return null;
  const isiLembar = lembar ? varianDari(lembar.baris) : [];
  const belumDiLembar = isiLembar.filter((p) => !sudahDipilih.has(p.kunci));

  return (
    <section className="space-y-2" aria-labelledby="judul-saran-minta">
      <h2 id="judul-saran-minta" className="beranda-judul px-1">
        {t("title")}
      </h2>
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label={t("title")}>
        {ALASAN_SARAN.map((a) => (
          <Button
            key={a}
            type="button"
            role="tab"
            aria-selected={tab === a}
            variant={tab === a ? "default" : "outline"}
            className="h-auto flex-col gap-0 whitespace-normal px-2 py-2"
            onClick={() => {
              setTab(a);
              setSemua(false);
            }}
          >
            <span className="text-xs font-medium leading-tight">{td(`tab.${a}`)}</span>
            <span className="text-xs tabular-nums opacity-80">{saran.kelompok[a].length}</span>
          </Button>
        ))}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        {tab === "LAKU_DI_TOKO_LAIN"
          ? td(`hint.${tab}.${saran.pembanding}`, { days: saran.hariArea })
          : tab === "SERING_DIKIRIM"
            ? t("hint.SERING_DIKIRIM", { days: saran.hariSering })
            : t("hint.BARANG_BARU", { days: saran.hariBaru })}
      </p>
      <div className="beranda-kartu beranda-kartu-daftar" role="tabpanel">
        {daftar.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{td(`empty.${tab}`)}</p>
        ) : (
          <ul className="divide-y">
            {tampil.map((s) => {
              const v = varianDari(s);
              const lengkap = v.every((p) => sudahDipilih.has(p.kunci));
              return (
                <li key={s.itemId}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => ketuk(s)}
                    disabled={disabled || lengkap}
                    aria-label={lengkap ? t("alreadyAdded", { name: s.nama }) : t("add", { name: s.nama })}
                    className="h-auto min-h-14 w-full justify-start gap-3 rounded-none px-4 py-2 text-left whitespace-normal disabled:opacity-100"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium leading-tight">{s.nama}</span>
                      <span className="block truncate text-xs font-normal text-muted-foreground">
                        {v.length > 1 ? t("skuSizes", { sku: s.sku, count: v.length }) : s.sku}
                      </span>
                      <span className="block text-xs font-normal text-muted-foreground">{kalimat(s)}</span>
                    </span>
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                        lengkap ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-primary text-primary-foreground",
                      )}
                      aria-hidden
                    >
                      {lengkap ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {daftar.length > RINGKAS ? (
        <Button type="button" variant="link" size="sm" className="-ml-3 px-3" onClick={() => setSemua((x) => !x)}>
          {semua ? t("showLess") : t("showMore", { count: daftar.length - RINGKAS })}
        </Button>
      ) : null}

      <Sheet open={lembar?.terbuka ?? false} onOpenChange={(buka) => setLembar((l) => (l ? { ...l, terbuka: buka } : l))}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{lembar?.baris.nama ?? ""}</SheetTitle>
            <SheetDescription>{lembar ? kalimat(lembar.baris) : ""}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 px-4">
            <p className="text-sm text-muted-foreground">{t("pickSizes")}</p>
            <ul className="divide-y rounded-lg border">
              {isiLembar.map((p) => {
                const ada = sudahDipilih.has(p.kunci);
                return (
                  <li key={p.kunci}>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={ada || disabled}
                      onClick={() => lembar && onTambah([p], lembar.baris.alasan)}
                      aria-label={ada ? t("alreadyAdded", { name: `${p.nama} ${p.varian ?? p.kode}` }) : t("add", { name: `${p.nama} ${p.varian ?? p.kode}` })}
                      className="h-auto min-h-12 w-full justify-start gap-3 rounded-none px-3 py-2 text-left whitespace-normal disabled:opacity-100"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-tight">{p.varian ?? p.kode}</span>
                        <span className="block truncate text-xs font-normal text-muted-foreground">
                          {[p.kode, p.dilacak ? t("stockHere", { qty: p.stok }) : t("neverHere")].join(" · ")}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                          ada ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-primary text-primary-foreground",
                        )}
                        aria-hidden
                      >
                        {ada ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
            {belumDiLembar.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  if (lembar) onTambah(belumDiLembar, lembar.baris.alasan);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t("addAllSizes", { count: belumDiLembar.length })}
              </Button>
            ) : null}
            <Button type="button" onClick={() => setLembar((l) => (l ? { ...l, terbuka: false } : l))}>
              {t("done")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
