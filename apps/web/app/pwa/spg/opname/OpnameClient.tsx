"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, ClipboardCheck, CloudOff, History, ListPlus, Loader2, Minus, Plus, Search, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PemindaiBarcode } from "@/components/spg/PemindaiBarcode";
import { catatOpnameAction } from "@/app/actions/spg-stok";
import { dinamis } from "@/lib/i18n/dinamis";
import { cocokkanKode, kunciBaris } from "@/lib/spg/stok";
import { cn } from "@/lib/utils";
import { umurHitungMs } from "@/lib/spg/opname-acuan";
import { cocokCariButa, type BarisPilihanButa as BarisPilihan } from "./barang-buta";
import { PerluCheckIn } from "../terima/PerluCheckIn";
import { PilihVarian } from "./PilihVarian";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { antreOpname } from "@/lib/pwa/offline/luring-antrean";
import { ikatanKunjungan, kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

/** Kelompok barang yang dirender di hasil pencarian — katalog bisa ribuan varian. */
const BATAS_HASIL = 20;
const QTY_MAKS = 100_000;
/** Satu toast untuk semua hasil pindai: pindai beruntun menggantinya, tidak menumpuk. */
const ID_TOAST_PINDAI = "opname-pindai";

const KODE_GALAT = new Set([
  "FORBIDDEN",
  "NO_ASSIGNED_STORE",
  "NO_ACTIVE_VISIT",
  "VALIDATION",
  "TANPA_BARIS",
  "JUMLAH_TIDAK_VALID",
  "BARANG_TIDAK_DITEMUKAN",
]);

type Saringan = "semua" | "belum";
/**
 * `hitung` teks: "" = belum dihitung, BUKAN nol. Nol adalah hitungan yang sah.
 * `waktu` (ms): kapan hitungan baris ini terakhir diubah — server menilai
 * selisihnya terhadap saldo SAAT ITU, bukan saat opname disimpan.
 */
type BarisHitung = { kunci: string; hitung: string; waktu?: number };
type Kelompok = { itemId: string; nama: string; varian: BarisPilihan[] };

const angka = (s: string) => (s === "" ? null : Number(s));

/** Langganan perubahan sinyal (online/offline) untuk `useSyncExternalStore`. */
function langgananSinyal(berubah: () => void): () => void {
  window.addEventListener("online", berubah);
  window.addEventListener("offline", berubah);
  return () => {
    window.removeEventListener("online", berubah);
    window.removeEventListener("offline", berubah);
  };
}

/**
 * Draf opname di `localStorage` per toko: menghitung satu rak bisa setengah
 * jam, dan HP yang terkunci, layar yang tertutup, atau pindah aplikasi tidak
 * boleh membuang hitungannya. Draf lebih tua dari `UMUR_DRAF_MS` dibuang —
 * barang sudah terjual sejak itu, hitungannya tidak lagi menggambarkan rak.
 * Penyimpanan bisa dilarang (mode privat): setiap akses dibungkus try/catch.
 */
const UMUR_DRAF_MS = 3 * 24 * 60 * 60 * 1000;
const kunciDraf = (storeId: string) => `elorae.spg.opname.${storeId}`;
type Draf = { daftar: BarisHitung[]; catatan: string; waktu: number };

function bacaDraf(storeId: string): Draf | null {
  try {
    const mentah = window.localStorage.getItem(kunciDraf(storeId));
    if (!mentah) return null;
    const d = JSON.parse(mentah) as Partial<Draf>;
    if (!Array.isArray(d.daftar) || typeof d.waktu !== "number" || Date.now() - d.waktu > UMUR_DRAF_MS) {
      window.localStorage.removeItem(kunciDraf(storeId));
      return null;
    }
    const daftar = d.daftar
      .filter((b): b is BarisHitung => !!b && typeof b.kunci === "string" && typeof b.hitung === "string" && /^\d{0,6}$/.test(b.hitung))
      .map((b) => ({ kunci: b.kunci, hitung: b.hitung, ...(typeof b.waktu === "number" && Number.isFinite(b.waktu) ? { waktu: b.waktu } : {}) }));
    return { daftar, catatan: typeof d.catatan === "string" ? d.catatan.slice(0, 500) : "", waktu: d.waktu };
  } catch {
    return null;
  }
}

function tulisDraf(storeId: string, daftar: BarisHitung[], catatan: string) {
  try {
    if (daftar.length === 0 && catatan.trim() === "") window.localStorage.removeItem(kunciDraf(storeId));
    else window.localStorage.setItem(kunciDraf(storeId), JSON.stringify({ daftar, catatan, waktu: Date.now() }));
  } catch {
    // Penyimpanan penuh atau dilarang: hitungan tetap hidup selama layar terbuka.
  }
}

/**
 * Opname toko oleh SPG.
 *
 * Pola hitung cepat: setiap pindai = +1 pada barang itu, jadi SPG cukup
 * memindai setiap potong di rak satu per satu. Angkanya tetap bisa diubah
 * tangan (menghitung tumpukan yang terlipat rapi lebih cepat dengan mata).
 * Hanya baris yang diisi yang dikirim — barang yang tidak dihitung tidak
 * diubah, sehingga opname boleh sebagian (satu rak hari ini, rak lain besok).
 */
export function OpnameClient({
  storeId,
  namaToko,
  sudahCheckIn: sudahCheckInServer,
  kunjunganServer = null,
  opnamePertama,
  pilihan,
}: {
  /** Kunci draf — draf toko lain tidak pernah terbawa. */
  storeId: string;
  namaToko: string;
  sudahCheckIn: boolean;
  /** Kunjungan berjalan di toko ini menurut server (halaman bisa dari cache). */
  kunjunganServer?: { id: string; checkinAtMs: number } | null;
  opnamePertama: boolean;
  pilihan: BarisPilihan[];
}) {
  const t = useTranslations("pwa.spgOpname");
  const td = dinamis(t);
  const tl = useTranslations("pwaLuring.stok");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Check-in tanpa sinyal juga sah untuk opname: hitungannya diantrekan dan
  // saldo sistemnya dinilai server saat terkirim.
  const { kunjungan: lokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const sudahCheckIn = sudahCheckInServer || kunjunganLokalSah(lokal);
  // Satu kunci per opname: dikirim langsung atau dari antrean, server mencatatnya sekali.
  const [kunci, setKunci] = useState(newLocalId);
  // Tanpa sinyal sekarang? Snapshot server `false`: halaman dari cache yang
  // dihidrasi tanpa sinyal tidak berbeda markup-nya dari render server.
  const luring = useSyncExternalStore(langgananSinyal, tanpaSinyal, () => false);
  const [daftar, setDaftar] = useState<BarisHitung[]>([]);
  const [cari, setCari] = useState("");
  const [saring, setSaring] = useState<Saringan>("semua");
  // Barang di lembar varian dipisah dari terbuka/tertutupnya, supaya isinya
  // tidak hilang selagi lembar beranimasi menutup.
  const [lembar, setLembar] = useState<{ itemId: string; terbuka: boolean } | null>(null);
  const [terakhir, setTerakhir] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  // `selisih: null` = tersimpan di HP; selisihnya dihitung server saat terkirim.
  const [hasil, setHasil] = useState<{ dihitung: number; selisih: number | null } | null>(null);
  const bahasa = useLocale() === "en" ? "en-GB" : "id-ID";
  // Draf dibaca setelah mount (server merender daftar kosong). Sebelum itu
  // tidak ada yang ditulis, supaya draf tidak tertimpa daftar kosong.
  const [drafSiap, setDrafSiap] = useState(false);
  const [drafPulih, setDrafPulih] = useState<{ jumlah: number; waktu: string } | null>(null);

  const perKunci = useMemo(() => new Map(pilihan.map((p) => [p.kunci, p])), [pilihan]);

  useEffect(() => {
    // Tanpa check-in katalog tidak dimuat: draf jangan disentuh sama sekali.
    if (!sudahCheckIn) return;
    const draf = bacaDraf(storeId);
    if (draf) {
      // Barang yang sudah tidak ada di katalog dibuang dari draf.
      const sah = draf.daftar.filter((b) => perKunci.has(b.kunci));
      if (sah.length > 0 || draf.catatan.trim() !== "") {
        setDaftar(sah);
        setCatatan(draf.catatan);
        setDrafPulih({
          jumlah: sah.length,
          waktu: new Intl.DateTimeFormat(bahasa, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(draf.waktu),
        });
      }
    }
    setDrafSiap(true);
    // Sekali saat layar dibuka dengan katalog; katalog baru (router.refresh) tidak memulihkan ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, sudahCheckIn]);

  useEffect(() => {
    if (drafSiap) tulisDraf(storeId, daftar, catatan);
  }, [drafSiap, storeId, daftar, catatan]);

  const buangDraf = () => {
    setDaftar([]);
    setCatatan("");
    setTerakhir(null);
    setSaring("semua");
    setDrafPulih(null);
  };
  const perItem = useMemo(() => {
    const m = new Map<string, Kelompok>();
    for (const p of pilihan) {
      const g = m.get(p.itemId) ?? { itemId: p.itemId, nama: p.nama, varian: [] };
      g.varian.push(p);
      m.set(p.itemId, g);
    }
    return m;
  }, [pilihan]);
  const katalogKode = useMemo(
    () => pilihan.map((p) => ({ itemId: p.itemId, sku: p.sku, variantSku: p.variantSku, barcode: p.barcode })),
    [pilihan],
  );
  const jumlahDilacak = useMemo(() => pilihan.filter((p) => p.dilacak).length, [pilihan]);
  const hitungan = useMemo(() => new Map(daftar.map((b) => [b.kunci, b.hitung])), [daftar]);

  const hasilCari = useMemo(() => {
    const q = cari.trim();
    if (!q) return { kelompok: [] as Kelompok[], total: 0 };
    const cocok = [...perItem.values()].filter((g) => g.varian.some((v) => cocokCariButa(v, q)));
    return { kelompok: cocok.slice(0, BATAS_HASIL), total: cocok.length };
  }, [cari, perItem]);

  const labelBarang = (p: BarisPilihan) => (p.varian ? `${p.nama} — ${p.varian}` : p.nama);

  /** +1 pada satu barang; barang baru masuk di ATAS daftar supaya terlihat. */
  const tambahSatu = (p: BarisPilihan) => {
    setDaftar((lama) => {
      const i = lama.findIndex((b) => b.kunci === p.kunci);
      if (i < 0) return [{ kunci: p.kunci, hitung: "1", waktu: Date.now() }, ...lama];
      const baru = [...lama];
      baru[i] = { ...lama[i], hitung: String(Math.min(QTY_MAKS, (angka(lama[i].hitung) ?? 0) + 1)), waktu: Date.now() };
      return baru;
    });
    setTerakhir(p.kunci);
  };

  const ubahHitung = (kunci: string, hitung: string) =>
    setDaftar((lama) => lama.map((b) => (b.kunci === kunci ? { ...b, hitung, waktu: Date.now() } : b)));
  const hapus = (kunci: string) => setDaftar((lama) => lama.filter((b) => b.kunci !== kunci));

  const pilihKelompok = (g: Kelompok) => {
    if (g.varian.length === 1) {
      tambahSatu(g.varian[0]);
      toast.success(t("scan.added", { name: labelBarang(g.varian[0]) }), { id: ID_TOAST_PINDAI, duration: 1500 });
      return;
    }
    setLembar({ itemId: g.itemId, terbuka: true });
  };

  const onKode = (kode: string): void | "tutup" => {
    const h = cocokkanKode(kode, katalogKode);
    if (!h) {
      toast.error(t("scan.unknown", { code: kode }), { id: ID_TOAST_PINDAI });
      return;
    }
    if (h.jenis === "barang") {
      // Kode induk: ukurannya harus dipilih di lembar varian, yang akan
      // tertutup kamera penuh layar — jadi kameranya ditutup.
      setLembar({ itemId: h.itemId, terbuka: true });
      return "tutup";
    }
    const p = perKunci.get(kunciBaris(h.itemId, h.variantSku));
    if (!p) {
      toast.error(t("scan.unknown", { code: kode }), { id: ID_TOAST_PINDAI });
      return;
    }
    tambahSatu(p);
    toast.success(t("scan.added", { name: labelBarang(p) }), { id: ID_TOAST_PINDAI, duration: 1500 });
  };

  const muatSemua = () => {
    const ada = new Set(daftar.map((b) => b.kunci));
    const baru = pilihan.filter((p) => p.dilacak && !ada.has(p.kunci)).map((p) => ({ kunci: p.kunci, hitung: "" }));
    setDaftar((lama) => [...lama, ...baru]);
    toast.success(t("loadAllDone", { count: baru.length }));
  };

  // Ringkasan daftar hitung. Hitungan buta: tidak ada angka sistem di layar
  // ini, jadi juga tidak ada "berselisih" — selisih dinilai server saat disimpan.
  const ringkas = useMemo(() => {
    const dihitung = daftar.filter((b) => angka(b.hitung) !== null).length;
    return { dihitung, belum: daftar.length - dihitung };
  }, [daftar]);

  const tampil = useMemo(
    () => (saring === "belum" ? daftar.filter((b) => angka(b.hitung) === null) : daftar),
    [daftar, saring],
  );

  const kosongkanSesudahSimpan = () => {
    // Opname tercatat (di server atau di HP): drafnya dihapus sekarang juga,
    // bukan menunggu efek, dan opname berikutnya memakai kunci baru.
    tulisDraf(storeId, [], "");
    setKunci(newLocalId());
    setDrafPulih(null);
    setDaftar([]);
    setCatatan("");
    setCari("");
    setSaring("semua");
    setTerakhir(null);
  };

  const simpan = () => {
    // Satu jam untuk umur hitungan DAN waktu antrean: kiriman daring yang
    // kehabisan waktu lalu jatuh ke antrean tidak boleh menggeser waktu hitung.
    const sekarang = Date.now();
    const baris = daftar
      .filter((b) => b.hitung !== "")
      .map((b) => {
        const p = perKunci.get(b.kunci);
        const umur = umurHitungMs(b.waktu, sekarang);
        return p
          ? {
              itemId: p.itemId,
              variantSku: p.variantSku,
              qtyCounted: Number(b.hitung),
              productName: labelBarang(p),
              ...(umur === undefined ? {} : { umurHitungMs: umur }),
            }
          : null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    const ikatan = ikatanKunjungan(kunjunganServer, lokal);
    /**
     * Ke antrean HP: tanpa sinyal, jawaban tidak datang, atau check-in-nya
     * sendiri masih di HP. Saldo sistem di layar ini TIDAK dikirim — server
     * menilainya saat terkirim, per waktu hitung ini.
     */
    const simpanDiHp = async (ik: { visitId: string | null; visitClientId: string | null }) => {
      try {
        await antreOpname({
          localId: kunci,
          storeId,
          waktu: sekarang,
          visitId: ik.visitId,
          visitClientId: ik.visitClientId,
          baris,
          note: catatan.trim() || null,
        });
      } catch {
        toast.error(tl("gagalSimpan"));
        return;
      }
      setKonfirmasi(false);
      setHasil({ dihitung: baris.length, selisih: null });
      kosongkanSesudahSimpan();
    };
    startTransition(async () => {
      if (!ikatan || tanpaSinyal() || ikatan.visitClientId) {
        if (ikatan) await simpanDiHp(ikatan);
        else toast.error(td("err.NO_ACTIVE_VISIT"));
        return;
      }
      let res: Awaited<ReturnType<typeof catatOpnameAction>>;
      try {
        res = await denganBatasWaktu(
          catatOpnameAction({
            baris: baris.map((b) => ({
              itemId: b.itemId,
              variantSku: b.variantSku,
              qtyCounted: b.qtyCounted,
              ...(b.umurHitungMs === undefined ? {} : { umurHitungMs: b.umurHitungMs }),
            })),
            note: catatan.trim() || undefined,
            idempotencyKey: kunci,
          }),
        );
      } catch {
        // Sinyal putus / tidak ada jawaban: antrekan dengan kunci yang sama.
        await simpanDiHp(ikatan);
        return;
      }
      setKonfirmasi(false);
      if (!res.ok) {
        toast.error(td(KODE_GALAT.has(res.code) ? `err.${res.code}` : "err.GENERIC"));
        return;
      }
      setHasil({ dihitung: baris.length, selisih: res.selisih });
      kosongkanSesudahSimpan();
      // Saldo "sistem" di layar ini kini usang — muat ulang dari server.
      router.refresh();
    });
  };

  const varianLembar = lembar ? (perItem.get(lembar.itemId)?.varian ?? []) : [];

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa/spg/stok" />
      </Button>
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      {!sudahCheckIn ? (
        <PerluCheckIn judul={t("checkIn.title")} isi={t("checkIn.body")} tombol={t("checkIn.cta")} />
      ) : hasil ? (
        <section className="beranda-kartu space-y-3" role="status">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              {hasil.selisih === null ? <CloudOff className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            </span>
            {hasil.selisih === null ? (
              // Tersimpan di HP: selisihnya belum diketahui — server yang menghitungnya saat terkirim.
              <div className="min-w-0">
                <h2 className="font-semibold leading-tight">{tl("tersimpanOpnameJudul")}</h2>
                <p className="text-sm text-muted-foreground">{tl("tersimpanOpnameIsi", { count: hasil.dihitung })}</p>
              </div>
            ) : (
              <div className="min-w-0">
                <h2 className="font-semibold leading-tight">{t("done.title")}</h2>
                <p className="text-sm text-muted-foreground">{t("done.counted", { count: hasil.dihitung })}</p>
                <p className="text-sm text-muted-foreground">
                  {hasil.selisih > 0 ? t("done.diff", { count: hasil.selisih }) : t("done.noDiff")}
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Button asChild>
              <Link href="/pwa/spg/stok">{t("done.seeStock")}</Link>
            </Button>
            <Button type="button" variant="outline" onClick={() => setHasil(null)}>
              {t("done.again")}
            </Button>
          </div>
        </section>
      ) : (
        <>
          {drafPulih ? (
            <section className="beranda-kartu flex items-start gap-3" role="status">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <History className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <h2 className="font-semibold leading-tight">{t("draft.title")}</h2>
                  <p className="text-sm text-muted-foreground">{t("draft.body", { count: drafPulih.jumlah, time: drafPulih.waktu })}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={buangDraf} disabled={pending}>
                  {t("draft.discard")}
                </Button>
              </div>
            </section>
          ) : null}

          <section className="space-y-2" aria-labelledby="judul-tambah">
            <h2 id="judul-tambah" className="beranda-judul px-1">
              {t("addTitle")}
            </h2>
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
            {cari.trim() ? (
              <div className="beranda-kartu beranda-kartu-daftar">
                {hasilCari.kelompok.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noMatch")}</p>
                ) : (
                  <ul className="divide-y">
                    {hasilCari.kelompok.map((g) => {
                      const satu = g.varian.length === 1 ? g.varian[0] : null;
                      return (
                        <li key={g.itemId}>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => pilihKelompok(g)}
                            className="h-auto min-h-14 w-full justify-start gap-3 rounded-none px-4 py-2 text-left whitespace-normal"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium leading-tight">{g.nama}</span>
                              <span className="block truncate text-xs font-normal text-muted-foreground">
                                {satu
                                  ? [satu.varian, satu.kode].filter(Boolean).join(" · ")
                                  : t("variantCount", { count: g.varian.length })}
                              </span>
                            </span>
                            <span
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                              aria-hidden
                            >
                              <Plus className="h-4 w-4" />
                            </span>
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
            {hasilCari.total > hasilCari.kelompok.length ? (
              <p className="px-1 text-xs text-muted-foreground">
                {t("moreResults", { shown: hasilCari.kelompok.length, total: hasilCari.total })}
              </p>
            ) : null}
            {jumlahDilacak > 0 ? (
              <Button type="button" variant="outline" className="w-full" onClick={muatSemua} disabled={pending}>
                <ListPlus className="h-4 w-4" aria-hidden />
                {t("loadAll", { count: jumlahDilacak })}
              </Button>
            ) : null}
          </section>

          <section className="space-y-2" aria-labelledby="judul-hitung">
            <h2 id="judul-hitung" className="beranda-judul px-1">
              {t("listTitle", { count: daftar.length })}
            </h2>
            {/* Hitungan buta: stok sistem tidak ditampilkan sampai opname disimpan. */}
            <p className="px-1 text-xs text-muted-foreground">{t("blind")}</p>

            {daftar.length === 0 ? (
              <p className="beranda-kartu text-sm text-muted-foreground">{t("listEmpty")}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("filterLabel")}>
                  {(
                    [
                      ["semua", t("filterAll", { count: daftar.length })],
                      ["belum", t("filterUncounted", { count: ringkas.belum })],
                    ] as const
                  ).map(([nilai, label]) => (
                    <Button
                      key={nilai}
                      type="button"
                      size="sm"
                      variant={saring === nilai ? "default" : "outline"}
                      aria-pressed={saring === nilai}
                      onClick={() => setSaring(nilai)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>

                <div className="beranda-kartu beranda-kartu-daftar">
                  {tampil.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("filterEmpty")}</p>
                  ) : (
                    <ul className="divide-y">
                      {tampil.map((b) => {
                        const p = perKunci.get(b.kunci);
                        if (!p) return null;
                        const n = angka(b.hitung);
                        return (
                          <li
                            key={b.kunci}
                            className={cn("space-y-2 px-4 py-3 transition-colors", terakhir === b.kunci && "bg-primary/10")}
                          >
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium leading-tight">{p.nama}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {[p.varian, p.kode].filter(Boolean).join(" · ")}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => hapus(b.kunci)}
                                disabled={pending}
                                aria-label={t("remove", { name: labelBarang(p) })}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1 text-xs">
                                {n === null ? <span className="block text-muted-foreground">{t("uncounted")}</span> : null}
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => ubahHitung(b.kunci, String(Math.max(0, (n ?? 0) - 1)))}
                                disabled={pending || n === null || n <= 0}
                                aria-label={t("decrease", { name: labelBarang(p) })}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <Input
                                value={b.hitung}
                                onChange={(e) => ubahHitung(b.kunci, e.target.value.replace(/\D/g, "").slice(0, 6))}
                                inputMode="numeric"
                                placeholder="—"
                                aria-label={t("countFor", { name: labelBarang(p) })}
                                disabled={pending}
                                className="w-20 text-center tabular-nums"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => ubahHitung(b.kunci, String(Math.min(QTY_MAKS, (n ?? 0) + 1)))}
                                disabled={pending || (n !== null && n >= QTY_MAKS)}
                                aria-label={t("increase", { name: labelBarang(p) })}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>

          <div className="space-y-2">
            <Label htmlFor="opname-catatan">{t("noteLabel")}</Label>
            <Textarea
              id="opname-catatan"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value.slice(0, 500))}
              placeholder={t("notePlaceholder")}
              rows={2}
              disabled={pending}
            />
          </div>

          <div className="space-y-1.5">
            <Button
              className="w-full"
              size="lg"
              disabled={ringkas.dihitung === 0 || pending}
              onClick={() => setKonfirmasi(true)}
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              {t("save", { count: ringkas.dihitung })}
            </Button>
            <p className="text-center text-xs text-muted-foreground" aria-live="polite">
              {ringkas.belum > 0 ? t("saveHintSkipped", { count: ringkas.belum }) : t("saveHint")}
            </p>
            {/* Tanpa sinyal (atau check-in yang masih di HP): selisih yang dicatat
                dihitung server saat terkirim. */}
            {luring || lokal?.keadaan === "antre" ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{tl("catatanLuring")}</span>
              </p>
            ) : null}
          </div>

          <PilihVarian
            terbuka={!!lembar?.terbuka && varianLembar.length > 0}
            varian={varianLembar}
            hitungan={hitungan}
            onTambah={tambahSatu}
            onTutup={() => setLembar((l) => (l ? { ...l, terbuka: false } : l))}
          />

          <AlertDialog open={konfirmasi} onOpenChange={(o) => !pending && setKonfirmasi(o)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("confirm.title")}</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>{t("confirm.body", { count: ringkas.dihitung })}</p>
                    {ringkas.belum > 0 ? <p>{t("confirm.skipped", { count: ringkas.belum })}</p> : null}
                    <p>{opnamePertama ? t("intro.first") : t("confirm.untouched")}</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>{t("confirm.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    // Dialog tetap terbuka selama menyimpan; ditutup oleh hasilnya.
                    e.preventDefault();
                    simpan();
                  }}
                  disabled={pending}
                >
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {pending ? t("confirm.saving") : t("confirm.ok")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
