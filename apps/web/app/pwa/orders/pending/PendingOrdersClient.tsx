"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, RotateCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listPendingOrders, deletePendingOrder, retryPendingOrder } from "@/lib/pwa/offline/queue";
import { flushPendingOrders, kirimSemuaAntrean, setupOrderSync } from "@/lib/pwa/offline/sync";
import { AntreanLuring } from "@/app/pwa/spg/antrean/AntreanLuring";
import { flushLaporanTertahan } from "@/lib/pwa/offline/laporan-sync";
import { deletePendingPhoto, listPendingPhotos, retryPendingPhoto } from "@/lib/pwa/offline/photo-queue";
import { flushPendingPhotos } from "@/lib/pwa/offline/photo-sync";
import {
  daftarJanjiTertahan,
  daftarKlaimTertahan,
  daftarReturTertahan,
  hapusJanjiTertahan,
  hapusKlaimTertahan,
  hapusReturTertahan,
  ulangJanjiTertahan,
  ulangKlaimTertahan,
  ulangReturTertahan,
} from "@/lib/pwa/offline/laporan-queue";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import type { PendingClaim, PendingOrder, PendingPhoto, PendingPromise, PendingReturn } from "@/lib/pwa/offline/db";
import type { PendingBuktiTerima } from "@/lib/pwa/offline/db";
import {
  daftarBuktiTerimaTertahan,
  hapusBuktiTerimaTertahan,
  ulangBuktiTerimaTertahan,
} from "@/lib/pwa/offline/bukti-terima-queue";
import { flushBuktiTerimaTertahan } from "@/lib/pwa/offline/bukti-terima-sync";
import { letakAlasanBuktiTerima } from "@/lib/pwa/offline/bukti-terima-classify";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatDisplayDateTime } from "@/lib/date-only";
import { formatIDR } from "@/lib/sales-orders/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

function errorLabel(code: string | undefined, t: (key: string) => string): string {
  switch (code) {
    case "MIN_QTY":
      return t("errMinQty");
    case "NO_ACTIVE_VISIT":
      return t("errNoVisit");
    case "UNAUTHORIZED":
      return t("errUnauthorized");
    case "KREDIT_DIBLOKIR":
      return t("errKreditDiblokir");
    case "JARAK_JAUH_NONAKTIF":
      return t("errJarakJauhNonaktif");
    case "BUKAN_TOKO_SENDIRI":
      return t("errBukanTokoSendiri");
    case "INDEN_DITOLAK":
      return t("errInden");
    case "PESANAN_LAMA_TIDAK_BISA_DIGANTI":
      return t("errGantiDitolak");
    case "KUNJUNGAN_DITOLAK":
      return t("errKunjunganDitolak");
    case "KUNJUNGAN_TIDAK_SAH":
      return t("errKunjunganTidakSah");
    default:
      return t("errGeneric");
  }
}

/** Alasan foto ditolak. Antrean foto menyimpan status HTTP unggahannya (`photo-sync.ts`). */
function alasanFoto(galat: string | undefined, t: (key: string) => string): string {
  switch (galat) {
    case "HTTP 400":
      return t("photoErrFile");
    case "HTTP 401":
      return t("errUnauthorized");
    case "HTTP 403":
      return t("photoErrForbidden");
    case "HTTP 404":
      return t("photoErrVisit");
    case "KUNJUNGAN_DITOLAK":
      return t("photoErrKunjunganDitolak");
    default:
      return t("errGeneric");
  }
}

type Keadaan = "pending" | "syncing" | "failed";

/** Nama toko dan waktu kunjungan untuk foto tertahan, dari server (id kunjungan → isi). */
export type NamaKunjungan = { storeId: string; toko: string; checkinAt: string };

type FotoTampil = { baris: PendingPhoto; url: string };

