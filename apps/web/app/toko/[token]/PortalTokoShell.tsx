"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Store,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatIDR } from "@/lib/sales-orders/format";
import { newLocalId } from "@/lib/pwa/id-lokal";
import type { Ketersediaan } from "@/lib/field-sales/portal-toko-aturan";
import type {
  BarangPortalKonsi,
  BarangPortalPutus,
  HasilKirimPortal,
  KatalogPortal,
  MasalahBaris,
  PratinjauPortal,
} from "@/lib/field-sales/portal-writer";
import { kirimPesananPortalAksi, pratinjauPesananPortalAksi } from "@/app/actions/portal-toko";
import { TautanMati } from "./TautanMati";

type Barang = BarangPortalPutus | BarangPortalKonsi;
type Keranjang = Record<string, number>;

const PER_HALAMAN = 30;
const MAKS_QTY = 9999;
const MAKS_BARIS = 200;

const kunciBaris = (itemId: string, variantSku: string) => `${itemId}::${variantSku}`;
const pisahKunci = (k: string) => {
  const i = k.indexOf("::");
  return { itemId: k.slice(0, i), variantSku: k.slice(i + 2) };
};
const hargaDari = (b: Barang): number | null => ("harga" in b ? b.harga : null);
const minDari = (b: Barang): number => ("minPesan" in b ? b.minPesan : 1);

/** Keranjang tersimpan di HP toko. Rusak / diblokir peramban → keranjang kosong, bukan halaman mati. */
function bacaKeranjang(kunci: string): Keranjang {
  try {
    const raw = window.localStorage.getItem(kunci);
    if (!raw) return {};
    const x: unknown = JSON.parse(raw);
    if (!x || typeof x !== "object" || Array.isArray(x)) return {};
    const out: Keranjang = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k.includes("::") && typeof v === "number" && Number.isInteger(v) && v > 0) out[k] = Math.min(v, MAKS_QTY);
    }
    return out;
  } catch {
    return {};
  }
}

function simpanKeranjang(kunci: string, k: Keranjang) {
  try {
    if (Object.keys(k).length === 0) window.localStorage.removeItem(kunci);
    else window.localStorage.setItem(kunci, JSON.stringify(k));
  } catch {
    /* penyimpanan peramban tidak tersedia — keranjang tetap hidup selama halaman terbuka */
  }
}

/** Baris yang masih bisa dipesan: barang & varian masih ada, tidak habis, (PUTUS) sudah berharga. */
function bolehDipesan(b: Barang | undefined, variantSku: string, putus: boolean): boolean {
  if (!b) return false;
  if (putus && hargaDari(b) == null) return false;
  if (b.varian.length === 0) return variantSku === "" && b.ketersediaan !== "HABIS";
  const v = b.varian.find((x) => x.variantSku === variantSku);
  return !!v && v.ketersediaan !== "HABIS";
}

function LencanaStok({ ember }: { ember: Ketersediaan }) {
  const t = useTranslations("portalToko.stok");
  return (
    <Badge variant={ember === "TERSEDIA" ? "secondary" : ember === "TERBATAS" ? "outline" : "destructive"}>{t(ember)}</Badge>
  );
}

