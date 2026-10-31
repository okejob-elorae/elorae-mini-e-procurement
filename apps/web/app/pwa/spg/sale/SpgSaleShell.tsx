"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronUp, CloudOff, Loader2, MapPin, Minus, Plus, Search, SearchX, ShoppingCart, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PemindaiBarcode } from "@/components/spg/PemindaiBarcode";
import { recordSpgSaleAction } from "@/app/actions/spg-sale";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { cocokkanKode, kunciBaris } from "@/lib/spg/stok";
import type { PromoKonter } from "@/lib/spg/promo-konter";
import type { AturanDiskonManualSpg } from "@/lib/spg/pengaturan";
import type { AturanMember } from "@/lib/spg/member";
import type { SpgCatalogRow } from "@/lib/spg/sale-queries";
import { cn } from "@/lib/utils";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { tautanCheckInLaluKembali } from "@/lib/pwa/kembali-setelah-checkin";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { antreNotaSpg, hitungNotaSpgTertahan } from "@/lib/pwa/offline/spg-jual-antrean";
import { ikatanKunjungan } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { muatanDiskon, muatanPembeli, namaPembeliTertahan, susunNotaTertahan } from "@/lib/pwa/offline/spg-jual-muatan";
import { catatSelisihTotalDiHp, totalBerbeda } from "@/lib/pwa/offline/spg-jual-selisih";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { SpgVariantSheet, TeksStok, labelVarian, type SpgGroup } from "./SpgVariantSheet";
import { SpandukPromo } from "./SpandukPromo";
import { IsianDiskonManual } from "./IsianDiskonManual";
import { IsianPembeli } from "./IsianPembeli";
import { NotaTersimpanLuring, type RingkasanNotaLuring } from "./NotaTersimpanLuring";
import {
  diskonUntukMesin,
  kekuranganJual,
  kunciSimpananKeranjang,
  memberDiketahui,
  memberKeranjang,
  pembeliUntukKirim,
  pratinjauKeranjang,
  uraiSimpananKeranjang,
  type IsianDiskon,
  type PembeliKeranjang,
  type SimpananKeranjang,
} from "./keranjang";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Hasil cari ditampilkan bertahap — katalog bisa ratusan barang, HP SPG bukan laptop. */
const PER_HALAMAN = 30;
/** Satu toast pindai yang diperbarui, bukan tumpukan toast saat memindai beruntun. */
const TOAST_PINDAI = "spg-jual-pindai";
/**
 * Sinyal lemah di mal sering "tersambung" tanpa internet: permintaan menggantung
 * sampai TCP menyerah, berpuluh detik. Lewat batas ini nota dipindah ke antrean
 * HP — kalau ternyata servernya sudah mencatat, kiriman dari antrean membawa
 * kunci yang sama dan hanya mendapat nota yang ada.
 */
const BATAS_TUNGGU_MS = 20_000;

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "NO_ACTIVE_VISIT",
  "KUNJUNGAN_TIDAK_SAH",
  "EMPTY",
  "STORE_NOT_FOUND",
  "NO_PRICE",
  "INSUFFICIENT_PAYMENT",
  "VALIDATION",
  "DISKON_MANUAL_NONAKTIF",
  "DISKON_MANUAL_LEWAT_BATAS",
  "DISKON_MANUAL_TIDAK_VALID",
  "ALASAN_DISKON_WAJIB",
  "PELANGGAN_TIDAK_VALID",
  "WAKTU_TIDAK_VALID",
]);

/** Galat mesin promo/isian yang ditampilkan tepat di bawah isian angka diskon. */
const GALAT_ISIAN_DISKON = new Set(["DISKON_TIDAK_VALID", "DISKON_MANUAL_NONAKTIF", "DISKON_MANUAL_LEWAT_BATAS", "DISKON_MANUAL_TIDAK_VALID"]);

/**
 * GPS sekadar pelengkap: penolakan izin, habis waktu, atau HP tanpa GPS tidak
 * pernah menahan penjualan (sama dengan layar jual van). Yang wajib GPS hanya
 * check-in.
 */
function posisiSeadanya(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
    );
  });
}

function denganBatasWaktu<T>(janji: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("BATAS_WAKTU")), BATAS_TUNGGU_MS);
    janji.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/** Penyimpanan bisa dilarang (mode privat) — setiap akses dibungkus try/catch. */
function bacaKeranjang(storeId: string): SimpananKeranjang | null {
  try {
    return uraiSimpananKeranjang(window.sessionStorage.getItem(kunciSimpananKeranjang(storeId)));
  } catch {
    return null;
  }
}