/**
 * Semua yang masih tertahan di HP: pesanan, foto kunjungan, laporan pelunasan,
 * nota retur.
 *
 * Satu layar, bukan empat — pertanyaan salesman satu: "apa yang belum sampai
 * ke kantor?". Yang gagal karena isinya ditolak menunjukkan alasannya; yang
 * menunggu sinyal terkirim sendiri, tombol Coba lagi hanya mempercepatnya.
 *
 * Tanggal di layar ini diformat di klien dengan sengaja: isinya berasal dari
 * basis data HP (IndexedDB) dan baru tampil sesudah dimuat, jadi tidak pernah
 * dirender server — tidak ada hidrasi yang bisa berbeda.
 */
export function PendingOrdersClient({ kunjungan }: { kunjungan: Record<string, NamaKunjungan> }) {
  const t = useTranslations("pwa.offline");
  // Check-in/check-out yang juga masih di HP (`AntreanLuring`) — ikut menentukan "semua sudah terkirim".
  const [luring, setLuring] = useState({ total: 0, menunggu: 0 });
  const terimaJumlahLuring = useCallback((j: { total: number; menunggu: number }) => setLuring(j), []);
  const locale = useLocale();
  const tPay = dinamis(useTranslations("payments"));
  const tRetur = dinamis(useTranslations("pwaRetur"));
  const tJanji = dinamis(useTranslations("pwa.janjiBayar"));
  const tFoto = dinamis(useTranslations("foto"));
  const [orders, setOrders] = useState<PendingOrder[] | null>(null);
  const [foto, setFoto] = useState<FotoTampil[]>([]);
  const [klaim, setKlaim] = useState<PendingClaim[]>([]);
  const [retur, setRetur] = useState<PendingReturn[]>([]);
  const [janji, setJanji] = useState<PendingPromise[]>([]);
  // Bukti terima pengiriman (lihat `lib/pwa/offline/bukti-terima-*`).
  const tBukti = dinamis(useTranslations("buktiTerima"));
  const [bukti, setBukti] = useState<PendingBuktiTerima[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // URL gambar per foto, dibuat SEKALI per foto dan dicabut begitu fotonya
  // hilang dari antrean atau layar ditutup. Membuat ulang setiap kali antrean
  // dimuat ulang akan membuat gambar berkedip dan membocorkan memori.
  const urlFoto = useRef(new Map<string, string>());
  const aktif = useRef(false);

  const namaToko = useMemo(() => {
    const peta = new Map<string, string>();
    for (const k of Object.values(kunjungan)) peta.set(k.storeId, k.toko);
    return peta;
  }, [kunjungan]);

  const reload = useCallback(() => {
    void Promise.all([
      listPendingOrders(),
      listPendingPhotos(),
      daftarKlaimTertahan(),
      daftarReturTertahan(),
      daftarJanjiTertahan(),
      daftarBuktiTerimaTertahan(),
    ]).then(
      ([o, f, k, r, j, b]) => {
        // Sudah ditutup: jangan membuat URL yang tidak akan pernah dicabut.
        if (!aktif.current) return;
        const peta = urlFoto.current;
        const ada = new Set(f.map((x) => x.localId));
        for (const [id, url] of peta) {
          if (!ada.has(id)) {
            URL.revokeObjectURL(url);
            peta.delete(id);
          }
        }
        setFoto(
          f.map((x) => {
            let url = peta.get(x.localId);
            if (!url) {
              url = URL.createObjectURL(x.blob);
              peta.set(x.localId, url);
            }
            return { baris: x, url };
          }),
        );
        setOrders(o);
        setKlaim(k);
        setRetur(r);
        setJanji(j);
        setBukti(b);
      },
    );
  }, []);

  useEffect(() => {
    aktif.current = true;
    const peta = urlFoto.current;
    reload();
    const cleanup = setupOrderSync(reload);
    window.addEventListener(PERISTIWA_ANTREAN, reload);
    return () => {
      aktif.current = false;
      cleanup();
      window.removeEventListener(PERISTIWA_ANTREAN, reload);
      for (const url of peta.values()) URL.revokeObjectURL(url);
      peta.clear();
    };
  }, [reload]);

  /** "Coba lagi" pada check-in/check-out tanpa sinyal — dijalankan oleh `AntreanLuring`. */
  const kirimDariLuring = async () => {
    try {
      await kirimSemuaAntrean();
    } finally {
      reload();
      window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
    }
  };

  /** Alasan laporan ditolak. `FOTO_*` = fotonya yang ditolak saat diunggah. */
  const alasanLaporan = (kode: string | undefined, tJenis: typeof tPay) => {
    if (!kode) return t("errGeneric");
    return kode.startsWith("FOTO_") ? tFoto(`err${kode.slice(5)}`) : tJenis(`err${kode}`);
  };

  async function jalankan(id: string, kerja: () => Promise<void>) {
    setBusyId(id);
    try {
      await kerja();
    } finally {
      setBusyId(null);
      reload();
      window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
    }
  }

  const ulangPesanan = (order: PendingOrder) =>
    jalankan(order.localId, async () => {
      await retryPendingOrder(order.localId);
      const result = await flushPendingOrders();
      if (result.synced > 0) toast.success(t("syncedToast", { count: result.synced }));
      else if (result.failed > 0) toast.error(t("errGeneric"));
    });

  const ulangFoto = (localId: string) =>
    jalankan(localId, async () => {
      await retryPendingPhoto(localId);
      const hasil = await flushPendingPhotos();
      if (hasil.synced > 0) toast.success(t("photosSynced", { count: hasil.synced }));
      else if (hasil.failed > 0) toast.error(t("errGeneric"));
      else if (!navigator.onLine) toast.message(t("photoStillOffline"));
    });

  const ulangLaporan = (id: string, tandai: (id: string) => Promise<void>) =>
    jalankan(id, async () => {
      await tandai(id);
      const hasil = await flushLaporanTertahan();
      if (hasil.terkirim > 0) toast.success(t("reportsSynced", { count: hasil.terkirim }));
      else if (!navigator.onLine) toast.message(t("stillOffline"));
    });

  const ulangBukti = (id: string) =>
    jalankan(id, async () => {
      await ulangBuktiTerimaTertahan(id);
      const hasil = await flushBuktiTerimaTertahan();
      if (hasil.terkirim > 0) toast.success(tBukti("tertahan.terkirim", { count: hasil.terkirim }));
      else if (!navigator.onLine) toast.message(t("stillOffline"));
    });

  /** Alasan bukti terima ditolak: penolakan unggah di `foto`, selebihnya di `buktiTerima.err`. */
  const alasanBukti = (kode: string | undefined) => {
    const letak = letakAlasanBuktiTerima(kode);
    return letak.ruang === "foto" ? tFoto(letak.kunci) : tBukti(`err.${letak.kunci}`);
  };

  // Foto ikut dihitung: layar ini tidak boleh berkata "semua sudah terkirim"
  // sementara titik di menu dan peringatan keluar masih menghitung foto.
  const kosong =
    luring.total === 0 &&
    orders !== null &&
    orders.length === 0 &&
    foto.length === 0 &&
    klaim.length === 0 &&
    retur.length === 0 &&
    janji.length === 0 &&
    bukti.length === 0;

  const waktu = (ms: number | string) => formatDisplayDateTime(ms, locale);

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-bold leading-tight">{t("pendingTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pendingBody")}</p>
      </header>

      {orders === null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      )}

      {/* Check-in dan check-out yang dicatat tanpa sinyal. */}
      <AntreanLuring onJumlah={terimaJumlahLuring} onKirim={kirimDariLuring} sibukLuar={busyId !== null} />

      {kosong && (
        <Card className="py-0">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</CardContent>
        </Card>
      )}

      {orders !== null && orders.length > 0 && (
        <Bagian judul={t("sectionOrders")}>
          {orders.map((order) => (
            <Kiriman
              key={order.localId}
              judul={order.storeName}
              rincian={
                order.gantiOrderNo
                  ? `${t("lines", { count: order.lines.length })} · ${t("replacesOrder", { orderNo: order.gantiOrderNo })}`
                  : t("lines", { count: order.lines.length })
              }
              keadaan={order.syncState}
              disimpan={waktu(order.capturedAt)}
              galat={order.syncState === "failed" ? errorLabel(order.error, t) : null}
              sibuk={busyId === order.localId}
              isiHapus={t("deleteOrderBody", { store: order.storeName, count: order.lines.length })}
              onUlang={() => ulangPesanan(order)}
              onHapus={() => jalankan(order.localId, () => deletePendingOrder(order.localId))}
            />
          ))}
        </Bagian>
      )}

      {foto.length > 0 && (
        <Bagian judul={t("sectionPhotos")}>
          {foto.map(({ baris: f, url }) => {
            const k = kunjungan[f.visitId];
            const toko = k?.toko ?? namaToko.get(f.storeId) ?? t("photoUnknownStore");
            const rincian = [k ? t("photoVisit", { date: waktu(k.checkinAt) }) : null, f.caption?.trim() || null]
              .filter(Boolean)
              .join(" · ");
            return (
              <Kiriman
                key={f.localId}
                judul={toko}
                rincian={rincian}
                gambar={{ url, alt: f.caption?.trim() || t("photoAlt", { store: toko }) }}
                keadaan={f.syncState}
                disimpan={waktu(f.capturedAt)}
                galat={f.syncState === "failed" ? alasanFoto(f.error, t) : null}
                sibuk={busyId === f.localId}
                isiHapus={t("deletePhotoBody", { store: toko })}
                onUlang={() => ulangFoto(f.localId)}
                onHapus={() => jalankan(f.localId, () => deletePendingPhoto(f.localId))}
              />
            );
          })}
        </Bagian>
      )}

      {klaim.length > 0 && (
        <Bagian judul={t("sectionClaims")}>
          {klaim.map((k) => (
            <Kiriman
              key={k.localId}
              judul={k.storeName}
              rincian={`${t("claimInvoices", { count: k.payload.pelunasan.length })} · ${formatIDR(k.receivedAmount)}`}
              keadaan={k.syncState}
              disimpan={waktu(k.capturedAt)}
              galat={k.syncState === "failed" ? alasanLaporan(k.error, tPay) : null}
              sibuk={busyId === k.localId}
              isiHapus={t("deleteClaimBody", { store: k.storeName, amount: formatIDR(k.receivedAmount) })}
              onUlang={() => ulangLaporan(k.localId, ulangKlaimTertahan)}
              onHapus={() => jalankan(k.localId, () => hapusKlaimTertahan(k.localId))}
            />
          ))}
        </Bagian>
      )}

      {retur.length > 0 && (
        <Bagian judul={t("sectionReturns")}>
          {retur.map((r) => (
            <Kiriman
              key={r.localId}
              judul={r.storeName}
              rincian={
                // Nota SPG membawa baris barang dan tidak membawa rupiah ke HP
                // (nilai konsinyasi dihitung server) — tampilkan jumlah potong.
                r.payload.barisSpg?.length
                  ? `${r.payload.noNrt || "—"} · ${tRetur("jumlahPotong", { count: r.payload.barisSpg.reduce((n, b) => n + b.qty, 0) })}`
                  : `${r.payload.noNrt} · ${formatIDR(r.payload.claimedAmount)}`
              }
              keadaan={r.syncState}
              disimpan={waktu(r.capturedAt)}
              galat={r.syncState === "failed" ? alasanLaporan(r.error, tRetur) : null}
              sibuk={busyId === r.localId}
              isiHapus={t("deleteReturnBody", { store: r.storeName, nrt: r.payload.noNrt })}
              onUlang={() => ulangLaporan(r.localId, ulangReturTertahan)}
              onHapus={() => jalankan(r.localId, () => hapusReturTertahan(r.localId))}
            />
          ))}
        </Bagian>
      )}

      {janji.length > 0 && (
        <Bagian judul={tJanji("pendingSection")}>
          {janji.map((j) => (
            <Kiriman
              key={j.localId}
              judul={j.storeName}
              rincian={tJanji("pendingLine", {
                count: j.payload.receivableIds.length,
                date: j.payload.janjiBayar,
                value: formatIDR(j.nilai),
              })}
              keadaan={j.syncState}
              disimpan={waktu(j.capturedAt)}
              galat={j.syncState === "failed" ? alasanLaporan(j.error, tJanji) : null}
              sibuk={busyId === j.localId}
              isiHapus={tJanji("pendingDeleteBody", { store: j.storeName, amount: formatIDR(j.nilai) })}
              onUlang={() => ulangLaporan(j.localId, ulangJanjiTertahan)}
              onHapus={() => jalankan(j.localId, () => hapusJanjiTertahan(j.localId))}
            />
          ))}
        </Bagian>
      )}

      {bukti.length > 0 && (
        <Bagian judul={tBukti("tertahan.bagian")}>
          {bukti.map((b) => (
            <Kiriman
              key={b.localId}
              judul={b.storeName}
              rincian={tBukti("tertahan.baris", { docNo: b.docNo, name: b.payload.receivedByName })}
              keadaan={b.syncState}
              disimpan={waktu(b.capturedAt)}
              galat={b.syncState === "failed" ? alasanBukti(b.error) : null}
              sibuk={busyId === b.localId}
              isiHapus={tBukti("tertahan.hapusIsi", { docNo: b.docNo, store: b.storeName })}
              onUlang={() => ulangBukti(b.localId)}
              onHapus={() => jalankan(b.localId, () => hapusBuktiTerimaTertahan(b.localId))}
            />
          ))}
        </Bagian>
      )}
    </div>
  );
}

