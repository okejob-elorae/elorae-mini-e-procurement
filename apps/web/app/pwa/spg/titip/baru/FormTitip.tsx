"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Minus, Package, PencilLine, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PemindaiBarcode } from "@/components/spg/PemindaiBarcode";
import { buatTitipanAction, type HasilTitipAksi } from "@/app/actions/spg-titip";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { kurangPilihan, pembeliDariPilihan, PilihPelanggan, type PilihanPelanggan } from "@/app/pwa/spg/pelanggan/PilihPelanggan";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { cocokkanKode, kunciBaris } from "@/lib/spg/stok";
import { BATAS_KETERANGAN_TITIP, MAKS_QTY_TITIP } from "@/lib/spg/titip";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Baris katalog untuk titip pesan — TANPA harga. */
export type BarisKatalogTitip = {
  itemId: string;
  sku: string;
  productName: string;
  variantSku: string | null;
  variantLabel: string | null;
  barcode: string | null;
  stok: number;
};

type Grup = { itemId: string; sku: string; productName: string; variants: BarisKatalogTitip[] };

/** Nilai Select untuk "ukuran mana pun" — Radix menolak nilai kosong. */
const VARIAN_APA_SAJA = "__apa_saja";
const MAKS_HASIL = 8;

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "VALIDATION",
  "KUNCI_WAJIB",
  "KUNCI_DIPAKAI",
  "JUMLAH_TIDAK_VALID",
  "KETERANGAN_WAJIB",
  "KETERANGAN_TERLALU_PANJANG",
  "BARANG_TIDAK_DITEMUKAN",
  "VARIAN_TIDAK_DIKENAL",
  "PELANGGAN_TIDAK_VALID",
  "NAMA_WAJIB",
  "NAMA_TERLALU_PANJANG",
  "HP_TIDAK_VALID",
  "PERSETUJUAN_WAJIB",
]);

/**
 * Titip pesan baru: pembeli minta dikabari kalau barangnya datang. Barang
 * dipilih dari katalog (pindai/cari, lalu ukuran — atau "ukuran mana pun"),
 * atau ditulis bebas untuk barang yang tidak ada di katalog. Kunci idempotensi
 * dibuat sekali per formulir: ketukan ganda atau sinyal putus-sambung tidak
 * membuat dua permintaan.
 */
