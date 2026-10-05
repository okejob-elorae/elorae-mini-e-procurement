"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { KeteranganKirim } from "../../KeteranganKirim";
import { toast } from "sonner";
import { Loader2, Minus, Package, Plus, Search, SearchX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PemindaiBarcode } from "@/components/spg/PemindaiBarcode";
import { catatBarangDicariAction } from "@/app/actions/spg-stok";
import { catatDicariDenganTitipAction } from "@/app/actions/spg-titip";
import { kurangPilihan, pembeliDariPilihan, PilihPelanggan, type PilihanPelanggan } from "@/app/pwa/spg/pelanggan/PilihPelanggan";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { cocokkanKode, kunciBaris } from "@/lib/spg/stok";
import type { SpgCatalogRow } from "@/lib/spg/sale-queries";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export type CatatanDicari = {
  id: string;
  keterangan: string;
  qty: number;
  sku: string | null;
  /** Diformat server untuk kedua bahasa. */
  waktu: { id: string; en: string };
};

type Grup = { itemId: string; sku: string; productName: string; variants: SpgCatalogRow[] };

/** Nilai Select untuk "ukuran tidak tentu" — Radix menolak nilai kosong. */
const TANPA_VARIAN = "__tidak_tentu";
const MAKS_HASIL = 8;
const MAKS_QTY = 999;

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "NO_ACTIVE_VISIT",
  "VALIDATION",
  "KETERANGAN_WAJIB",
  "JUMLAH_TIDAK_VALID",
  "BARANG_TIDAK_DITEMUKAN",
]);

/** Kode galat jalur "pembeli ingin dikabari" (titip pesan), dibaca dari `spgTitip.err`. */
const KODE_GALAT_TITIP = new Set([
  "KUNCI_WAJIB",
  "KUNCI_DIPAKAI",
  "KETERANGAN_TERLALU_PANJANG",
  "VARIAN_TIDAK_DIKENAL",
  "PELANGGAN_TIDAK_VALID",
  "NAMA_WAJIB",
  "NAMA_TERLALU_PANJANG",
  "HP_TIDAK_VALID",
  "PERSETUJUAN_WAJIB",
]);

/**
 * Catat barang yang dicari pembeli tapi tidak ada di toko.
 *
 * Menautkan ke barang katalog itu OPSIONAL: yang paling sering dicari justru
 * yang belum pernah kita buat ("kemeja flanel hijau XL"). Keterangan yang
 * wajib; memilih barang hanya mengisinya lebih dulu, dan SPG bebas
 * menambahkan warna atau ukuran yang tidak ada di daftar.
 */
