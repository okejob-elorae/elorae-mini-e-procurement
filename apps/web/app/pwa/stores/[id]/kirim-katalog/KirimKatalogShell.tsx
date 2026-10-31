"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Download, ImageOff, ImagePlus, Loader2, Search, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import {
  BATAS_PRODUK_KATALOG,
  hargaTampil,
  namaBerkasKartu,
  susunPesanKatalog,
  tautanWaKatalog,
} from "@/lib/salesman/katalog-wa";
import { formatIDR } from "@/lib/sales-orders/format";
import { buatKartu } from "./gambar-kartu";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
/** Satu produk yang boleh dikirim: ada stoknya. `harga` sudah null untuk toko konsinyasi (server). */
export type ProdukKirim = {
  itemId: string;
  sku: string;
  nama: string;
  gambarUrl: string | null;
  tersedia: number;
  harga: number | null;
  /** Ukuran/varian yang ada stoknya, tanpa SKU. */
  ukuran: string[];
};

export type TokoKirim = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  termsType: "PUTUS" | "KONSI";
};

/** Hasil pencarian yang ditampilkan sekaligus — sisanya diminta memperjelas kata cari. */
const HASIL_TAMPIL = 30;

type Hasil = { kunci: string; berkas: File[]; urls: string[]; bisaBagi: boolean };

/**
 * "Kirim katalog" ke pemilik toko: pilih produk, buat kartu gambar di HP, lalu
 * bagikan lewat WhatsApp. Dua langkah terpisah (buat → kirim) karena peramban
 * hanya mengizinkan membuka lembar bagikan sesaat setelah ketukan; membuat
 * sepuluh gambar bisa lebih lama dari itu.
 *
 * Tidak ada yang dicatat ke server — satu-satunya permintaan adalah foto
 * produk lewat `/api/gambar-produk`.
 */
