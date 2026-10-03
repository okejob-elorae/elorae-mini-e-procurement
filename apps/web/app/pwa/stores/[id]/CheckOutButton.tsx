"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Camera, CloudOff, Loader2 } from "lucide-react";
import { bacaSyaratCheckOut, checkOut, type CheckOutHasil, type SyaratCheckOut } from "../actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ALASAN_TANPA_TRANSAKSI,
  ALASAN_WAJIB_CATATAN,
  CATATAN_HASIL_MAKS,
  adaTransaksiDiAntrean,
  type AlasanTanpaTransaksi,
} from "@/lib/salesman/hasil-kunjungan";
import { pwaDb } from "@/lib/pwa/offline/db";
import { listPendingPhotosForKunjungan } from "@/lib/pwa/offline/photo-queue";
import { catatFotoTerkirim, fotoTerkirimDiHp } from "@/lib/pwa/offline/foto-kunjungan";
import { cn } from "@/lib/utils";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { antreCheckout } from "@/lib/pwa/offline/luring-antrean";
import {
  adaTransaksiDiHp,
  aturanKunjunganDiHp,
  bacaCatatanTerkirim,
  checkoutTertahanUntuk,
  KUNCI_KUNJUNGAN_TERKIRIM,
  lupakanKunjunganTerkirim,
  simpanAturanKunjungan,
} from "@/lib/pwa/offline/luring-kunjungan";
import { denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";

type Tahap = "diam" | "memeriksa" | "lokasi" | "mengirim";
type Koordinat = { lat: number; lng: number };

/**
 * Isi antrean HP yang menyangkut kunjungan ini — hanya DIBACA. Foto yang belum
 * terkirim dan transaksi yang belum sampai ke server tidak terlihat oleh
 * server, jadi hanya HP yang bisa menghitungnya.
 */
async function bacaAntreanHp(visitId: string, storeId: string, sejakMs: number): Promise<{ foto: number; transaksi: boolean }> {
  try {
    const [foto, pesanan, klaim, retur] = await Promise.all([
      // Termasuk foto yang diantrekan selagi check-in kunjungan ini masih di HP.
      listPendingPhotosForKunjungan({ visitId }),
      pwaDb.pendingOrders.where("storeId").equals(storeId).toArray(),
      pwaDb.pendingClaims.toArray(),
      pwaDb.pendingReturns.toArray(),
    ]);
    return { foto: foto.length, transaksi: adaTransaksiDiAntrean({ pesanan, klaim, retur }, { visitId, storeId, sejakMs }) };
  } catch {
    // Penyimpanan HP tidak terbaca (mode privat, dsb.): anggap kosong — server tetap menjaga alasan.
    return { foto: 0, transaksi: false };
  }
}

/** Aturan bawaan bila HP belum pernah menyimpan aturan orang ini (`aturanKunjunganSaya`). */
const ATURAN_TANPA_CATATAN = { spg: false, alasanWajib: true, fotoWajib: false };

/** Kunjungan berjalan di HP yang baru saja check-out dengan sinyal tidak lagi berjalan. */
function lupakanBilaKunjungan(visitId: string | null) {
  try {
    const t = bacaCatatanTerkirim(window.localStorage.getItem(KUNCI_KUNJUNGAN_TERKIRIM));
    if (t && visitId && t.visitId === visitId) lupakanKunjunganTerkirim();
  } catch {
    // Tidak terbaca: catatan itu kedaluwarsa sendiri.
  }
}

function ambilLokasi(): Promise<Koordinat> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

/**
 * Tombol check-out — dipakai di halaman toko, kartu kunjungan aktif di beranda
 * salesman, dan beranda SPG. Server yang tahu siapa SPG: untuk SPG syaratnya
 * selalu kosong, jadi alurnya sama seperti dulu (ambil lokasi → check-out).
 *
 * Untuk salesman: sebelum mengambil lokasi, HP bertanya ke server apakah
 * kunjungan ini sudah punya transaksi. Kalau belum dan pemilik mewajibkan
 * alasan, lembar "Kenapa tidak ada transaksi?" dibuka lebih dulu. Aturan "wajib
 * foto" dijaga DI SINI saja — server tidak bisa melihat foto yang masih di
 * antrean HP (tanpa sinyal), jadi hanya HP yang bisa menghitungnya dengan benar.
 */
export function CheckOutButton({
  visitId,
  visitClientId = null,
  storeId = null,
  storeName = null,
  sejakMs = null,
}: {
  /** Kunjungan server. `null` untuk kunjungan yang check-in-nya masih di antrean HP. */
  visitId: string | null;
  /**
   * Check-in yang dicatat TANPA sinyal dan belum sampai (id buatan HP). Check-out
   * kunjungan seperti ini selalu diantrekan — server belum mengenal kunjungannya.
   */
  visitClientId?: string | null;
  /** Toko kunjungan — untuk mencari transaksi yang masih di HP saat tanpa sinyal. */
  storeId?: string | null;
  storeName?: string | null;
  /** Waktu check-in (ms), bila diketahui — batas bawah transaksi toko di HP. */
  sejakMs?: number | null;
}) {
  const t = useTranslations("pwa.checkIn");
  const th = useTranslations("pwa.hasilKunjungan");
  const tl = useTranslations("pwaLuring.checkOut");
  const router = useRouter();
  const pathname = usePathname();
  const [tahap, setTahap] = useState<Tahap>("diam");
  // Check-out kunjungan ini sudah tersimpan di HP (tanpa sinyal) — jangan tawarkan tombolnya lagi.
  const [menunggu, setMenunggu] = useState(false);
  // Lembar alasan dibuka untuk check-out tanpa sinyal: kirimnya ke antrean.
  const [modeLuring, setModeLuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fotoKurangDi, setFotoKurangDi] = useState<string | null>(null);
  const [lembar, setLembar] = useState(false);
  const [alasan, setAlasan] = useState<AlasanTanpaTransaksi | null>(null);
  const [catatan, setCatatan] = useState("");
  const [galatLembar, setGalatLembar] = useState<string | null>(null);
  // Lokasi yang sudah diambil disimpan bila server baru meminta alasan
  // sesudahnya — supaya salesman tidak menunggu GPS dua kali.
  const koordinatRef = useRef<Koordinat | null>(null);
  const tertundaRef = useRef(false);
  const busy = tahap !== "diam";

  useEffect(() => {
    let hidup = true;
    const muat = () => {
      void checkoutTertahanUntuk(visitId, visitClientId).then((ada) => {
        if (hidup) setMenunggu(ada);
      });
    };
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
    };
  }, [visitId, visitClientId]);

  function selesai() {
    router.push("/pwa");
    router.refresh();
  }

  /**
   * Check-out ke antrean HP: tanpa sinyal, jawaban server tidak datang, atau
   * kunjungannya sendiri belum sampai ke server. Waktu dan lokasinya waktu HP;
   * server menilai hasil kunjungan saat terkirim (sesudah transaksinya sampai).
   */
  async function kirimLuring(alasanPilihan: AlasanTanpaTransaksi | null, catatanIsi: string | null) {
    let koordinat = koordinatRef.current;
    if (!koordinat) {
      setTahap("lokasi");
      try {
        koordinat = await ambilLokasi();
      } catch {
        setTahap("diam");
        if (lembar) setGalatLembar(t("coordsError"));
        else setError(t("coordsError"));
        return;
      }
    }
    setTahap("mengirim");
    try {
      await antreCheckout({
        localId: newLocalId(),
        storeId: storeId ?? "",
        storeName,
        visitId: visitClientId ? null : visitId,
        visitClientId,
        waktu: Date.now(),
        lat: koordinat.lat,
        lng: koordinat.lng,
        outcome: alasanPilihan,
        outcomeNote: catatanIsi,
        transaksiTertunda: tertundaRef.current,
      });
    } catch {
      setTahap("diam");
      if (lembar) setGalatLembar(tl("gagalSimpan"));
      else setError(tl("gagalSimpan"));
      return;
    }
    setTahap("diam");
    setLembar(false);
    setMenunggu(true);
    toast.success(tl("tersimpanToast"));
    // Kunjungan server: kembali ke beranda seperti check-out biasa. Kunjungan
    // dari HP: kartunya hilang sendiri dari halaman ini.
    if (!visitClientId) selesai();
  }

  /**
   * Check-out tanpa sinyal, dengan aturan orang ini yang disimpan HP saat ada
   * sinyal:
   * - wajib foto: foto yang HP tahu sudah sampai ke server (`foto-kunjungan.ts`)
   *   ditambah foto kunjungan ini yang masih di antrean harus ada paling tidak
   *   satu. Yang tidak diketahui dihitung nol — mengambil satu foto lagi (yang
   *   ikut antrean) selalu memenuhi aturan.
   * - alasan tanpa transaksi: ditanyakan bila diwajibkan dan HP tidak melihat
   *   transaksi kunjungan ini di antreannya.
   */
  async function mulaiLuring() {
    setModeLuring(true);
    const aturan = aturanKunjunganDiHp() ?? ATURAN_TANPA_CATATAN;
    if (!aturan.spg && aturan.fotoWajib) {
      let antre = 0;
      try {
        antre = (await listPendingPhotosForKunjungan({ visitId, visitClientId })).length;
      } catch {
        antre = 0;
      }
      if (fotoTerkirimDiHp(visitId) + antre === 0) {
        setFotoKurangDi(storeId ?? "");
        setTahap("diam");
        return;
      }
    }
    const transaksi = await adaTransaksiDiHp({ visitId, visitClientId, storeId, sejakMs });
    tertundaRef.current = transaksi;
    if (!aturan.spg && aturan.alasanWajib && !transaksi) {
      setTahap("diam");
      bukaLembar();
      return;
    }
    await kirimLuring(null, null);
  }

  function bukaLembar() {
    setGalatLembar(null);
    setLembar(true);
  }

  async function kirim(alasanPilihan: AlasanTanpaTransaksi | null, catatanIsi: string | null) {
    let koordinat = koordinatRef.current;
    if (!koordinat) {
      setTahap("lokasi");
      try {
        koordinat = await ambilLokasi();
      } catch {
        setTahap("diam");
        if (lembar) setGalatLembar(t("coordsError"));
        else setError(t("coordsError"));
        return;
      }
    }

    if (!visitId) return;
    setTahap("mengirim");
    let hasil: CheckOutHasil;
    try {
      hasil = await denganBatasWaktu(
        checkOut({
          visitId,
          lat: koordinat.lat,
          lng: koordinat.lng,
          outcome: alasanPilihan,
          outcomeNote: catatanIsi,
          transaksiTertunda: tertundaRef.current,
        }),
      );
    } catch {
      // Sinyal putus atau jawaban tidak datang: check-out yang sama diantrekan
      // (lokasi dan alasannya sudah ada). Kalau ternyata sudah sampai, kiriman
      // antrean hanya mendapati kunjungannya sudah ditutup.
      koordinatRef.current = koordinat;
      await kirimLuring(alasanPilihan, catatanIsi);
      return;
    }

    if ("ok" in hasil) {
      setTahap("diam");
      if (hasil.code === "HASIL_WAJIB" || hasil.code === "CATATAN_WAJIB" || hasil.code === "HASIL_TIDAK_SAH") {
        koordinatRef.current = koordinat;
        bukaLembar();
        if (hasil.code === "CATATAN_WAJIB") setGalatLembar(th("catatanWajib"));
        else if (hasil.code === "HASIL_TIDAK_SAH") setGalatLembar(th("pilihAlasan"));
        return;
      }
      setError(th("gagalKirim"));
      return;
    }

    setLembar(false);
    lupakanBilaKunjungan(visitId);
    selesai();
  }

  async function mulai() {
    setError(null);
    setFotoKurangDi(null);
    setModeLuring(false);
    koordinatRef.current = null;
    tertundaRef.current = false;
    setTahap("memeriksa");

    // Kunjungan yang check-in-nya masih di HP, atau tanpa sinyal sama sekali:
    // langsung ke antrean — server tidak bisa ditanya.
    if (visitClientId || !visitId || tanpaSinyal()) {
      await mulaiLuring();
      return;
    }

    let syarat: SyaratCheckOut | null = null;
    try {
      syarat = await denganBatasWaktu(bacaSyaratCheckOut(visitId));
    } catch {
      // Jawaban tidak datang (sinyal putus di tengah jalan): check-out tanpa sinyal.
      await mulaiLuring();
      return;
    }

    if (syarat?.ok && syarat.selesai) {
      lupakanBilaKunjungan(visitId);
      selesai();
      return;
    }

    // Aturan orang ini disimpan di HP: check-out berikutnya yang tanpa sinyal memakainya.
    if (syarat?.ok && !syarat.selesai) {
      simpanAturanKunjungan({ spg: syarat.spg, alasanWajib: syarat.alasanWajib, fotoWajib: syarat.fotoWajib });
      catatFotoTerkirim(visitId, syarat.fotoTerkirim);
    }

    if (syarat?.ok && !syarat.selesai && !syarat.spg) {
      const antre = await bacaAntreanHp(visitId, syarat.storeId, syarat.checkinAtMs);
      if (syarat.fotoWajib && syarat.fotoTerkirim + antre.foto === 0) {
        setFotoKurangDi(syarat.storeId);
        setTahap("diam");
        return;
      }
      tertundaRef.current = syarat.perluAlasan && antre.transaksi;
      if (syarat.perluAlasan && syarat.alasanWajib && !tertundaRef.current) {
        setTahap("diam");
        bukaLembar();
        return;
      }
    }

    await kirim(null, null);
  }

  const wajibCatatan = alasan !== null && ALASAN_WAJIB_CATATAN.includes(alasan);
  const bolehKirim = alasan !== null && (!wajibCatatan || catatan.trim() !== "");
  const labelSibuk =
    tahap === "memeriksa" ? th("memeriksa") : tahap === "lokasi" ? t("locating") : t("submitting");
  const halamanToko = fotoKurangDi ? `/pwa/stores/${fotoKurangDi}` : null;

  if (menunggu && tahap === "diam") {
    return (
      <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{tl("menunggu")}</span>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        // Bukan merah: check-out adalah langkah biasa di akhir kunjungan, bukan
        // tindakan berbahaya. Garis tebal supaya tetap mudah ditemukan.
        variant="outline"
        onClick={() => void mulai()}
        disabled={busy}
        className="w-full border-2 border-foreground/70 py-3 text-lg font-medium"
      >
        {busy && !lembar ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {labelSibuk}
          </>
        ) : (
          t("checkOutButton")
        )}
      </Button>
      {error && (
        <div className="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
          <span>{error}</span>
          <Button type="button" variant="link" size="sm" onClick={() => void mulai()} disabled={busy}>
            {t("coordsRetry")}
          </Button>
        </div>
      )}
      {fotoKurangDi !== null && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-start gap-2 text-amber-800 dark:text-amber-300">
            <Camera className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("fotoWajib")}</span>
          </p>
          {halamanToko && pathname !== halamanToko && (
            <Button asChild variant="outline" className="w-full">
              <Link href={halamanToko}>{t("fotoWajibBuka")}</Link>
            </Button>
          )}
        </div>
      )}

      <Sheet
        open={lembar}
        onOpenChange={(buka) => {
          if (!busy) setLembar(buka);
        }}
      >
        <SheetContent side="bottom" className="mx-auto flex max-h-[90dvh] w-full max-w-xl flex-col gap-0 p-0">
          <SheetHeader className="border-b pb-3">
            <SheetTitle>{th("judul")}</SheetTitle>
            <SheetDescription>{th("penjelasan")}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 overflow-y-auto p-4">
            {modeLuring ? (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
                <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{tl("lembarLuring")}</span>
              </p>
            ) : null}
            <div role="radiogroup" aria-label={th("judul")} className="grid grid-cols-2 gap-2">
              {ALASAN_TANPA_TRANSAKSI.map((a) => (
                <Button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={alasan === a}
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setAlasan(a);
                    setGalatLembar(null);
                  }}
                  className={cn(
                    "h-auto min-h-14 justify-start whitespace-normal py-3 text-left text-sm",
                    a === "LAINNYA" && "col-span-2",
                    alasan === a && "border-primary bg-primary/10 font-semibold ring-1 ring-primary",
                  )}
                >
                  {th(`kode.${a}`)}
                </Button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`catatan-hasil-${visitId}`}>
                {wajibCatatan ? th("catatanLabelWajib") : th("catatanLabel")}
              </Label>
              <Textarea
                id={`catatan-hasil-${visitId}`}
                rows={3}
                maxLength={CATATAN_HASIL_MAKS}
                value={catatan}
                disabled={busy}
                placeholder={th("catatanContoh")}
                onChange={(e) => setCatatan(e.target.value)}
              />
            </div>

            {galatLembar && <p className="text-sm text-destructive">{galatLembar}</p>}
          </div>

          <SheetFooter className="border-t pt-3">
            <Button
              type="button"
              variant="destructive"
              className="h-12 w-full text-base"
              disabled={!bolehKirim || busy}
              onClick={() => {
                const isiCatatan = catatan.trim() === "" ? null : catatan.trim();
                void (modeLuring ? kirimLuring(alasan, isiCatatan) : kirim(alasan, isiCatatan));
              }}
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  {labelSibuk}
                </>
              ) : (
                th("kirim")
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
