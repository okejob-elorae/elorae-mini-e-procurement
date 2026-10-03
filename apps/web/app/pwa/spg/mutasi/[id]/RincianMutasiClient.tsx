"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, CloudOff, Hourglass, Loader2, PackageCheck, Truck, XCircle } from "lucide-react";
import { batalkanMutasiSpgAction, kirimMutasiAction, type HasilMutasiAksi } from "@/app/actions/spg-mutasi";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { antreKirimMutasi } from "@/lib/pwa/offline/luring-antrean";
import { ikatanKunjungan, kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { BATAS_TEKS_MUTASI } from "@/lib/spg/mutasi-aturan";
import type { RincianMutasiHp } from "@/lib/spg/mutasi-queries";
import { cn } from "@/lib/utils";
import { kirimAntreanBilaBisa, useAlasanMutasiDiHp, useMutasiDiHp } from "../MutasiDiHp";
import { nadaStatusMutasi, pesanGagalMutasi } from "../tampilan";
import { TombolSuratJalan } from "./TombolSuratJalan";

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
 * Satu mutasi di HP SPG. "Tandai sudah dikirim" juga bekerja tanpa sinyal:
 * tandanya disimpan di HP (kunci yang sama dengan kiriman langsungnya) dan
 * terkirim sendiri; stok toko asal keluar pada waktu ditandai di HP. Selama
 * tandanya di HP, layar ini menunjukkannya dan tidak menawarkan batal.
 */
export function RincianMutasiClient({
  storeId,
  kunjunganServer,
  rincian,
  sudahCheckIn: sudahCheckInServer,
}: {
  /** Toko tetap SPG — dari server. */
  storeId: string;
  /** Kunjungan berjalan di toko ini menurut server (halaman bisa dari cache). */
  kunjunganServer: { id: string; checkinAtMs: number } | null;
  rincian: RincianMutasiHp | null;
  sudahCheckIn: boolean;
}) {
  const t = useTranslations("spgMutasi");
  const td = dinamis(t);
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [kirimBuka, setKirimBuka] = useState(false);
  const [batalBuka, setBatalBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  // Check-in tanpa sinyal juga sah untuk menandai dikirim.
  const { kunjungan: lokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const sudahCheckIn = sudahCheckInServer || kunjunganLokalSah(lokal);
  const luring = useSyncExternalStore(langgananSinyal, tanpaSinyal, () => false);
  const { data: diHp } = useMutasiDiHp(storeId, { segarkan: true });
  const alasanDiHp = useAlasanMutasiDiHp();
  // Satu kunci per ketukan "Ya, sudah dikirim": dikirim langsung atau dari antrean, server mencatatnya sekali.
  const [kunciKirim, setKunciKirim] = useState(newLocalId);

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/spg/mutasi" />
    </Button>
  );

  if (!rincian) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{t("rincian.tidakAdaJudul")}</h1>
          <p className="text-sm text-muted-foreground">{t("rincian.tidakAdaIsi")}</p>
          <Button asChild className="w-full">
            <Link href="/pwa/spg/mutasi">{t("rincian.keDaftar")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  const jalankan = (aksi: () => Promise<HasilMutasiAksi>, sukses: string, tutup: () => void) =>
    mulai(async () => {
      let r: HasilMutasiAksi;
      try {
        r = await aksi();
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      tutup();
      if (!r.ok) {
        toast.error(pesanGagalMutasi(r, td));
        router.refresh();
        return;
      }
      toast.success(sukses);
      router.refresh();
    });

  const totalPcs = rincian.baris.reduce((n, b) => n + b.qty, 0);
  const adaTerima = rincian.baris.some((b) => b.diterima !== null);
  // Tanda dikirim untuk mutasi ini yang masih di HP (menunggu sinyal atau ditolak).
  const kirimHp = diHp.kirim.find((k) => k.transferId === rincian.id) ?? null;

  /** Simpan tanda dikirim di HP. Stok keluar di kantor saat terkirim, bertanggal `waktu`. */
  const simpanKirimDiHp = async (ikatan: { visitId: string | null; visitClientId: string | null }, waktu: number) => {
    try {
      await antreKirimMutasi({
        localId: kunciKirim,
        storeId,
        transferId: rincian.id,
        ajuanLocalId: null,
        docNo: rincian.docNo,
        tujuanNama: rincian.tujuan,
        pcs: totalPcs,
        waktu,
        visitId: ikatan.visitId,
        visitClientId: ikatan.visitClientId,
      });
    } catch {
      toast.error(t("luring.gagalSimpan"));
      return;
    }
    setKirimBuka(false);
    setKunciKirim(newLocalId());
    toast.success(t("luring.kirimTersimpanToast", { docNo: rincian.docNo }));
    // Tertahan hanya karena check-in-nya masih di HP: coba kirim sekarang juga.
    kirimAntreanBilaBisa();
  };

  const tandaiDikirim = () => {
    const ikatan = ikatanKunjungan(kunjunganServer, lokal);
    mulai(async () => {
      // Waktu keluar = saat tombol ditekan, bukan saat antrean terkirim.
      const waktu = Date.now();
      if (!ikatan || tanpaSinyal() || ikatan.visitClientId) {
        if (ikatan) await simpanKirimDiHp(ikatan, waktu);
        else toast.error(td("err.NO_ACTIVE_VISIT"));
        return;
      }
      let r: HasilMutasiAksi;
      try {
        r = await denganBatasWaktu(kirimMutasiAction({ transferId: rincian.id, idempotencyKey: kunciKirim }));
      } catch {
        // Sinyal putus / tidak ada jawaban: antrekan dengan kunci yang sama —
        // kalau ternyata sudah sampai, antrean hanya mendapat "sudah tercatat".
        await simpanKirimDiHp(ikatan, waktu);
        return;
      }
      setKirimBuka(false);
      if (!r.ok) {
        toast.error(pesanGagalMutasi(r, td));
        router.refresh();
        return;
      }
      setKunciKirim(newLocalId());
      toast.success(t("rincian.okKirim", { docNo: rincian.docNo }));
      router.refresh();
    });
  };

  return (
    <div className="space-y-4 p-4">
      {kembali}

      <header className="space-y-1">
        <h1 className="break-all text-2xl font-bold">{rincian.docNo}</h1>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <span>{rincian.asal}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          <span>{rincian.tujuan}</span>
        </p>
        <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusMutasi(rincian.status))}>
          {td(`status.${rincian.status}`)}
        </span>
      </header>

      <section className="beranda-kartu space-y-2 text-sm">
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("rincian.diajukan")}</span>
          <span className="text-right">{rincian.diajukan}</span>
        </p>
        {rincian.dikirim ? (
          <p className="flex justify-between gap-3">
            <span className="text-muted-foreground">{t("rincian.dikirim")}</span>
            <span className="text-right">{rincian.dikirim}</span>
          </p>
        ) : null}
        <div className="space-y-0.5">
          <p className="text-muted-foreground">{t("rincian.alasan")}</p>
          <p className="whitespace-pre-line">{rincian.alasan}</p>
        </div>
        {rincian.catatanKantor ? (
          <p
            className={cn(
              "rounded-lg px-3 py-2",
              rincian.status === "DITOLAK" || rincian.status === "DIBATALKAN" || rincian.status === "DIKEMBALIKAN" ? "bg-destructive/10 text-destructive" : "bg-muted",
            )}
          >
            {t("rincian.catatanKantor", { catatan: rincian.catatanKantor })}
          </p>
        ) : null}
        {rincian.selisihStatus ? <p className="text-sm font-medium">{td(`rincian.selisih.${rincian.selisihStatus}`)}</p> : null}
      </section>

      <section className="space-y-2" aria-labelledby="judul-baris-mutasi">
        <h2 id="judul-baris-mutasi" className="beranda-judul px-1">
          {t("rincian.barisJudul", { baris: rincian.baris.length, pcs: totalPcs })}
        </h2>
        <div className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {rincian.baris.map((b) => (
              <li key={b.id} className="space-y-1 px-4 py-3">
                <p className="font-medium leading-tight">{b.productName}</p>
                {b.variantSku ? <p className="truncate text-xs text-muted-foreground">{b.variantSku}</p> : null}
                <p className="text-sm tabular-nums">{t("rincian.dikirimQty", { qty: b.qty })}</p>
                {adaTerima ? (
                  <p className={cn("text-sm tabular-nums", b.diterima !== null && b.diterima < b.qty && "font-semibold text-destructive")}>
                    {t("rincian.diterimaQty", { qty: b.diterima ?? 0 })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <TombolSuratJalan rincian={rincian} />

      {kirimHp ? (
        <section className="beranda-kartu space-y-3" role="status">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <CloudOff className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold leading-tight">{t("luring.kirimTertahanJudul")}</h2>
              <p className={cn("text-sm", kirimHp.syncState === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {kirimHp.syncState === "failed" ? alasanDiHp(kirimHp) : t("luring.kirimTertahanIsi")}
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2">
            <Link href="/pwa/spg/antrean">
              <Hourglass className="h-4 w-4" aria-hidden />
              {t("luring.lihatAntrean")}
            </Link>
          </Button>
        </section>
      ) : rincian.tindakan === "KIRIM" ? (
        <div className="space-y-2">
          <Button className="w-full" size="lg" disabled={!sudahCheckIn || pending} onClick={() => setKirimBuka(true)}>
            <Truck className="h-4 w-4" aria-hidden />
            {t("rincian.tandaiDikirim")}
          </Button>
          <KeteranganKirim teks={!sudahCheckIn ? t("rincian.perluCheckInKirim") : null} />
          {luring && sudahCheckIn ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <CloudOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{t("luring.catatanKirim")}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {rincian.tindakan === "TERIMA" || rincian.tindakan === "TERIMA_KEMBALI" ? (
        <Button asChild className="w-full" size="lg">
          <Link href={`/pwa/spg/terima/${rincian.tindakan === "TERIMA" ? "MUTASI" : "MUTASI_KEMBALI"}/${rincian.id}`}>
            <PackageCheck className="h-4 w-4" aria-hidden />
            {rincian.tindakan === "TERIMA" ? t("rincian.hitungTerima") : t("rincian.hitungTerimaKembali")}
          </Link>
        </Button>
      ) : null}
      {/* Tanda dikirim yang masih menunggu sinyal: barangnya sudah berangkat, jadi tidak ditawarkan batal. */}
      {rincian.bolehBatal && (!kirimHp || kirimHp.syncState === "failed") ? (
        <Button variant="outline" className="w-full" disabled={pending} onClick={() => setBatalBuka(true)}>
          <XCircle className="h-4 w-4" aria-hidden />
          {t("rincian.batalkan")}
        </Button>
      ) : null}

      <AlertDialog open={kirimBuka} onOpenChange={(v) => !pending && setKirimBuka(v)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rincian.kirimJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rincian.kirimIsi", { pcs: totalPcs, toko: rincian.tujuan })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("rincian.periksaLagi")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                tandaiDikirim();
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("rincian.yaKirim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={batalBuka}
        onOpenChange={(v) => {
          if (pending) return;
          setBatalBuka(v);
          if (!v) setAlasan("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("rincian.batalJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rincian.batalIsi", { docNo: rincian.docNo })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mutasi-batal-alasan">{t("rincian.batalAlasan")}</Label>
            <Textarea
              id="mutasi-batal-alasan"
              value={alasan}
              rows={2}
              maxLength={BATAS_TEKS_MUTASI}
              onChange={(e) => setAlasan(e.target.value)}
              disabled={pending}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("rincian.jangan")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                jalankan(
                  () => batalkanMutasiSpgAction({ transferId: rincian.id, alasan: alasan.trim() || undefined }),
                  t("rincian.okBatal", { docNo: rincian.docNo }),
                  () => {
                    setBatalBuka(false);
                    setAlasan("");
                  },
                );
              }}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("rincian.yaBatalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
