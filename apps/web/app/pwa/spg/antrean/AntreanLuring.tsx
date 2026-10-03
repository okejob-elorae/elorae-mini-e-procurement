"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeftRight, ClipboardCheck, Hourglass, Loader2, LogIn, LogOut, PackageCheck, RotateCw, Trash2, Truck, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { dinamis } from "@/lib/i18n/dinamis";
import { formatDisplayDateTime } from "@/lib/date-only";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { daftarAntreanLuring, hapusLuring, ulangLuring, type AntreanLuring as DataAntrean, type JenisLuring } from "@/lib/pwa/offline/luring-antrean";
import { useAlasanLuring } from "@/app/pwa/stores/[id]/KunjunganLuring";
import { useAlasanMutasiDiHp } from "@/app/pwa/spg/mutasi/MutasiDiHp";

type Keadaan = "pending" | "syncing" | "failed";

/** Satu baris tampilan, apa pun jenisnya. */
type Butir = {
  jenis: JenisLuring;
  localId: string;
  waktu: number;
  syncState: Keadaan;
  error?: string;
  rinci?: { jarakMeter?: number; radiusMeter?: number } | null;
  judul: string;
  keterangan: string[];
  /** Menunggu check-in tanpa sinyal yang mengikatnya terkirim lebih dulu. */
  menungguCheckin: boolean;
  /** Tanda dikirim mutasi: menunggu ajuan mutasinya (juga di HP) terkirim lebih dulu. */
  menungguAjuan?: boolean;
  /** Alasan penolakan yang sudah disusun (mutasi memakai kalimat layar mutasi). */
  alasanTeks?: string;
};

const IKON: Record<JenisLuring, typeof LogIn> = {
  checkin: LogIn,
  checkout: LogOut,
  terima: PackageCheck,
  opname: ClipboardCheck,
  returPembeli: Undo2,
  mutasiAjuan: ArrowLeftRight,
  mutasiKirim: Truck,
};

/**
 * Check-in, check-out, dan pekerjaan stok SPG yang dicatat tanpa sinyal dan
 * masih di HP — bagian dari layar "Belum terkirim".
 *
 * Yang menunggu sinyal terkirim sendiri; "Coba lagi" hanya mempercepatnya. Yang
 * ditolak server menunjukkan alasannya dalam bahasa Indonesia. Menghapus
 * berarti pekerjaannya tidak pernah tercatat — konfirmasinya mengatakan
 * akibatnya per jenis. Tanpa angka rupiah: hanya potong dan dokumen.
 *
 * Tanggal diformat di klien dengan sengaja: isinya dari HP (IndexedDB), tidak
 * pernah dirender server.
 */