function Gambar({ src, alt }: { src: string | null; alt: string }) {
  const [rusak, setRusak] = useState(false);
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {src && !rusak ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setRusak(true)}
        />
      ) : (
        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

/** − [jumlah] + — jumlah bisa diketik, karena toko memesan per lusin, bukan satu-satu. */
function PengaturJumlah({
  nilai,
  onUbah,
  nonaktif,
  label,
}: {
  nilai: number;
  onUbah: (n: number) => void;
  nonaktif?: boolean;
  label: string;
}) {
  const t = useTranslations("portalToko");
  // Teks hanya hidup selama kolom sedang diketik; selain itu kolom menampilkan nilai keranjang.
  const [teks, setTeks] = useState<string | null>(null);
  const terapkan = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    onUbah(Number.isFinite(n) && n > 0 ? Math.min(n, MAKS_QTY) : 0);
    setTeks(null);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={nonaktif || nilai <= 0}
        onClick={() => onUbah(Math.max(0, nilai - 1))}
        aria-label={t("kurangi", { nama: label })}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        inputMode="numeric"
        pattern="[0-9]*"
        className="w-16 text-center tabular-nums"
        value={teks ?? String(nilai)}
        disabled={nonaktif}
        onFocus={() => setTeks(String(nilai))}
        aria-label={t("jumlahUntuk", { nama: label })}
        onChange={(e) => setTeks(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
        onBlur={(e) => terapkan(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") terapkan((e.target as HTMLInputElement).value);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={nonaktif || nilai >= MAKS_QTY}
        onClick={() => onUbah(Math.min(MAKS_QTY, nilai + 1))}
        aria-label={t("tambah", { nama: label })}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

type Selesai = { orderNo: string; total: number | null };

export function PortalTokoShell({ token, katalog }: { token: string; katalog: KatalogPortal }) {
  const t = useTranslations("portalToko");
  const putus = katalog.jenis === "PUTUS";
  const barang = katalog.barang as Barang[];
  const peta = useMemo(() => new Map(barang.map((b) => [b.itemId, b])), [barang]);
  const kunciSimpan = `elorae-portal-keranjang:${token.slice(0, 12)}`;

  const [mati, setMati] = useState(false);
  const [tampilan, setTampilan] = useState<"katalog" | "tinjau" | "selesai">("katalog");
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState<string | null>(null);
  const [batas, setBatas] = useState(PER_HALAMAN);
  const [keranjang, setKeranjang] = useState<Keranjang>({});
  const [dimuat, setDimuat] = useState(false);
  const [lembar, setLembar] = useState<Barang | null>(null);
  const [catatan, setCatatan] = useState("");
  const [pratinjau, setPratinjau] = useState<Extract<PratinjauPortal, { ok: true; jenis: "PUTUS" }> | null>(null);
  const [galat, setGalat] = useState<string[] | null>(null);
  const [selesai, setSelesai] = useState<Selesai | null>(null);
  const [mengirim, mulaiKirim] = useTransition();
  /*
   * Kunci idempoten: dibuat sekali per percobaan kirim dan DIPERTAHANKAN bila
   * jaringan putus (kiriman ulang mengembalikan pesanan yang mungkin sudah
   * tercatat). Diganti baru begitu server menjawab dengan pasti — sukses atau
   * ditolak — karena kunci itu tidak lagi mewakili pesanan yang belum terjawab.
   */
  const kunciKirim = useRef<string | null>(null);

  // Muat keranjang dari HP, lalu buang baris yang sudah tidak bisa dipesan.
  useEffect(() => {
    const simpanan = bacaKeranjang(kunciSimpan);
    const bersih: Keranjang = {};
    for (const [k, qty] of Object.entries(simpanan)) {
      const { itemId, variantSku } = pisahKunci(k);
      if (bolehDipesan(peta.get(itemId), variantSku, putus)) bersih[k] = qty;
    }
    setKeranjang(bersih);
    setDimuat(true);
  }, [kunciSimpan, peta, putus]);

  useEffect(() => {
    if (dimuat) simpanKeranjang(kunciSimpan, keranjang);
  }, [dimuat, kunciSimpan, keranjang]);

  const ubahJumlah = (itemId: string, variantSku: string, qty: number) => {
    setKeranjang((k) => {
      const kunci = kunciBaris(itemId, variantSku);
      const baru = { ...k };
      if (qty <= 0) delete baru[kunci];
      else if (kunci in baru || Object.keys(baru).length < MAKS_BARIS) baru[kunci] = Math.min(qty, MAKS_QTY);
      return baru;
    });
  };

  const kategoriDaftar = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of barang) if (b.kategoriId && b.kategori) m.set(b.kategoriId, b.kategori);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [barang]);

  const tersaring = useMemo(() => {
    const jarum = q.trim().toLowerCase();
    return barang.filter(
      (b) =>
        (!kategori || b.kategoriId === kategori) &&
        (!jarum || b.nama.toLowerCase().includes(jarum) || b.sku.toLowerCase().includes(jarum) || (b.kategori ?? "").toLowerCase().includes(jarum)),
    );
  }, [barang, q, kategori]);

  const baris = useMemo(
    () =>
      Object.entries(keranjang)
        .map(([k, qty]) => {
          const { itemId, variantSku } = pisahKunci(k);
          const b = peta.get(itemId);
          if (!b) return null;
          const label = b.varian.find((v) => v.variantSku === variantSku)?.label ?? null;
          return { kunci: k, itemId, variantSku, qty, barang: b, label };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [keranjang, peta],
  );
  const jumlahPcs = baris.reduce((n, l) => n + l.qty, 0);
  const totalKasar = baris.reduce((n, l) => n + l.qty * (hargaDari(l.barang) ?? 0), 0);

  // Minimum pesan dihitung per barang (semua varian dijumlah) — sama dengan server.
  const kurangMinimum = useMemo(() => {
    if (!putus) return [];
    const perBarang = new Map<string, { nama: string; min: number; jumlah: number }>();
    for (const l of baris) {
      const ada = perBarang.get(l.itemId) ?? { nama: l.barang.nama, min: minDari(l.barang), jumlah: 0 };
      ada.jumlah += l.qty;
      perBarang.set(l.itemId, ada);
    }
    return [...perBarang.values()].filter((x) => x.min > 1 && x.jumlah < x.min);
  }, [baris, putus]);

  const masukan = useMemo(() => baris.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })), [baris]);

  // Pratinjau harga (PUTUS saja) setiap keranjang berubah di layar tinjau.
  // "Sedang memuat" diturunkan, bukan disimpan: pratinjau yang ada milik keranjang yang mana.
  const perluPratinjau = tampilan === "tinjau" && putus && masukan.length > 0;
  const kunciMasukan = useMemo(() => JSON.stringify(masukan), [masukan]);
  const [pratinjauUntuk, setPratinjauUntuk] = useState<string | null>(null);
  useEffect(() => {
    if (!perluPratinjau) return;
    let batal = false;
    const jeda = setTimeout(async () => {
      try {
        const r = await pratinjauPesananPortalAksi(token, masukan);
        if (batal) return;
        if (!r.ok && "code" in r && r.code === "TAUTAN_TIDAK_BERLAKU") setMati(true);
        else if (r.ok && r.jenis === "PUTUS") {
          setPratinjau(r);
          setGalat(null);
        } else if (!r.ok && "masalah" in r) {
          setPratinjau(null);
          setGalat(pesanMasalah(r.masalah));
        } else setPratinjau(null);
      } catch {
        if (!batal) setPratinjau(null);
      } finally {
        if (!batal) setPratinjauUntuk(kunciMasukan);
      }
    }, 400);
    return () => {
      batal = true;
      clearTimeout(jeda);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perluPratinjau, token, kunciMasukan]);
  const memuatPratinjau = perluPratinjau && pratinjauUntuk !== kunciMasukan;
  // Pratinjau hanya dipakai bila memang milik keranjang yang sedang tampil.
  const pratinjauTampil = perluPratinjau && !memuatPratinjau ? pratinjau : null;

  function pesanMasalah(m: MasalahBaris): string[] {
    const daftar = m.nama.length > 0 ? m.nama.join(", ") : null;
    const kepala = t(`masalah.${m.code}`);
    return daftar ? [kepala, daftar] : [kepala];
  }

  function pesanGagal(r: Exclude<HasilKirimPortal, { ok: true }>): string[] {
    switch (r.code) {
      case "BARIS":
        return pesanMasalah(r.masalah);
      case "BATAS_HARIAN":
        return [t("gagal.BATAS_HARIAN", { batas: r.batas })];
      case "MIN_PESAN":
        return [t("gagal.MIN_PESAN"), ...r.kurang.map((k) => t("gagal.minBaris", { nama: k.nama, min: k.min, jumlah: k.jumlah }))];
      case "HUBUNGI_SALESMAN":
        return [t("gagal.HUBUNGI_SALESMAN")];
      case "TIDAK_SAH":
        return [t("gagal.TIDAK_SAH")];
      default:
        return [t("gagal.GAGAL")];
    }
  }

  const kirim = () => {
    if (baris.length === 0 || mengirim) return;
    if (!kunciKirim.current) kunciKirim.current = newLocalId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    const idempotencyKey = kunciKirim.current;
    setGalat(null);
    mulaiKirim(async () => {
      let r: Awaited<ReturnType<typeof kirimPesananPortalAksi>>;
      try {
        r = await kirimPesananPortalAksi(token, { lines: masukan, note: catatan.trim() || undefined, idempotencyKey });
      } catch {
        // Jaringan: kunci DIPERTAHANKAN supaya kiriman ulang tidak membuat pesanan kedua.
        setGalat([t("gagal.JARINGAN")]);
        return;
      }
      kunciKirim.current = null;
      if (!r.ok) {
        if (r.code === "TAUTAN_TIDAK_BERLAKU") setMati(true);
        else setGalat(pesanGagal(r));
        return;
      }
      setSelesai({ orderNo: r.orderNo, total: r.jenis === "PUTUS" ? r.total : null });
      setKeranjang({});
      setCatatan("");
      setTampilan("selesai");
      window.scrollTo({ top: 0 });
    });
  };

  if (mati) return <TautanMati />;

  const kepala = (
    <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{katalog.kepala.namaToko}</h1>
          {katalog.kepala.namaSalesman && (
            <p className="truncate text-xs text-muted-foreground">{t("salesmanAnda", { nama: katalog.kepala.namaSalesman })}</p>
          )}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/toko/${token}/pesanan`}>
            <ClipboardList className="h-4 w-4" aria-hidden />
            {t("pesananSaya")}
          </Link>
        </Button>
      </div>
    </header>
  );

  // ── Selesai ──
  if (tampilan === "selesai" && selesai) {
    return (
      <>
        {kepala}
        <main className="flex flex-1 flex-col gap-4 p-4">
          <Card className="py-0">
            <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-primary" aria-hidden />
              <h2 className="text-lg font-semibold">{t("selesai.judul")}</h2>
              <p className="text-sm text-muted-foreground">{t("selesai.nomor")}</p>
              <p className="font-mono text-base font-semibold">{selesai.orderNo}</p>
              {selesai.total !== null && <p className="text-sm tabular-nums">{t("selesai.total", { total: formatIDR(selesai.total) })}</p>}
              <Badge variant="outline">{t("selesai.menunggu")}</Badge>
              <p className="text-sm text-muted-foreground">{t("selesai.isi")}</p>
            </CardContent>
          </Card>
          <Button asChild>
            <Link href={`/toko/${token}/pesanan`}>{t("pesananSaya")}</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSelesai(null);
              setTampilan("katalog");
            }}
          >
            {t("selesai.pesanLagi")}
          </Button>
        </main>
      </>
    );
  }

  // ── Tinjau ──
  if (tampilan === "tinjau") {
    const indeksPratinjau = new Map((pratinjauTampil?.baris ?? []).map((p) => [kunciBaris(p.itemId, p.variantSku), p]));
    return (
      <>
        {kepala}
        <main className="flex flex-1 flex-col gap-3 p-4 pb-40">
          <Button variant="ghost" className="self-start" onClick={() => setTampilan("katalog")}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("kembaliKeKatalog")}
          </Button>
          <h2 className="text-lg font-semibold">{t("tinjau.judul")}</h2>
          {!putus && <p className="text-sm text-muted-foreground">{t("tinjau.konsi")}</p>}

          {baris.length === 0 ? (
            <Card className="py-0">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("keranjangKosong")}</CardContent>
            </Card>
          ) : (
            baris.map((l) => {
              const nama = l.label ? `${l.barang.nama} — ${l.label}` : l.barang.nama;
              const p = indeksPratinjau.get(l.kunci);
              return (
                <Card key={l.kunci} className="gap-2 py-3">
                  <CardContent className="flex flex-col gap-2 px-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium leading-snug">{nama}</p>
                        <p className="text-xs text-muted-foreground">{l.barang.sku}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => ubahJumlah(l.itemId, l.variantSku, 0)}
                        aria-label={t("hapus", { nama })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <PengaturJumlah nilai={l.qty} onUbah={(n) => ubahJumlah(l.itemId, l.variantSku, n)} label={nama} />
                      {putus && (
                        <div className="text-right text-sm tabular-nums">
                          <p>{formatIDR((p?.hargaSatuan ?? hargaDari(l.barang) ?? 0) * l.qty)}</p>
                          {p && p.potongan > 0 && <p className="text-xs text-primary">{t("tinjau.potongan", { nilai: formatIDR(p.potongan) })}</p>}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}

          {putus && pratinjauTampil && pratinjauTampil.bonus.length > 0 && (
            <Card className="gap-1 py-3">
              <CardContent className="px-3 text-sm">
                <p className="font-medium">{t("tinjau.bonus")}</p>
                {pratinjauTampil.bonus.map((b, i) => (
                  <p key={i} className="text-muted-foreground">
                    {t("tinjau.bonusBaris", { nama: b.nama, qty: b.qty })}
                  </p>
                ))}
              </CardContent>
            </Card>
          )}

          {kurangMinimum.length > 0 && (
            <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <p className="font-medium">{t("gagal.MIN_PESAN")}</p>
              {kurangMinimum.map((k) => (
                <p key={k.nama}>{t("gagal.minBaris", { nama: k.nama, min: k.min, jumlah: k.jumlah })}</p>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="portal-catatan">{t("tinjau.catatan")}</Label>
            <Textarea
              id="portal-catatan"
              value={catatan}
              maxLength={500}
              placeholder={t("tinjau.catatanContoh")}
              onChange={(e) => setCatatan(e.target.value)}
            />
          </div>

          {galat && (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              {galat.map((g, i) => (
                <p key={i} className={i === 0 ? "font-medium" : undefined}>
                  {g}
                </p>
              ))}
            </div>
          )}
        </main>

        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-xl border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {putus && (
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {pratinjauTampil && pratinjauTampil.potonganPesanan > 0
                  ? t("tinjau.potonganPesanan", { nilai: formatIDR(pratinjauTampil.potonganPesanan) })
                  : t("tinjau.total")}
              </span>
              <span className="text-base font-semibold tabular-nums">
                {memuatPratinjau ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : formatIDR(pratinjauTampil?.total ?? totalKasar)}
              </span>
            </div>
          )}
          <Button className="w-full" size="lg" disabled={baris.length === 0 || mengirim || kurangMinimum.length > 0} onClick={kirim}>
            {mengirim ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShoppingBag className="h-4 w-4" aria-hidden />}
            {t("tinjau.kirim")}
          </Button>
        </div>
      </>
    );
  }

  // ── Katalog ──
  const terlihat = tersaring.slice(0, batas);
  return (
    <>
      {kepala}
      <main className="flex flex-1 flex-col gap-3 p-4 pb-32">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="pl-9"
            placeholder={t("cari")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setBatas(PER_HALAMAN);
            }}
            aria-label={t("cari")}
          />
        </div>
        {kategoriDaftar.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            <Button size="sm" variant={kategori === null ? "default" : "outline"} onClick={() => setKategori(null)}>
              {t("semuaKategori")}
            </Button>
            {kategoriDaftar.map(([id, nama]) => (
              <Button
                key={id}
                size="sm"
                variant={kategori === id ? "default" : "outline"}
                onClick={() => {
                  setKategori(id);
                  setBatas(PER_HALAMAN);
                }}
              >
                {nama}
              </Button>
            ))}
          </div>
        )}
        {putus && katalog.minimum.min > 1 && (
          <p className="text-xs text-muted-foreground">{t("minimumToko", { min: katalog.minimum.min })}</p>
        )}

        {terlihat.length === 0 ? (
          <Card className="py-0">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("kosong")}</CardContent>
          </Card>
        ) : (
          terlihat.map((b) => {
            const harga = hargaDari(b);
            const tanpaHarga = putus && harga == null;
            const dipilih = baris.filter((l) => l.itemId === b.itemId).reduce((n, l) => n + l.qty, 0);
            return (
              <Card key={b.itemId} className="flex-row gap-3 p-3">
                <Gambar src={b.gambar} alt={b.nama} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium leading-snug">{b.nama}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.sku}
                    {b.kategori ? ` · ${b.kategori}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <LencanaStok ember={b.ketersediaan} />
                    {putus && (
                      <span className="text-sm font-semibold tabular-nums">{harga != null ? formatIDR(harga) : t("hargaBelumAda")}</span>
                    )}
                  </div>
                  {putus && minDari(b) > 1 && <p className="mt-0.5 text-xs text-muted-foreground">{t("minPesan", { min: minDari(b) })}</p>}
                  <div className="mt-2">
                    {b.varian.length > 0 ? (
                      <Button
                        type="button"
                        variant={dipilih > 0 ? "default" : "outline"}
                        size="sm"
                        disabled={tanpaHarga || b.ketersediaan === "HABIS"}
                        onClick={() => setLembar(b)}
                      >
                        {dipilih > 0 ? t("pilihUkuranTerpilih", { jumlah: dipilih }) : t("pilihUkuran")}
                      </Button>
                    ) : (
                      <PengaturJumlah
                        nilai={keranjang[kunciBaris(b.itemId, "")] ?? 0}
                        onUbah={(n) => ubahJumlah(b.itemId, "", n)}
                        nonaktif={tanpaHarga || b.ketersediaan === "HABIS"}
                        label={b.nama}
                      />
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
        {tersaring.length > batas && (
          <Button variant="outline" onClick={() => setBatas((n) => n + PER_HALAMAN)}>
            {t("lebihBanyak", { sisa: tersaring.length - batas })}
          </Button>
        )}
      </main>

      {baris.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-xl border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("ringkasKeranjang", { baris: baris.length, pcs: jumlahPcs })}</span>
            {putus && <span className="font-semibold tabular-nums">{formatIDR(totalKasar)}</span>}
          </div>
          <Button className="w-full" size="lg" onClick={() => setTampilan("tinjau")}>
            {t("tinjauPesanan")}
          </Button>
        </div>
      )}

      <Sheet open={lembar !== null} onOpenChange={(buka) => !buka && setLembar(null)}>
        <SheetContent side="bottom" className="flex max-h-[85vh] flex-col gap-0 p-0">
          {lembar && (
            <>
              <SheetHeader className="border-b pb-3">
                <SheetTitle>{t("pilihUkuran")}</SheetTitle>
                <SheetDescription>{lembar.nama}</SheetDescription>
                {putus && minDari(lembar) > 1 && <p className="text-xs text-muted-foreground">{t("minPesanLembar", { min: minDari(lembar) })}</p>}
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-2">
                  {lembar.varian.map((v) => {
                    const habis = v.ketersediaan === "HABIS";
                    return (
                      <div key={v.variantSku} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{v.label}</p>
                          <div className="mt-1">
                            <LencanaStok ember={v.ketersediaan} />
                          </div>
                        </div>
                        <PengaturJumlah
                          nilai={keranjang[kunciBaris(lembar.itemId, v.variantSku)] ?? 0}
                          onUbah={(n) => ubahJumlah(lembar.itemId, v.variantSku, n)}
                          nonaktif={habis}
                          label={`${lembar.nama} — ${v.label}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <SheetFooter className="border-t pt-3">
                <Button type="button" className="w-full" onClick={() => setLembar(null)}>
                  {t("selesaiPilih")}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