function tulisKeranjang(storeId: string, s: SimpananKeranjang) {
  try {
    if (s.baris.length === 0 && !s.diskon && !s.pembeli) window.sessionStorage.removeItem(kunciSimpananKeranjang(storeId));
    else window.sessionStorage.setItem(kunciSimpananKeranjang(storeId), JSON.stringify(s));
  } catch {
    // Penyimpanan penuh atau dilarang: keranjang tetap hidup selama layar terbuka.
  }
}

// Sinyal dan jam untuk pratinjau promo, dibaca lewat useSyncExternalStore:
// render tetap murni dan server merender tanpa keduanya.
function langgananSinyal(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const adaSinyal = () => navigator.onLine;
const adaSinyalServer = () => true;
function langgananMenit(cb: () => void) {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
}
/** Menit berjalan (bukan milidetik): nilai stabil di antara dua panggilan dalam satu render. */
const menitSekarang = (): number | null => Math.floor(Date.now() / 60_000);
const menitServer = (): number | null => null;

function namaLengkap(row: SpgCatalogRow): string {
  return row.variantLabel ? `${row.productName} — ${row.variantLabel}` : row.productName;
}

/** Layar pengganti saat SPG membuka Jual tanpa check-in di tokonya. */
export function SpgBelumCheckIn({ namaToko }: { namaToko: string }) {
  const t = useTranslations("pwa.spgJual");
  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>
      <section className="beranda-kartu space-y-3 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground">
          <MapPin className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-xl font-bold">{t("noVisit.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("noVisit.body", { store: namaToko })}</p>
        {/* Sesudah check-in, beranda membawa SPG kembali ke layar jual. */}
        <Button asChild size="lg" className="w-full">
          <Link href={tautanCheckInLaluKembali("/pwa/spg/sale")}>{t("noVisit.cta")}</Link>
        </Button>
      </section>
    </div>
  );
}

/** Satu baris "label ........ uang". Uang tidak pernah dipotong; labelnya yang membungkus. */
function BarisUang({ label, nilai, kuat = false, potongan = false }: { label: string; nilai: number; kuat?: boolean; potongan?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", kuat ? "text-base font-bold" : "text-sm")}>
      <span className={cn("min-w-0 flex-1", !kuat && "text-muted-foreground")}>{label}</span>
      <span
        className={cn(
          "shrink-0 whitespace-nowrap tabular-nums",
          potongan && "text-emerald-700 dark:text-emerald-400",
          kuat && "text-lg",
        )}
      >
        {potongan ? `−${formatIDR(nilai)}` : formatIDR(nilai)}
      </span>
    </div>
  );
}

/**
 * Layar jual SPG — seperti checkout marketplace: pindai barcode (atau ketik
 * SKU) untuk menambah satu, atau cari manual lalu pilih variannya. Keranjang
 * hidup di bilah bawah; ketuk untuk mengubah jumlah, diskon, dan pembeli.
 *
 * Uang TIDAK ditanyakan: pembeli membayar di kasir toko, SPG hanya mencatat
 * barangnya. Stok toko ditampilkan tapi tidak pernah menolak penjualan.
 *
 * Promo konter dihitung DI HP dengan mesin yang sama dengan server
 * (`hitungPromoKonter`) dari daftar promo yang ikut halaman ini — pratinjau
 * itu juga yang dipakai saat tidak ada sinyal. Server tetap yang memutuskan.
 *
 * Tanpa sinyal (atau server tidak menjawab), nota masuk antrean HP dan
 * terkirim sendiri saat sinyal kembali, dicatat pada waktu jualnya.
 */