export function AntreanLuring({
  onJumlah,
  onKirim,
  sibukLuar,
}: {
  /** Jumlah baris dan yang masih menunggu (bukan ditolak) — untuk ringkasan dan keadaan kosong layar. */
  onJumlah: (j: { total: number; menunggu: number }) => void;
  /** Kirim semua antrean (dipakai "Coba lagi"). */
  onKirim: () => Promise<void>;
  sibukLuar: boolean;
}) {
  const t = useTranslations("pwaLuring.antrean");
  const td = dinamis(t);
  const locale = useLocale();
  const alasanTeks = useAlasanLuring();
  const alasanMutasi = useAlasanMutasiDiHp();
  const [data, setData] = useState<DataAntrean | null>(null);
  const [sibukId, setSibukId] = useState<string | null>(null);

  const muat = useCallback(() => {
    void daftarAntreanLuring().then(setData);
  }, []);

  useEffect(() => {
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => window.removeEventListener(PERISTIWA_ANTREAN, muat);
  }, [muat]);

  const checkinTertahan = new Set((data?.checkin ?? []).map((c) => c.localId));
  const menungguCheckin = (b: { visitClientId?: string | null; syncState: Keadaan }) =>
    b.syncState === "pending" && !!b.visitClientId && checkinTertahan.has(b.visitClientId);
  const toko = (nama: string | null | undefined) => nama || t("tokoIni");

  const kunjungan: Butir[] = data
    ? [
        ...data.checkin.map((c) => ({
          jenis: "checkin" as const,
          localId: c.localId,
          waktu: c.waktu,
          syncState: c.syncState,
          error: c.error,
          rinci: c.galatRinci ?? null,
          judul: t("checkin", { toko: toko(c.storeName) }),
          keterangan: [],
          menungguCheckin: false,
        })),
        ...data.checkout.map((c) => ({
          jenis: "checkout" as const,
          localId: c.localId,
          waktu: c.waktu,
          syncState: c.syncState,
          error: c.error,
          judul: t("checkout", { toko: toko(c.storeName) }),
          keterangan: [],
          menungguCheckin: menungguCheckin(c),
        })),
      ].sort((a, b) => a.waktu - b.waktu)
    : [];

  const stok: Butir[] = data
    ? [
        ...data.terima.map((r) => {
          const rusak = r.diterima.reduce((n, d) => n + (d.qtyDamaged ?? 0), 0);
          return {
            jenis: "terima" as const,
            localId: r.localId,
            waktu: r.waktu,
            syncState: r.syncState,
            error: r.error,
            judul: t("terima", { docNo: r.docNo }),
            keterangan: [
              t("potong", { count: r.diterima.reduce((n, d) => n + d.qtyReceived, 0) }),
              ...(rusak > 0 ? [t("rusak", { count: rusak })] : []),
            ],
            menungguCheckin: menungguCheckin(r),
          };
        }),
        ...data.opname.map((r) => ({
          jenis: "opname" as const,
          localId: r.localId,
          waktu: r.waktu,
          syncState: r.syncState,
          error: r.error,
          judul: t("opname", { count: r.baris.length }),
          keterangan: [t("potong", { count: r.baris.reduce((n, b) => n + b.qtyCounted, 0) })],
          menungguCheckin: menungguCheckin(r),
        })),
        ...data.returPembeli.map((r) => ({
          jenis: "returPembeli" as const,
          localId: r.localId,
          waktu: r.waktu,
          syncState: r.syncState,
          error: r.error,
          judul: t("returPembeli", { docNo: r.docNo }),
          keterangan: [t("potong", { count: r.baris.reduce((n, b) => n + b.qty, 0) })],
          menungguCheckin: false,
        })),
      ].sort((a, b) => a.waktu - b.waktu)
    : [];

  const ajuanTertahan = new Map((data?.mutasiAjuan ?? []).map((a) => [a.localId, a]));
  const mutasi: Butir[] = data
    ? [
        ...data.mutasiAjuan.map((a) => ({
          jenis: "mutasiAjuan" as const,
          localId: a.localId,
          waktu: a.waktu,
          syncState: a.syncState,
          error: a.error,
          alasanTeks: a.syncState === "failed" ? alasanMutasi(a) : undefined,
          judul: t("mutasiAjuan", { toko: a.tujuanNama || t("tokoIni") }),
          keterangan: [t("potong", { count: a.baris.reduce((n, b) => n + b.qty, 0) })],
          menungguCheckin: menungguCheckin(a),
        })),
        ...data.mutasiKirim.map((k) => {
          const ajuan = k.ajuanLocalId ? ajuanTertahan.get(k.ajuanLocalId) : undefined;
          return {
            jenis: "mutasiKirim" as const,
            localId: k.localId,
            waktu: k.waktu,
            syncState: k.syncState,
            error: k.error,
            alasanTeks: k.syncState === "failed" ? alasanMutasi(k) : undefined,
            judul: k.docNo ? t("mutasiKirim", { docNo: k.docNo }) : t("mutasiKirimAjuan", { toko: k.tujuanNama || t("tokoIni") }),
            keterangan: [t("potong", { count: k.pcs })],
            menungguCheckin: menungguCheckin(k),
            menungguAjuan: k.syncState === "pending" && !k.transferId && !!ajuan && ajuan.syncState !== "failed",
          };
        }),
      ].sort((a, b) => a.waktu - b.waktu)
    : [];

  const total = kunjungan.length + stok.length + mutasi.length;
  const menunggu = [...kunjungan, ...stok, ...mutasi].filter((b) => b.syncState !== "failed").length;
  useEffect(() => {
    onJumlah({ total, menunggu });
  }, [total, menunggu, onJumlah]);

  async function jalankan(b: Butir, kerja: () => Promise<void>) {
    setSibukId(b.localId);
    try {
      await kerja();
    } catch {
      toast.error(t("gagalUbah"));
    } finally {
      setSibukId(null);
      muat();
    }
  }

  const ulang = (b: Butir) =>
    jalankan(b, async () => {
      await ulangLuring(b.jenis, b.localId);
      await onKirim();
    });

  const hapus = (b: Butir) =>
    jalankan(b, async () => {
      await hapusLuring(b.jenis, b.localId);
      toast.message(t("deleted"));
    });

  if (!data || total === 0) return null;

  const daftar = (judul: string, isi: Butir[]) =>
    isi.length === 0 ? null : (
      <section className="space-y-2" aria-label={judul}>
        <h2 className="beranda-judul px-1">{judul}</h2>
        <ul className="space-y-2">
          {isi.map((b) => (
            <BarisLuring
              key={`${b.jenis}:${b.localId}`}
              butir={b}
              waktu={formatDisplayDateTime(b.waktu, locale)}
              alasan={b.syncState === "failed" ? (b.alasanTeks ?? alasanTeks(b.error, b.rinci)) : null}
              peringatanHapus={td(`hapusIsi.${b.jenis}`)}
              sibuk={sibukId === b.localId || sibukLuar}
              onUlang={() => void ulang(b)}
              onHapus={() => void hapus(b)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <>
      {daftar(t("judulKunjungan"), kunjungan)}
      {daftar(t("judulStok"), stok)}
      {daftar(t("judulMutasi"), mutasi)}
    </>
  );
}

function BarisLuring({
  butir,
  waktu,
  alasan,
  peringatanHapus,
  sibuk,
  onUlang,
  onHapus,
}: {
  butir: Butir;
  waktu: string;
  alasan: string | null;
  peringatanHapus: string;
  sibuk: boolean;
  onUlang: () => void;
  onHapus: () => void;
}) {
  const t = useTranslations("pwaLuring.antrean");
  const [yakin, setYakin] = useState(false);
  const Ikon = IKON[butir.jenis];

  return (
    <li>
      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Ikon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium leading-tight">{butir.judul}</p>
              <p className="text-xs text-muted-foreground">{t("dicatat", { waktu })}</p>
              {butir.keterangan.length > 0 ? <p className="text-xs text-muted-foreground">{butir.keterangan.join(" · ")}</p> : null}
            </div>
            <Badge
              variant={butir.syncState === "failed" ? "destructive" : butir.syncState === "syncing" ? "default" : "secondary"}
              className="shrink-0"
            >
              {butir.syncState === "failed" ? t("stateFailed") : butir.syncState === "syncing" ? t("stateSyncing") : t("statePending")}
            </Badge>
          </div>

          {butir.menungguCheckin ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t("menungguCheckin")}</span>
            </p>
          ) : null}
          {butir.menungguAjuan ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Hourglass className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t("menungguAjuan")}</span>
            </p>
          ) : null}

          {alasan ? <p className="text-sm text-destructive">{alasan}</p> : null}

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={sibuk} onClick={onUlang} className="h-auto min-h-11 whitespace-normal py-2">
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCw className="h-4 w-4" aria-hidden />}
              {t("retry")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={sibuk}
              onClick={() => setYakin(true)}
              className="h-auto min-h-11 whitespace-normal py-2 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t("delete")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hanya ada di HP ini — sekali dihapus, pekerjaannya tidak pernah tercatat di mana pun. */}
      <AlertDialog open={yakin} onOpenChange={setYakin}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{peringatanHapus}</AlertDialogDescription>
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