export function KirimKatalogShell({
  store,
  produk,
  awal,
  saranIds,
  baruIds,
}: {
  store: TokoKirim;
  produk: ProdukKirim[];
  awal: string[];
  saranIds: string[];
  baruIds: string[];
}) {
  const t = useTranslations("pwa.kirimKatalog");
  const locale = useLocale();
  const angka = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const isKonsi = store.termsType === "KONSI";

  const [pilihan, setPilihan] = useState<string[]>(awal);
  const [cari, setCari] = useState("");
  const [tampilHarga, setTampilHarga] = useState(true);
  const [catatan, setCatatan] = useState("");
  const [proses, setProses] = useState<{ ke: number; dari: number } | null>(null);
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const urlsRef = useRef<string[]>([]);

  // Lepaskan gambar dari memori saat layar ditinggalkan.
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const produkById = useMemo(() => new Map(produk.map((p) => [p.itemId, p])), [produk]);
  const saranSet = useMemo(() => new Set(saranIds), [saranIds]);
  const baruSet = useMemo(() => new Set(baruIds), [baruIds]);
  const dipilih = useMemo(
    () => pilihan.map((id) => produkById.get(id)).filter((p): p is ProdukKirim => p !== undefined),
    [pilihan, produkById],
  );
  const penuh = pilihan.length >= BATAS_PRODUK_KATALOG;
  const harga = (p: ProdukKirim) => hargaTampil(store.termsType, tampilHarga, p.harga);

  // Gambar yang sudah dibuat hanya berlaku untuk pilihan dan pengaturan harga saat itu.
  const kunciSekarang = JSON.stringify([pilihan, isKonsi ? false : tampilHarga]);
  const hasilBerlaku = hasil && hasil.kunci === kunciSekarang ? hasil : null;

  const pesan = useMemo(
    () =>
      susunPesanKatalog({
        pembuka: store.contactName
          ? t("pesanPembukaNama", { kontak: store.contactName, toko: store.name })
          : t("pesanPembuka", { toko: store.name }),
        penutup: t("pesanPenutup"),
        labelUkuran: t("pesanUkuran"),
        formatHarga: (n) => formatIDR(n),
        produk: dipilih.map((p) => ({
          nama: p.nama,
          sku: p.sku,
          harga: hargaTampil(store.termsType, tampilHarga, p.harga),
          ukuran: p.ukuran,
        })),
        catatan,
      }),
    [store, dipilih, tampilHarga, catatan, t],
  );

  const q = cari.trim().toLowerCase();
  const daftar = q
    ? produk.filter((p) => p.nama.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
    : produk.filter((p) => saranSet.has(p.itemId) || baruSet.has(p.itemId));
  const adaNomor = nomorWhatsApp(store.phone) !== null;

  function ubah(itemId: string, pilih: boolean) {
    setPilihan((lama) => {
      if (!pilih) return lama.filter((id) => id !== itemId);
      if (lama.includes(itemId) || lama.length >= BATAS_PRODUK_KATALOG) return lama;
      return [...lama, itemId];
    });
  }

  async function buatGambar() {
    const kunci = kunciSekarang;
    const daftarBuat = dipilih;
    if (daftarBuat.length === 0) return;
    setProses({ ke: 0, dari: daftarBuat.length });
    try {
      // Huruf halaman dipakai juga di kartu; tunggu sampai benar-benar termuat.
      await document.fonts?.ready;
      const keluarga = getComputedStyle(document.body).fontFamily || "sans-serif";
      const berkas: File[] = [];
      for (const [i, p] of daftarBuat.entries()) {
        setProses({ ke: i + 1, dari: daftarBuat.length });
        const h = harga(p);
        const blob = await buatKartu(
          {
            itemId: p.itemId,
            punyaFoto: p.gambarUrl !== null,
            nama: p.nama,
            sku: p.sku,
            ukuran: p.ukuran,
            harga: h === null ? null : formatIDR(h),
          },
          { ukuran: t("kartuUkuran"), merek: t("kartuMerek") },
          keluarga,
        );
        berkas.push(new File([blob], namaBerkasKartu(p.sku, i), { type: "image/jpeg" }));
      }
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      const urls = berkas.map((f) => URL.createObjectURL(f));
      urlsRef.current = urls;
      const bisaBagi = typeof navigator.canShare === "function" && navigator.canShare({ files: berkas });
      setHasil({ kunci, berkas, urls, bisaBagi });
    } catch {
      toast.error(t("generateFailed"));
    } finally {
      setProses(null);
    }
  }

  function simpanSemua(h: Hasil) {
    h.berkas.forEach((f, i) => {
      const a = document.createElement("a");
      a.href = h.urls[i];
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  async function kirim() {
    if (!hasilBerlaku) return;
    if (hasilBerlaku.bisaBagi) {
      try {
        await navigator.share({ files: hasilBerlaku.berkas, text: pesan });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        toast.error(t("shareFailed"));
      }
      return;
    }
    // HP/peramban yang tidak bisa membagikan berkas: simpan gambarnya, lalu buka
    // obrolan toko dengan pesan terisi — gambar dilampirkan dari galeri.
    simpanSemua(hasilBerlaku);
    window.open(tautanWaKatalog(store.phone, pesan), "_blank", "noopener,noreferrer");
    toast.info(t("shareFallbackToast"));
  }

  async function salinPesan() {
    try {
      await navigator.clipboard.writeText(pesan);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  const foto = (p: ProdukKirim, kelas: string) => (
    <span className={`grid shrink-0 place-items-center overflow-hidden rounded-md bg-muted ${kelas}`}>
      {p.gambarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.gambarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <ImageOff className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
    </span>
  );

  return (
    <div className="space-y-4 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan={`/pwa/stores/${store.id}`} />
        </Button>
      </header>

      <div>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle", { toko: store.name })}</p>
        {!adaNomor ? <p className="mt-1 text-xs text-muted-foreground">{t("noPhone")}</p> : null}
      </div>

      {/* Produk dipilih */}
      <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="kirim-dipilih">
        <h2 id="kirim-dipilih" className="beranda-judul px-4 pb-2 pt-4">
          {t("selectedTitle", { jumlah: pilihan.length, batas: BATAS_PRODUK_KATALOG })}
        </h2>
        {dipilih.length === 0 ? (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">{t("selectedEmpty")}</p>
        ) : (
          <ul className="divide-y border-t">
            {dipilih.map((p) => {
              const h = harga(p);
              return (
                <li key={p.itemId} className="flex min-h-14 items-center gap-3 px-4 py-2">
                  {foto(p, "h-11 w-11")}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-tight">{p.nama}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.sku}
                      {h !== null ? ` · ${formatIDR(h)}` : ""}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("remove", { nama: p.nama })}
                    onClick={() => ubah(p.itemId, false)}
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Cari & tambah */}
      <section className="beranda-kartu beranda-kartu-daftar" aria-labelledby="kirim-cari">
        <div className="space-y-2 px-4 pb-3 pt-4">
          <Label id="kirim-cari" htmlFor="kirim-cari-input" className="beranda-judul">
            {t("searchLabel")}
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="kirim-cari-input"
              type="search"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
              autoComplete="off"
            />
          </div>
          <p className="text-xs text-muted-foreground">{q ? t("resultsTitle") : t("suggestedTitle")}</p>
          {penuh ? <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("limitReached", { batas: BATAS_PRODUK_KATALOG })}</p> : null}
        </div>
        {daftar.length === 0 ? (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">{t("noResults")}</p>
        ) : (
          <ul className="divide-y border-t">
            {daftar.slice(0, HASIL_TAMPIL).map((p) => {
              const terpilih = pilihan.includes(p.itemId);
              const idCentang = `kirim-p-${p.itemId}`;
              return (
                <li key={p.itemId}>
                  <label htmlFor={idCentang} className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2">
                    <Checkbox
                      id={idCentang}
                      checked={terpilih}
                      disabled={!terpilih && penuh}
                      onCheckedChange={(v) => ubah(p.itemId, v === true)}
                    />
                    {foto(p, "h-11 w-11")}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium leading-tight">{p.nama}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.sku} · {t("stok", { jumlah: angka.format(p.tersedia) })}
                      </span>
                    </span>
                    {saranSet.has(p.itemId) ? (
                      <Badge variant="secondary">{t("badgeSaran")}</Badge>
                    ) : baruSet.has(p.itemId) ? (
                      <Badge variant="outline">{t("badgeBaru")}</Badge>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {daftar.length > HASIL_TAMPIL ? (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {t("moreResults", { jumlah: daftar.length - HASIL_TAMPIL })}
          </p>
        ) : null}
      </section>

      {/* Pengaturan */}
      <section className="beranda-kartu space-y-4">
        {isKonsi ? (
          <p className="text-sm text-muted-foreground">{t("konsiNoPrice")}</p>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Label htmlFor="kirim-harga">{t("showPrice")}</Label>
              <p className="text-xs text-muted-foreground">{t("showPriceHint")}</p>
            </div>
            <Switch id="kirim-harga" checked={tampilHarga} onCheckedChange={setTampilHarga} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="kirim-catatan">{t("messageLabel")}</Label>
          <Textarea
            id="kirim-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder={t("messagePlaceholder")}
            rows={3}
            maxLength={500}
          />
        </div>
      </section>

      {/* Buat gambar → kirim */}
      {hasilBerlaku ? (
        <section className="beranda-kartu space-y-3" aria-labelledby="kirim-siap">
          <div>
            <h2 id="kirim-siap" className="beranda-judul">
              {t("previewTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("previewHint", { toko: store.name })}</p>
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {hasilBerlaku.urls.map((u, i) => (
              <li key={u} className="overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={t("previewAlt", { nama: dipilih[i]?.nama ?? "" })} className="aspect-[4/5] w-full object-cover" />
              </li>
            ))}
          </ul>
          <p className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs leading-relaxed">{pesan}</p>
          <Button type="button" className="w-full" onClick={kirim}>
            <Send className="h-4 w-4" aria-hidden />
            {hasilBerlaku.bisaBagi ? t("share") : t("shareFallback")}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="min-w-0 flex-1" onClick={() => simpanSemua(hasilBerlaku)}>
              <Download className="h-4 w-4" aria-hidden />
              <span className="truncate">{t("download")}</span>
            </Button>
            <Button type="button" variant="outline" className="min-w-0 flex-1" onClick={salinPesan}>
              <Copy className="h-4 w-4" aria-hidden />
              <span className="truncate">{t("copyMessage")}</span>
            </Button>
          </div>
        </section>
      ) : (
        <div className="space-y-2">
          {hasil ? <p className="text-center text-xs text-muted-foreground">{t("changed")}</p> : null}
          <Button type="button" className="w-full" disabled={dipilih.length === 0 || proses !== null} onClick={buatGambar}>
            {proses ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                {t("generating", { ke: proses.ke, dari: proses.dari })}
              </>
            ) : (
              <>
                <ImagePlus className="h-4 w-4" aria-hidden />
                {t("generate")}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