export function SpgSaleShell({
  katalog,
  storeId,
  namaToko,
  stokDilacak,
  promos,
  aturanManual,
  aturanMember,
  visitId,
  checkinAtMs = null,
  markupMissing = false,
}: {
  katalog: SpgCatalogRow[];
  /** Kunci simpanan keranjang — keranjang toko lain tidak pernah terbawa. */
  storeId: string;
  namaToko: string;
  /** Toko ini sudah punya gerakan stok. Kalau belum, angka stok (semuanya 0) disembunyikan. */
  stokDilacak: boolean;
  /** Promo konter yang bisa berlaku di toko ini (termasuk yang mulai beberapa hari lagi). */
  promos: PromoKonter[];
  aturanManual: AturanDiskonManualSpg;
  /** Aturan member saat halaman dibuka — dasar diskon member di pratinjau, juga tanpa sinyal. */
  aturanMember: AturanMember;
  /**
   * Kunjungan (check-in) aktif di toko ini menurut server, atau `null`. Tanpa
   * itu layar memakai check-in yang dicatat tanpa sinyal di HP
   * (`useKunjunganLokal`); tanpa keduanya, layar meminta check-in.
   */
  visitId: string | null;
  /** Jam check-in kunjungan server — kunjungan HP yang lebih baru menggantikannya. */
  checkinAtMs?: number | null;
  /** Toko konsinyasi tanpa markup yang sah: barangnya tidak bisa diberi harga (dinilai di server). */
  markupMissing?: boolean;
}) {
  const t = useTranslations("pwa.spgJual");
  const td = dinamis(t);
  const tHarga = useTranslations("spgSale");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [batasTampil, setBatasTampil] = useState(PER_HALAMAN);
  const [keranjang, setKeranjang] = useState<Map<string, number>>(() => new Map());
  // Tetap sama antar-percobaan: simpan ulang setelah galat yang meragukan
  // (sinyal putus setelah server menulis) tidak mencatat nota kedua — dan
  // nota yang lalu masuk antrean HP membawa kunci yang sama. Diganti hanya
  // setelah nota tercatat atau tersimpan di HP.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newLocalId());
  const [diskon, setDiskon] = useState<IsianDiskon | null>(null);
  const [pembeli, setPembeli] = useState<PembeliKeranjang | null>(null);
  const [grupVarian, setGrupVarian] = useState<SpgGroup | null>(null);
  const [varianBuka, setVarianBuka] = useState(false);
  const [keranjangBuka, setKeranjangBuka] = useState(false);
  const [tersimpanLuring, setTersimpanLuring] = useState<RingkasanNotaLuring | null>(null);
  const [tertahan, setTertahan] = useState(0);
  // Keranjang tersimpan baru dibaca setelah mount (server merender keranjang
  // kosong); sebelum itu tidak ada yang ditulis, supaya simpanan tidak tertimpa kosong.
  const [dipulihkan, setDipulihkan] = useState(false);
  const cariRef = useRef<HTMLInputElement>(null);

  // Nota diikat ke kunjungan yang berlaku: kunjungan server, atau check-in yang
  // masih di antrean HP (`visitClientId`) — nota itu menunggu check-in-nya
  // terkirim dulu, dan gagal di HP bila check-in itu ditolak server.
  const { siap: lokalSiap, kunjungan: kunjunganLokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const ikatan = ikatanKunjungan(visitId ? { id: visitId, checkinAtMs } : null, kunjunganLokal);

  const online = useSyncExternalStore(langgananSinyal, adaSinyal, adaSinyalServer);
  const menit = useSyncExternalStore(langgananMenit, menitSekarang, menitServer);

  const barisPerKunci = useMemo(() => new Map(katalog.map((r) => [kunciBaris(r.itemId, r.variantSku), r])), [katalog]);

  useEffect(() => {
    const simpanan = bacaKeranjang(storeId);
    if (simpanan) {
      // Barang yang sudah tidak dijual (atau belum berharga) dibuang dari keranjang lama.
      const sah = simpanan.baris.filter(([k]) => barisPerKunci.get(k)?.price != null);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- simpanan ada di sessionStorage, hanya terbaca di klien sesudah mount
      setKeranjang(new Map(sah));
      setIdempotencyKey(simpanan.idempotencyKey);
      setDiskon(simpanan.diskon);
      setPembeli(simpanan.pembeli);
    }
    setDipulihkan(true);
    // Sekali saat layar dibuka; katalog baru tidak memulihkan ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId]);

  useEffect(() => {
    if (dipulihkan) tulisKeranjang(storeId, { baris: [...keranjang.entries()], idempotencyKey, diskon, pembeli });
  }, [dipulihkan, storeId, keranjang, idempotencyKey, diskon, pembeli]);

  // Jumlah nota toko ini yang masih menunggu sinyal (antrean HP).
  useEffect(() => {
    let aktif = true;
    const hitung = () => {
      hitungNotaSpgTertahan(storeId).then(
        (n) => {
          if (aktif) setTertahan(n);
        },
        () => undefined,
      );
    };
    hitung();
    window.addEventListener(PERISTIWA_ANTREAN, hitung);
    return () => {
      aktif = false;
      window.removeEventListener(PERISTIWA_ANTREAN, hitung);
    };
  }, [storeId]);

  const grup = useMemo(() => {
    const m = new Map<string, SpgGroup>();
    for (const r of katalog) {
      let g = m.get(r.itemId);
      if (!g) {
        g = { itemId: r.itemId, sku: r.sku, productName: r.productName, price: r.price, stok: null, variants: [] };
        m.set(r.itemId, g);
      }
      g.variants.push(r);
      if (r.stok !== null) g.stok = (g.stok ?? 0) + r.stok;
    }
    const semua = [...m.values()];
    // Barang yang ada di toko didahulukan: itulah yang paling mungkin terjual.
    if (stokDilacak) semua.sort((a, b) => Number((b.stok ?? 0) > 0) - Number((a.stok ?? 0) > 0));
    return semua;
  }, [katalog, stokDilacak]);

  const grupPerId = useMemo(() => new Map(grup.map((g) => [g.itemId, g])), [grup]);

  const hasilCari = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return grup;
    return grup.filter(
      (g) =>
        g.sku.toLowerCase().includes(needle) ||
        g.productName.toLowerCase().includes(needle) ||
        g.variants.some(
          (v) =>
            (v.variantLabel ?? "").toLowerCase().includes(needle) ||
            (v.variantSku ?? "").toLowerCase().includes(needle) ||
            (v.barcode ?? "").toLowerCase().includes(needle),
        ),
    );
  }, [grup, q]);

  const baris = useMemo(
    () =>
      [...keranjang.entries()].flatMap(([k, qty]) => {
        const row = barisPerKunci.get(k);
        return row ? [{ kunci: k, row, qty }] : [];
      }),
    [keranjang, barisPerKunci],
  );
  const jumlahBarang = baris.reduce((n, b) => n + b.qty, 0);
  const kotor = baris.reduce((n, b) => n + b.qty * (b.row.price ?? 0), 0);

  // Diskon manual hanya hidup kalau kantor menyalakannya; simpanan lama dari
  // saat masih menyala diabaikan, tidak dikirim.
  const diskonAktif = aturanManual.aktif ? diskon : null;

  // Member pembeli (tingkat dan diskon dari server, atau tingkat pertama untuk
  // pendaftaran yang belum bisa ditanyakan) — masukan yang sama dengan penulis nota.
  const memberNota = useMemo(() => memberKeranjang(pembeli, aturanMember), [pembeli, aturanMember]);

  // Pratinjau promo + diskon member + diskon manual, dengan mesin dan masukan yang sama dengan server.
  const pratinjau = useMemo(
    () =>
      menit === null
        ? null
        : pratinjauKeranjang({
            baris,
            promos,
            storeId,
            waktu: new Date(menit * 60_000),
            aturan: aturanManual,
            diskon: diskonAktif,
            member: memberNota,
          }),
    [menit, baris, promos, storeId, aturanManual, diskonAktif, memberNota],
  );

  const hasil = pratinjau?.hasil ?? null;
  const hasilPerKunci = useMemo(() => new Map((hasil?.baris ?? []).map((b) => [b.key, b])), [hasil]);
  const total = hasil?.total ?? kotor;
  const potongan = hasil?.potonganTotal ?? 0;

  const kurang = kekuranganJual({
    diskon: diskonAktif,
    alasanWajib: aturanManual.alasanWajib,
    galatMesin: pratinjau?.galatMesin ?? null,
    pembeli,
  });
  // Batas diskon dalam rupiah dihitung dari nilai nota SESUDAH promo — dasar yang sama dengan mesin promo.
  const nilaiKurang = {
    max: aturanManual.maksPersen,
    rupiah: formatIDR(Math.floor(((pratinjau?.tanpaManual.total ?? kotor) * aturanManual.maksPersen) / 100)),
  };
  const galatIsianDiskon = kurang && GALAT_ISIAN_DISKON.has(kurang) ? td(`kurang.${kurang}`, nilaiKurang) : null;
  const teksKurang = pending || !kurang ? null : td(`kurang.${kurang}`, nilaiKurang);

  const qtyOf = (row: SpgCatalogRow) => keranjang.get(kunciBaris(row.itemId, row.variantSku)) ?? 0;

  function aturQty(row: SpgCatalogRow, qty: number) {
    const k = kunciBaris(row.itemId, row.variantSku);
    setKeranjang((lama) => {
      const baru = new Map(lama);
      if (qty <= 0) baru.delete(k);
      else baru.set(k, qty);
      return baru;
    });
  }

  function bukaVarian(g: SpgGroup) {
    setGrupVarian(g);
    setVarianBuka(true);
  }

  function cariManual(kode: string) {
    setQ(kode);
    setBatasTampil(PER_HALAMAN);
    cariRef.current?.focus();
    cariRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /**
   * Satu kode dari pemindai (kamera, pemindai Bluetooth, atau ketikan + Enter).
   * Mengembalikan "tutup" saat perlu memilih ukuran — kamera penuh layar akan
   * menutupi pemilihnya.
   */
  function onKode(kode: string): void | "tutup" {
    const hasilKode = cocokkanKode(kode, katalog);
    const tidakDikenal = () => {
      toast.error(t("scan.notFound", { code: kode }), {
        id: TOAST_PINDAI,
        description: t("scan.notFoundHint"),
        action: { label: t("scan.searchManual"), onClick: () => cariManual(kode) },
      });
    };

    if (!hasilKode) return tidakDikenal();

    if (hasilKode.jenis === "barang") {
      const g = grupPerId.get(hasilKode.itemId);
      if (!g) return tidakDikenal();
      bukaVarian(g);
      toast.message(t("scan.pickVariant", { name: g.productName }), { id: TOAST_PINDAI });
      return "tutup";
    }

    const row = barisPerKunci.get(kunciBaris(hasilKode.itemId, hasilKode.variantSku));
    if (!row) return tidakDikenal();
    if (row.price === null) {
      toast.error(t("scan.noPrice", { name: namaLengkap(row) }), { id: TOAST_PINDAI });
      return;
    }
    const qtyBaru = qtyOf(row) + 1;
    aturQty(row, qtyBaru);
    const judul = t("scan.added", { name: namaLengkap(row), qty: qtyBaru });
    if (stokDilacak && row.stok !== null && qtyBaru > row.stok) {
      toast.warning(judul, { id: TOAST_PINDAI, description: t("scan.overStock", { stok: row.stok }) });
    } else {
      toast.success(judul, { id: TOAST_PINDAI });
    }
  }

  /** Keranjang selesai (tercatat atau tersimpan di HP): kosong, dengan kunci kirim baru. */
  function kosongkan() {
    const kunciBaru = newLocalId();
    tulisKeranjang(storeId, { baris: [], idempotencyKey: kunciBaru, diskon: null, pembeli: null });
    setKeranjang(new Map());
    setIdempotencyKey(kunciBaru);
    setDiskon(null);
    setPembeli(null);
    setKeranjangBuka(false);
  }

  function simpan() {
    if (baris.length === 0 || pending || kurang !== null) return;
    // Waktu jual = saat tombol ditekan; nota tanpa sinyal tercatat pada waktu ini.
    const waktuJual = new Date();
    const pembeliKirim = pembeliUntukKirim(pembeli, aturanMember);
    const infoMember = memberDiketahui(pembeli);
    const manual = diskonUntukMesin(diskonAktif);
    const diskonKirim = manual ? { ...manual, alasan: diskonAktif?.alasan.trim() || null } : null;
    const totalPratinjau = total;
    const potonganPratinjau = potongan;
    const barisKirim = baris.map((b) => ({
      itemId: b.row.itemId,
      variantSku: b.row.variantSku,
      qty: b.qty,
      productName: namaLengkap(b.row),
      unitPrice: b.row.price ?? 0,
    }));
    const ringkasan: RingkasanNotaLuring = {
      baris: baris.map((b) => ({ kunci: b.kunci, nama: namaLengkap(b.row), qty: b.qty })),
      total: totalPratinjau,
      potongan: potonganPratinjau,
      namaPembeli: namaPembeliTertahan(pembeliKirim),
      // Di bawah belanja minimal untuk mendaftar, layar tidak menjanjikan pendaftaran
      // (permintaannya tetap ikut; server yang memutuskan dengan aturannya saat terkirim).
      member:
        pembeliKirim?.daftarMember === true && !pratinjau?.daftarKurang
          ? { tingkat: null, daftar: true }
          : infoMember?.status === "MEMBER"
            ? { tingkat: infoMember.tingkat, daftar: false }
            : null,
    };

    startTransition(async () => {
      const posisi = await posisiSeadanya();

      const simpanDiHp = async () => {
        const nota = susunNotaTertahan({
          idempotencyKey,
          storeId,
          storeName: namaToko,
          visitId: ikatan?.visitId ?? null,
          visitClientId: ikatan?.visitClientId ?? null,
          waktuJual,
          baris: barisKirim,
          pembeli: pembeliKirim,
          diskonManual: diskonKirim,
          totalPratinjau,
          potonganPratinjau,
          posisi,
        });
        if (!nota) return;
        try {
          await antreNotaSpg(nota);
        } catch {
          // Basis data HP tidak bisa ditulis (mode privat, penyimpanan penuh):
          // katakan terus terang — keranjang dibiarkan supaya bisa dicoba lagi.
          toast.error(t("luring.queueFailed"));
          return;
        }
        window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
        kosongkan();
        setTersimpanLuring(ringkasan);
      };

      // Check-in yang masih di antrean HP belum dikenal server: nota ikut
      // antrean dan terkirim SESUDAH check-in-nya, juga saat ada sinyal.
      if (!navigator.onLine || ikatan?.visitClientId) {
        await simpanDiHp();
        if (navigator.onLine) {
          const { kirimSemuaAntrean } = await import("@/lib/pwa/offline/sync");
          void kirimSemuaAntrean().then(() => window.dispatchEvent(new Event(PERISTIWA_ANTREAN)), () => undefined);
        }
        return;
      }

      let res: Awaited<ReturnType<typeof recordSpgSaleAction>>;
      try {
        res = await denganBatasWaktu(
          recordSpgSaleAction({
            saleLat: posisi?.lat ?? null,
            saleLng: posisi?.lng ?? null,
            idempotencyKey,
            lines: barisKirim.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
            pembeli: muatanPembeli(pembeliKirim),
            diskonManual: muatanDiskon(diskonKirim),
          }),
        );
      } catch {
        // Sinyal putus atau server tidak menjawab: simpan di HP dengan kunci yang sama.
        await simpanDiHp();
        return;
      }
      if (res.ok) {
        // Keranjang selesai: dihapus dari simpanan dan dari layar, supaya
        // "Jual lagi" mulai dari keranjang kosong.
        kosongkan();
        const berbeda = totalBerbeda(totalPratinjau, res.total);
        // Harga atau promo di server berbeda dari layar: yang tercatat angka server.
        if (berbeda) catatSelisihTotalDiHp(res.spgSaleId, totalPratinjau, res.total);
        const judul = berbeda ? t("savedDifferent", { docNo: res.docNo, total: formatIDR(res.total) }) : t("saved", { docNo: res.docNo });
        // Hasil member: terdaftar, tingkat yang dipakai, atau kenapa tidak jadi
        // member — notanya tetap tercatat dalam semua kasus.
        const teksMember = res.member
          ? res.member.baru
            ? t("memberHasil.baru", { tingkat: res.member.tingkat })
            : res.member.potongan > 0
              ? t("memberHasil.potong", { tingkat: res.member.tingkat, amount: formatIDR(res.member.potongan) })
              : t("memberHasil.tanpaPotong", { tingkat: res.member.tingkat })
          : res.tanpaMember
            ? td(`memberHasil.${res.tanpaMember}`, { minimal: formatIDR(aturanMember.minBelanjaDaftar) })
            : null;
        const keterangan = [berbeda ? t("savedDifferentHint", { preview: formatIDR(totalPratinjau) }) : null, teksMember].filter(Boolean).join(" ");
        const opsiToast = keterangan ? { description: keterangan } : undefined;
        if (res.tanpaMember) toast.warning(judul, opsiToast);
        else toast.success(judul, opsiToast);
        // replace: Kembali dari nota tidak membuka layar jual yang sudah selesai.
        router.replace(`/pwa/spg/${res.spgSaleId}/nota`);
        return;
      }
      toast.error(KODE_GALAT.has(res.code) ? td(`err.${res.code}`) : t("err.GENERIC"));
    });
  }

  if (tersimpanLuring) {
    return <NotaTersimpanLuring ringkasan={tersimpanLuring} jumlahTertahan={tertahan} onJualLagi={() => setTersimpanLuring(null)} />;
  }

  if (!ikatan) {
    // Antrean HP dibaca sesudah mount: tunggu sebentar sebelum menyimpulkan "belum check-in".
    if (!lokalSiap) {
      return (
        <div className="grid min-h-dvh place-items-center p-4" aria-busy="true">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      );
    }
    return <SpgBelumCheckIn namaToko={namaToko} />;
  }

  const tampil = hasilCari.slice(0, batasTampil);
  const sisa = hasilCari.length - tampil.length;
  const bisaSimpan = !pending && kurang === null;

  return (
    <div className="flex min-h-dvh flex-col gap-4 p-4">
      <header className="space-y-1">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <TautanKembali cadangan="/pwa" />
        </Button>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("subtitle", { store: namaToko })}</p>
      </header>

      {!online || tertahan > 0 ? (
        <section className="beranda-kartu space-y-2" aria-live="polite">
          {!online ? (
            <p className="flex items-start gap-2 text-sm">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
              <span>{t("luring.offlineBanner")}</span>
            </p>
          ) : null}
          {tertahan > 0 ? (
            <Link href="/pwa/spg/antrean" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
              {t("luring.pendingLink", { count: tertahan })}
            </Link>
          ) : null}
        </section>
      ) : null}

      {markupMissing ? (
        <Alert className="border-amber-500/50">
          <AlertDescription className="text-amber-800 dark:text-amber-300">{tHarga("markupMissing")}</AlertDescription>
        </Alert>
      ) : null}

      <SpandukPromo berlaku={hasil?.berlaku ?? []} promos={promos} katalog={katalog} />

      <section className="beranda-kartu space-y-3">
        <PemindaiBarcode onKode={onKode} placeholder={t("scanPlaceholder")} />
        <div className="space-y-1.5">
          <Label htmlFor="spg-jual-cari" className="text-xs text-muted-foreground">
            {t("searchLabel")}
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="spg-jual-cari"
              ref={cariRef}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setBatasTampil(PER_HALAMAN);
              }}
              placeholder={t("searchPlaceholder")}
              autoComplete="off"
              enterKeyHint="search"
              className="pl-9"
            />
          </div>
        </div>
        {/* Warna teks biasa + garis bawah, bukan `text-primary`: limau di atas
            krem nyaris tak terbaca di tema terang. */}
        <Link href="/pwa/spg/dicari" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline underline-offset-4">
          <SearchX className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("lostSaleLink")}
        </Link>
      </section>

      {katalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : hasilCari.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noResults", { q: q.trim() })}</p>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {tampil.map((g) => {
              const tunggal = g.variants.length === 1 ? g.variants[0] : null;
              const qtyTunggal = tunggal ? qtyOf(tunggal) : 0;
              const dipilih = g.variants.reduce((n, v) => n + qtyOf(v), 0);
              return (
                <li key={g.itemId} className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5", dipilih > 0 && "bg-primary/5")}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-tight">{g.productName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {g.sku}
                      {!tunggal ? ` · ${t("variants", { count: g.variants.length })}` : null}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
                      {g.price !== null ? (
                        <span className="text-sm font-semibold tabular-nums">{formatIDR(g.price)}</span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">{t("noPrice")}</span>
                      )}
                      {stokDilacak && g.stok !== null ? <TeksStok qty={g.stok} /> : null}
                    </div>
                  </div>

                  {tunggal ? (
                    tunggal.price === null ? null : qtyTunggal > 0 ? (
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          disabled={pending}
                          onClick={() => aturQty(tunggal, qtyTunggal - 1)}
                          aria-label={t("decrease", { name: g.productName })}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{qtyTunggal}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-lg"
                          disabled={pending}
                          onClick={() => aturQty(tunggal, qtyTunggal + 1)}
                          aria-label={t("add", { name: g.productName })}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={pending}
                        onClick={() => aturQty(tunggal, 1)}
                        aria-label={t("add", { name: g.productName })}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    )
                  ) : (
                    <Button type="button" variant={dipilih > 0 ? "default" : "outline"} disabled={pending} onClick={() => bukaVarian(g)}>
                      {dipilih > 0 ? t("inCart", { count: dipilih }) : t("pick")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {sisa > 0 ? (
            <div className="border-t p-3">
              <Button type="button" variant="ghost" className="w-full" onClick={() => setBatasTampil((n) => n + PER_HALAMAN)}>
                {t("showMore", { count: sisa })}
              </Button>
            </div>
          ) : null}
        </section>
      )}

      {jumlahBarang > 0 && (
        <div className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-auto border-t bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          {/* Total di barisnya sendiri, tombol simpan selebar layar di bawahnya:
              uang tidak pernah berebut tempat dengan tombol, jadi tidak terpotong. */}
          <div className="space-y-2">
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start gap-3 px-2 py-1.5 text-left"
              onClick={() => setKeranjangBuka(true)}
              aria-label={t("cart.open")}
            >
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <ShoppingCart className="h-5 w-5" aria-hidden />
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-foreground px-1 text-center text-[11px] font-semibold leading-5 text-background tabular-nums">
                  {jumlahBarang}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-muted-foreground">{t("cart.summary", { count: jumlahBarang })}</span>
                {potongan > 0 ? (
                  <span className="block text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                    {t("cart.saving", { amount: formatIDR(potongan) })}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 whitespace-nowrap text-base font-semibold tabular-nums">{formatIDR(total)}</span>
              <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </Button>
            {!online ? <p className="text-center text-xs text-muted-foreground">{t("luring.saveOffline")}</p> : null}
            <Button type="button" size="lg" className="w-full" onClick={simpan} disabled={!bisaSimpan}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? t("saving") : t("saveShort")}
            </Button>
            <KeteranganKirim teks={teksKurang} />
          </div>
        </div>
      )}

      <Sheet open={keranjangBuka && baris.length > 0} onOpenChange={setKeranjangBuka}>
        <SheetContent side="bottom" className="mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col gap-0 p-0">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{t("cart.title")}</SheetTitle>
            <SheetDescription>{t("cart.summary", { count: jumlahBarang })}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <ul className="divide-y">
              {baris.map(({ kunci, row, qty }) => {
                const nama = namaLengkap(row);
                const lebih = stokDilacak && row.stok !== null && qty > row.stok;
                const hb = hasilPerKunci.get(kunci);
                return (
                  <li key={kunci} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-sm font-medium">{row.productName}</p>
                      {row.variantSku ? <p className="truncate text-xs text-muted-foreground">{labelVarian(row)}</p> : null}
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {formatIDR(row.price ?? 0)} × {qty}
                      </p>
                      <p className="text-sm font-semibold tabular-nums">{formatIDR((row.price ?? 0) * qty)}</p>
                      {hb && hb.potonganPromo > 0 ? (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                          {hb.promoName ?? t("promo.lineFallback")} · <span className="whitespace-nowrap tabular-nums">−{formatIDR(hb.potonganPromo)}</span>
                          {hb.gratis > 0 ? ` · ${t("promo.free", { count: hb.gratis })}` : null}
                        </p>
                      ) : null}
                      {lebih ? (
                        <p className="text-xs text-amber-700 dark:text-amber-300">{t("cart.overStock", { stok: row.stok ?? 0 })}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={pending}
                        onClick={() => {
                          // Baris terakhir dihapus: tutup lembar keranjang sungguhan,
                          // supaya ia tidak terbuka sendiri saat barang berikutnya masuk.
                          if (qty === 1 && baris.length === 1) setKeranjangBuka(false);
                          aturQty(row, qty - 1);
                        }}
                        aria-label={qty === 1 ? t("remove", { name: nama }) : t("decrease", { name: nama })}
                      >
                        {qty === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        disabled={pending}
                        onClick={() => aturQty(row, qty + 1)}
                        aria-label={t("add", { name: nama })}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="space-y-1 border-t px-4 py-3">
              <BarisUang label={t("cart.subtotal")} nilai={hasil?.subtotal ?? kotor} />
              {hasil && hasil.potonganBaris > 0 ? <BarisUang label={t("cart.itemPromos")} nilai={hasil.potonganBaris} potongan /> : null}
              {hasil?.member && hasil.member.potongan > 0 ? (
                <BarisUang label={t("cart.memberDiscount", { tingkat: hasil.member.tingkat })} nilai={hasil.member.potongan} potongan />
              ) : null}
              {hasil?.promoNota ? (
                <BarisUang label={t("cart.orderPromo", { name: hasil.promoNota.name })} nilai={hasil.promoNota.potongan} potongan />
              ) : null}
              {hasil && hasil.diskonManual > 0 ? <BarisUang label={t("cart.manualDiscount")} nilai={hasil.diskonManual} potongan /> : null}
            </div>

            {aturanManual.aktif ? (
              <div className="border-t px-4 py-3">
                <IsianDiskonManual aturan={aturanManual} isian={diskonAktif} onUbah={setDiskon} galat={galatIsianDiskon} disabled={pending} />
              </div>
            ) : null}

            <div className="space-y-2 border-t px-4 py-3">
              <h3 className="text-sm font-semibold">{t("pembeli.title")}</h3>
              <IsianPembeli
                pembeli={pembeli}
                onUbah={setPembeli}
                online={online}
                disabled={pending}
                aturanMember={aturanMember}
                daftarKurang={pratinjau?.daftarKurang ?? null}
              />
            </div>
          </div>
          <SheetFooter className="border-t pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <p className="text-xs text-muted-foreground">{t("cart.cashierNote")}</p>
            <BarisUang label={t("cart.total")} nilai={total} kuat />
            {!online ? <p className="text-xs text-muted-foreground">{t("luring.saveOffline")}</p> : null}
            <Button type="button" size="lg" className="w-full" onClick={simpan} disabled={!bisaSimpan}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {pending ? t("saving") : t("save")}
            </Button>
            <KeteranganKirim teks={teksKurang} />
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <SpgVariantSheet
        group={grupVarian}
        qtyOf={qtyOf}
        setQty={aturQty}
        open={varianBuka}
        onOpenChange={setVarianBuka}
        stokDilacak={stokDilacak}
      />
    </div>
  );
}