export function FormTitip({
  namaToko,
  katalog,
  awalBarang,
  awalPelanggan,
}: {
  namaToko: string;
  katalog: BarisKatalogTitip[];
  awalBarang: { itemId: string; variantSku: string | null } | null;
  awalPelanggan: PilihanPelanggan | null;
}) {
  const t = useTranslations("spgTitip");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [kunci] = useState(() => newLocalId());

  const [pelanggan, setPelanggan] = useState<PilihanPelanggan | null>(awalPelanggan);
  const [pilihan, setPilihan] = useState<{ itemId: string; variantSku: string | null } | null>(awalBarang);
  const [bebas, setBebas] = useState(false);
  const [q, setQ] = useState("");
  const [keterangan, setKeterangan] = useState("");
  const [qty, setQty] = useState("1");

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
  const stokDipilih = dipilih
    ? pilihan?.variantSku
      ? Math.max(0, dipilih.variants.find((v) => v.variantSku === pilihan.variantSku)?.stok ?? 0)
      : dipilih.variants.reduce((n, v) => n + Math.max(0, v.stok), 0)
    : 0;

  const angkaQty = Number(qty);
  const qtySah = Number.isInteger(angkaQty) && angkaQty >= 1 && angkaQty <= MAKS_QTY_TITIP;
  const kurangPembeli = kurangPilihan(pelanggan);
  const kurang = pending
    ? null
    : kurangPembeli
      ? td(`kurang.pembeli${kurangPembeli}`)
      : !dipilih && !bebas
        ? t("kurang.barang")
        : bebas && keterangan.trim() === ""
          ? t("kurang.keterangan")
          : !qtySah
            ? t("kurang.jumlah")
            : null;

  function pilih(g: Grup, variantSku: string | null) {
    setPilihan({ itemId: g.itemId, variantSku });
    setQ("");
  }

  function onKode(kode: string) {
    const hasil = cocokkanKode(kode, katalog);
    const g = hasil ? grupPerId.get(hasil.itemId) : undefined;
    if (!hasil || !g) {
      toast.error(t("form.kodeTidakDikenal", { kode }));
      return;
    }
    pilih(g, hasil.jenis === "varian" ? hasil.variantSku : null);
    toast.success(t("form.kodeDipilih", { nama: g.productName }));
  }

  function ubahQty(selisih: number) {
    const n = Number.isInteger(angkaQty) ? angkaQty : 1;
    setQty(String(Math.min(MAKS_QTY_TITIP, Math.max(1, n + selisih))));
  }

  function simpan() {
    const pembeli = pembeliDariPilihan(pelanggan);
    if (kurang || !pembeli) return;
    mulai(async () => {
      let r: HasilTitipAksi;
      try {
        r = await buatTitipanAction({
          pembeli,
          itemId: bebas ? null : (pilihan?.itemId ?? null),
          variantSku: bebas ? null : (pilihan?.variantSku ?? null),
          keterangan: keterangan.trim() || null,
          qty: angkaQty,
          idempotencyKey: kunci,
        });
      } catch {
        toast.error(t("err.GENERIC"));
        return;
      }
      if (!r.ok) {
        toast.error(KODE_GALAT.has(r.code) ? td(`err.${r.code}`) : t("err.GENERIC"));
        return;
      }
      toast.success(t("form.ok"));
      router.replace(`/pwa/spg/titip/${r.id}`);
    });
  }

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/titip" />
      </Button>
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("form.judul")}</h1>
          <TombolBantuanHp judul={t("form.judul")} />
        </div>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      <section className="beranda-kartu space-y-3">
        <h2 className="beranda-judul">{t("form.pembeli")}</h2>
        <PilihPelanggan nilai={pelanggan} onChange={setPelanggan} disabled={pending} idAwalan="titip-pembeli" />
      </section>

      <section className="beranda-kartu space-y-4">
        <h2 className="beranda-judul">{t("form.barang")}</h2>

        {bebas ? (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <PencilLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 text-sm">{t("form.bebasAktif")}</span>
            <Button type="button" variant="ghost" onClick={() => setBebas(false)} disabled={pending}>
              {t("form.pakaiKatalog")}
            </Button>
          </div>
        ) : dipilih ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Package className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium leading-tight">{dipilih.productName}</span>
                <span className="block truncate text-xs text-muted-foreground">{dipilih.sku}</span>
              </span>
              <Button type="button" variant="ghost" onClick={() => setPilihan(null)} disabled={pending}>
                <X className="h-4 w-4" aria-hidden />
                {t("form.lepas")}
              </Button>
            </div>
            {varianDipilih.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="titip-varian">{t("form.varian")}</Label>
                <Select
                  value={pilihan?.variantSku ?? VARIAN_APA_SAJA}
                  onValueChange={(v) => pilih(dipilih, v === VARIAN_APA_SAJA ? null : v)}
                  disabled={pending}
                >
                  <SelectTrigger id="titip-varian" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={VARIAN_APA_SAJA}>{t("form.varianApaSaja")}</SelectItem>
                    {varianDipilih.map((v) => (
                      <SelectItem key={kunciBaris(v.itemId, v.variantSku)} value={v.variantSku as string}>
                        {v.variantLabel ?? v.variantSku}
                        {v.stok > 0 ? ` · ${t("form.adaN", { n: v.stok })}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {stokDipilih > 0 ? <p className="rounded-lg bg-muted p-3 text-sm">{t("form.sudahAda", { n: stokDipilih })}</p> : null}
          </div>
        ) : (
          <div className="space-y-2">
            <PemindaiBarcode onKode={onKode} placeholder={t("form.pindai")} />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("form.cariBarang")}
                aria-label={t("form.cariBarang")}
                autoComplete="off"
                enterKeyHint="search"
                className="pl-9"
                disabled={pending}
              />
            </div>
            {q.trim() !== "" ? (
              hasilCari.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("form.tidakAdaBarang")}</p>
              ) : (
                <ul className="divide-y overflow-hidden rounded-lg border">
                  {hasilCari.map((g) => (
                    <li key={g.itemId}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-h-12 w-full justify-start rounded-none px-3 py-2 text-left"
                        onClick={() => pilih(g, null)}
                        aria-label={t("form.pilihBarang", { nama: g.productName })}
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
            <Button type="button" variant="outline" className="w-full" onClick={() => setBebas(true)} disabled={pending}>
              <PencilLine className="h-4 w-4" aria-hidden />
              {t("form.tulisBebas")}
            </Button>
          </div>
        )}

        {bebas || dipilih ? (
          <div className="space-y-1.5">
            <Label htmlFor="titip-keterangan">{bebas ? t("form.keteranganWajib") : t("form.keteranganOpsional")}</Label>
            <Textarea
              id="titip-keterangan"
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder={t("form.keteranganContoh")}
              maxLength={BATAS_KETERANGAN_TITIP}
              rows={2}
              disabled={pending}
            />
            {!bebas ? <p className="text-xs text-muted-foreground">{t("form.keteranganPetunjuk")}</p> : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="titip-qty">{t("form.jumlah")}</Label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon-lg" onClick={() => ubahQty(-1)} disabled={pending || angkaQty <= 1} aria-label={t("form.kurangi")}>
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              id="titip-qty"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAKS_QTY_TITIP}
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
              disabled={pending || angkaQty >= MAKS_QTY_TITIP}
              aria-label={t("form.tambahi")}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <div className="space-y-2">
        <Button type="button" size="lg" className="w-full" onClick={simpan} disabled={pending || kurang !== null}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {pending ? t("form.menyimpan") : t("form.simpan")}
        </Button>
        <KeteranganKirim teks={kurang} />
      </div>
    </div>
  );
}