export function CatatDicariClient({ katalog, terakhir }: { katalog: SpgCatalogRow[]; terakhir: CatatanDicari[] }) {
  const t = useTranslations("pwa.spgDicari");
  const td = dinamis(t);
  const tTitip = useTranslations("spgTitip");
  const tdTitip = dinamis(tTitip);
  const router = useRouter();
  const bahasa = useLocale() === "en" ? "en" : "id";
  const [pending, startTransition] = useTransition();

  const [pilihan, setPilihan] = useState<{ itemId: string; variantSku: string | null } | null>(null);
  const [q, setQ] = useState("");
  const [keterangan, setKeterangan] = useState("");
  // Teks terakhir yang DIISI OTOMATIS dari barang terpilih. Selama SPG belum
  // mengubahnya, memilih barang lain menggantinya; begitu diketik tangan,
  // ketikannya tidak pernah ditimpa.
  const [isianOtomatis, setIsianOtomatis] = useState("");
  const [qty, setQty] = useState("1");
  // Pembeli ingin dikabari kalau barangnya datang → catatan ini juga menjadi
  // titip pesan. Kunci idempotensi sekali per catatan, diganti sesudah tersimpan.
  const [titip, setTitip] = useState(false);
  const [pelanggan, setPelanggan] = useState<PilihanPelanggan | null>(null);
  const [kunciTitip, setKunciTitip] = useState(() => newLocalId());

  const grup = useMemo(() => {
    const m = new Map<string, Grup>();
    for (const r of katalog) {
      const g = m.get(r.itemId) ?? { itemId: r.itemId, sku: r.sku, productName: r.productName, variants: [] };
      g.variants.push(r);
      m.set(r.itemId, g);
    }
    return [...m.values()];
  }, [katalog]);
  const grupPerId = useMemo(() => new Map(grup.map((g) => [g.itemId, g])), [grup]);

  const hasilCari = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return grup
      .filter(
        (g) =>
          g.sku.toLowerCase().includes(needle) ||
          g.productName.toLowerCase().includes(needle) ||
          g.variants.some((v) => (v.variantLabel ?? "").toLowerCase().includes(needle) || (v.variantSku ?? "").toLowerCase().includes(needle)),
      )
      .slice(0, MAKS_HASIL);
  }, [grup, q]);

  const dipilih = pilihan ? (grupPerId.get(pilihan.itemId) ?? null) : null;
  const varianDipilih = dipilih?.variants.filter((v) => v.variantSku) ?? [];

  const angkaQty = Number(qty);
  const qtySah = Number.isInteger(angkaQty) && angkaQty >= 1 && angkaQty <= MAKS_QTY;
  const kurangPembeli = titip ? kurangPilihan(pelanggan) : null;
  const bisaSimpan = !pending && keterangan.trim() !== "" && qtySah && kurangPembeli === null;
  const kurang = pending
    ? null
    : keterangan.trim() === ""
      ? t("kurangKeterangan")
      : !qtySah
        ? t("kurangJumlah")
        : kurangPembeli
          ? tdTitip(`kurang.pembeli${kurangPembeli}`)
          : null;

  function isiKeterangan(teks: string) {
    if (keterangan.trim() === "" || keterangan === isianOtomatis) setKeterangan(teks);
    setIsianOtomatis(teks);
  }

  function pilih(g: Grup, variantSku: string | null) {
    setPilihan({ itemId: g.itemId, variantSku });
    setQ("");
    const v = variantSku ? g.variants.find((x) => x.variantSku === variantSku) : null;
    const label = v ? (v.variantLabel ?? v.variantSku) : null;
    isiKeterangan(label ? `${g.productName} ${label}` : g.productName);
  }

  function lepas() {
    if (keterangan === isianOtomatis) setKeterangan("");
    setIsianOtomatis("");
    setPilihan(null);
  }

  function onKode(kode: string) {
    const hasil = cocokkanKode(kode, katalog);
    const g = hasil ? grupPerId.get(hasil.itemId) : undefined;
    if (!hasil || !g) {
      toast.error(t("scan.notFound", { code: kode }));
      return;
    }
    pilih(g, hasil.jenis === "varian" ? hasil.variantSku : null);
    toast.success(t("scan.picked", { name: g.productName }));
  }

  function ubahQty(selisih: number) {
    const n = Number.isInteger(angkaQty) ? angkaQty : 1;
    setQty(String(Math.min(MAKS_QTY, Math.max(1, n + selisih))));
  }

  function simpan() {
    if (!bisaSimpan) return;
    const pembeli = titip ? pembeliDariPilihan(pelanggan) : null;
    if (titip && !pembeli) return;
    startTransition(async () => {
      let res: { ok: true } | { ok: false; code: string };
      try {
        const isi = {
          itemId: pilihan?.itemId ?? null,
          variantSku: pilihan?.variantSku ?? null,
          description: keterangan.trim(),
          qty: angkaQty,
        };
        res = pembeli ? await catatDicariDenganTitipAction({ ...isi, pembeli, idempotencyKey: kunciTitip }) : await catatBarangDicariAction(isi);
      } catch {
        toast.error(t("err.GENERIC"));
        return;
      }
      if (!res.ok) {
        toast.error(
          KODE_GALAT.has(res.code) ? td(`err.${res.code}`) : pembeli && KODE_GALAT_TITIP.has(res.code) ? tdTitip(`err.${res.code}`) : t("err.GENERIC"),
        );
        return;
      }
      toast.success(pembeli ? t("titip.saved") : t("saved"));
      setPilihan(null);
      setQ("");
      setKeterangan("");
      setIsianOtomatis("");
      setQty("1");
      setTitip(false);
      setPelanggan(null);
      setKunciTitip(newLocalId());
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 p-4">
      {/* Biasanya dibuka dari layar jual (keranjangnya tersimpan), jadi cadangannya ke sana. */}
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/sale" />
      </Button>
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
      </header>

      <section className="beranda-kartu space-y-4">
        <h2 className="beranda-judul">{t("formTitle")}</h2>

        <div className="space-y-2">
          <Label htmlFor={dipilih ? "dicari-varian" : "dicari-cari"}>{t("itemLabel")}</Label>
          {dipilih ? (
            <>
              <div className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Package className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium leading-tight">{dipilih.productName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{dipilih.sku}</span>
                </span>
                <Button type="button" variant="ghost" onClick={lepas} disabled={pending}>
                  <X className="h-4 w-4" aria-hidden />
                  {t("clearItem")}
                </Button>
              </div>
              {varianDipilih.length > 0 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="dicari-varian" className="text-xs text-muted-foreground">
                    {t("variantLabel")}
                  </Label>
                  <Select
                    value={pilihan?.variantSku ?? TANPA_VARIAN}
                    onValueChange={(v) => pilih(dipilih, v === TANPA_VARIAN ? null : v)}
                    disabled={pending}
                  >
                    <SelectTrigger id="dicari-varian" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TANPA_VARIAN}>{t("variantAny")}</SelectItem>
                      {varianDipilih.map((v) => (
                        <SelectItem key={kunciBaris(v.itemId, v.variantSku)} value={v.variantSku as string}>
                          {v.variantLabel ?? v.variantSku}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{t("itemHint")}</p>
              <PemindaiBarcode onKode={onKode} placeholder={t("scanPlaceholder")} />
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  id="dicari-cari"
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  autoComplete="off"
                  enterKeyHint="search"
                  className="pl-9"
                />
              </div>
              {q.trim() !== "" ? (
                hasilCari.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("searchNoResults")}</p>
                ) : (
                  <ul className="divide-y overflow-hidden rounded-lg border">
                    {hasilCari.map((g) => (
                      <li key={g.itemId}>
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto min-h-12 w-full justify-start rounded-none px-3 py-2 text-left"
                          onClick={() => pilih(g, null)}
                          aria-label={t("pickItem", { name: g.productName })}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{g.productName}</span>
                            <span className="block truncate text-xs font-normal text-muted-foreground">{g.sku}</span>
                          </span>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dicari-keterangan">{t("descriptionLabel")}</Label>
          <Textarea
            id="dicari-keterangan"
            value={keterangan}
            onChange={(e) => setKeterangan(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            maxLength={200}
            rows={2}
            disabled={pending}
          />
          <p className="text-xs text-muted-foreground">{t("descriptionHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="dicari-qty">{t("qtyLabel")}</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={() => ubahQty(-1)}
              disabled={pending || angkaQty <= 1}
              aria-label={t("qtyDecrease")}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              id="dicari-qty"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAKS_QTY}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-20 text-center tabular-nums"
              aria-invalid={!qtySah}
              disabled={pending}
            />
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={() => ubahQty(1)}
              disabled={pending || angkaQty >= MAKS_QTY}
              aria-label={t("qtyIncrease")}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <label htmlFor="dicari-titip" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <Checkbox id="dicari-titip" checked={titip} onCheckedChange={(v) => setTitip(v === true)} disabled={pending} className="mt-0.5" />
            <span className="min-w-0 space-y-0.5">
              <span className="block text-sm font-medium leading-tight">{t("titip.label")}</span>
              <span className="block text-xs text-muted-foreground">{t("titip.hint")}</span>
            </span>
          </label>
          {titip ? <PilihPelanggan nilai={pelanggan} onChange={setPelanggan} disabled={pending} idAwalan="dicari-pembeli" /> : null}
        </div>

        <Button type="button" size="lg" className="w-full" onClick={simpan} disabled={!bisaSimpan}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {pending ? t("saving") : titip ? t("titip.save") : t("save")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </section>

      <section className="space-y-2" aria-labelledby="dicari-terakhir">
        <h2 id="dicari-terakhir" className="px-1 font-semibold">
          {t("recentTitle")}
        </h2>
        {terakhir.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("recentEmpty")}</p>
        ) : (
          <div className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {terakhir.map((c) => (
                <li key={c.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <SearchX className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-medium leading-tight">{c.keterangan}</span>
                    <span className="block text-xs text-muted-foreground">
                      {c.waktu[bahasa]}
                      {c.sku ? ` · ${c.sku}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{t("recentQty", { qty: c.qty })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