function Bagian({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="beranda-judul">{judul}</h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function Kiriman({
  judul,
  rincian,
  gambar,
  keadaan,
  disimpan,
  galat,
  sibuk,
  isiHapus,
  onUlang,
  onHapus,
}: {
  judul: string;
  rincian: string;
  gambar?: { url: string; alt: string };
  keadaan: Keadaan;
  disimpan: string;
  galat: string | null;
  sibuk: boolean;
  /** Apa yang hilang kalau dihapus — ditampilkan di konfirmasi. */
  isiHapus: string;
  onUlang: () => void;
  onHapus: () => void;
}) {
  const t = useTranslations("pwa.offline");
  const [yakin, setYakin] = useState(false);
  return (
    <li>
      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            {gambar ? (
              // Gambar dari berkas di HP (blob:), bukan dari server — next/image tidak berlaku di sini.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={gambar.url} alt={gambar.alt} className="h-16 w-16 shrink-0 rounded-md border object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium leading-tight">{judul}</p>
              {rincian ? <p className="text-xs text-muted-foreground">{rincian}</p> : null}
            </div>
            <Badge
              variant={keadaan === "failed" ? "destructive" : keadaan === "syncing" ? "default" : "secondary"}
              className="shrink-0"
            >
              {keadaan === "failed" && t("stateFailed")}
              {keadaan === "syncing" && t("stateSyncing")}
              {keadaan === "pending" && t("statePending")}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("capturedAt")}: {disimpan}
          </p>

          {galat && <p className="text-xs text-destructive">{galat}</p>}

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={sibuk} onClick={onUlang} className="flex-1">
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              {t("retry")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={sibuk}
              onClick={() => setYakin(true)}
              className="flex-1 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {t("delete")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Yang dihapus di sini hanya ada di HP ini — sekali hilang, kantor tidak pernah menerimanya. */}
      <AlertDialog open={yakin} onOpenChange={setYakin}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{isiHapus}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setYakin(false);
                onHapus();
              }}
            >
              {t("deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
