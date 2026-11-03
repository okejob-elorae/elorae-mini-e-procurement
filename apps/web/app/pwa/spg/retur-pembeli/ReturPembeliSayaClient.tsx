"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CloudOff, Loader2, PackageX, ReceiptText, Undo2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
import { KeteranganKirim } from "@/app/pwa/KeteranganKirim";
import { catatUangDikembalikanAction, tarikReturPembeliAction } from "@/app/actions/retur-spg";
import { dinamis } from "@/lib/i18n/dinamis";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { pwaDb } from "@/lib/pwa/offline/db";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { BatasWaktuHabis, denganBatasWaktu, tanpaSinyal } from "@/lib/pwa/offline/batas-waktu";
import { antreUangKembali } from "@/lib/pwa/offline/luring-antrean";
import type { BarangDisisihkan, ReturPembeliHp } from "@/lib/spg/retur-pembeli-queries";
import { unggahFotoReturPembeli } from "@/lib/spg/foto-retur-pembeli-klien";
import { BATAS_ALASAN_RETUR_PEMBELI, type KeadaanUangRetur, type StatusReturPembeli } from "@/lib/spg/retur-pembeli-status";
import { cn } from "@/lib/utils";
import { FotoReturTunda, type FotoTunda } from "./FotoReturTunda";

/** Warna lencana per status: menunggu kuning, disetujui utama, ditolak merah, ditarik garis saja. */
const LENCANA: Record<StatusReturPembeli, { variant: "default" | "destructive" | "outline"; className?: string }> = {
  MENUNGGU: { variant: "outline", className: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  DISETUJUI: { variant: "default" },
  DITOLAK: { variant: "destructive" },
  DIBATALKAN: { variant: "outline" },
};

/** Nada kalimat uang: yang menyuruh Anda bertindak kuning, beban merah, selebihnya biasa. */
const NADA_UANG: Record<KeadaanUangRetur, string> = {
  MENUNGGU_BELUM: "bg-muted text-foreground",
  MENUNGGU_SUDAH: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  SILAKAN_KEMBALIKAN: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  SUDAH_DIKEMBALIKAN: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  JANGAN_KEMBALIKAN: "bg-destructive/10 text-destructive",
  DIBEBANKAN: "bg-destructive/10 text-destructive",
  DITARIK: "bg-muted text-muted-foreground",
};

function ditolakServer(err: unknown): string | null {
  if (err instanceof TypeError || err instanceof BatasWaktuHabis) return null;
  if (err instanceof Error && err.message && err.message !== "GAGAL") return err.message;
  return null;
}

/**
 * Laporan barang kembali dari pembeli milik SPG ini, terbaru dulu, dengan status
 * dan keadaan uangnya (P13, P13a, P83). Uang pembeli dikembalikan kasir SESUDAH
 * kantor menyetujui, lalu dicatat di sini dengan foto struk ("Uang sudah
 * dikembalikan", P77). Yang masih menunggu dan uangnya belum tercatat boleh
 * ditarik pelapornya; sesudah uangnya tercatat, kantor yang memutuskan. Laporan
 * yang dibebankan ke Anda menunjuk ke "Beban saya" (angkanya di sana). Barang
 * yang disisihkan ditampilkan supaya tidak ke rak, tidak dijual, tidak dihitung.
 * Tanpa harga dan total.
 */
export function ReturPembeliSayaClient({
  laporan,
  disisihkan,
  storeId,
}: {
  laporan: ReturPembeliHp[];
  disisihkan: BarangDisisihkan[];
  /** Toko tetap SPG (dari server) — hanya untuk antrean HP. */
  storeId: string;
}) {
  const t = useTranslations("spgRetur.pembeliSaya");
  const tk = dinamis(useTranslations("spgRetur"));
  const ts = dinamis(t);
  const locale = useLocale();
  const [tertahan, setTertahan] = useState(0);
  const [uangTertahan, setUangTertahan] = useState<Set<string>>(() => new Set());
  const [uangGagal, setUangGagal] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let hidup = true;
    const muat = async () => {
      try {
        const n = await pwaDb.pendingSpgReturns.count();
        if (hidup) setTertahan(n);
      } catch {
        // Basis data HP tidak bisa dibuka (mode privat, penyimpanan penuh): tanpa spanduk.
        if (hidup) setTertahan(0);
      }
      // Baris yang masih akan dikirim menyembunyikan tombolnya; baris yang GAGAL
      // (ditolak tuntas) tidak akan pernah terkirim, jadi tombolnya tetap tampil
      // dengan keterangan gagal — sama dengan formulir laporan yang melewati baris gagal.
      const ada = new Set<string>();
      const gagal = new Set<string>();
      for (const r of laporan) {
        if (!r.bisaCatatUangKembali) continue;
        try {
          const antre = await pwaDb.pendingSpgRefunds.where("returnId").equals(r.id).toArray();
          if (antre.some((x) => x.syncState !== "failed")) ada.add(r.id);
          else if (antre.length > 0) gagal.add(r.id);
        } catch {
          // Tanpa basis data HP: tombolnya tetap tampil, server yang menolak dua kali.
        }
      }
      if (hidup) {
        setUangTertahan(ada);
        setUangGagal(gagal);
      }
    };
    void muat();
    const segarkan = () => void muat();
    window.addEventListener(PERISTIWA_ANTREAN, segarkan);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, segarkan);
    };
  }, [laporan]);

  return (
    <div className="@container flex min-h-dvh flex-col gap-4 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <TautanKembali cadangan="/pwa/spg/lainnya" />
        </Button>
      </header>

      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("judul")}</h1>
          <TombolBantuanHp judul={t("judul")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("penjelasan")}</p>
      </div>

      {tertahan > 0 ? (
        <Link
          href="/pwa/spg/antrean"
          className="flex min-h-11 items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
        >
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t("tertahan", { n: tertahan })} <span className="font-medium underline underline-offset-4">{t("lihatAntrean")}</span>
          </span>
        </Link>
      ) : null}

      {disisihkan.length > 0 ? (
        <Card className="py-0">
          <CardContent className="space-y-3 py-4">
            <div className="flex items-start gap-2">
              <PackageX className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
              <div className="space-y-1">
                <p className="font-semibold">{t("disisihkanJudul")}</p>
                <p className="text-sm text-muted-foreground">{t("disisihkanIsi")}</p>
              </div>
            </div>
            <ul className="divide-y rounded-md border text-sm">
              {disisihkan.map((b, i) => (
                <li key={`${b.docNo}:${b.variantSku}:${b.kondisi}:${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-medium leading-tight">{b.productName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[b.variantSku, t("nota", { docNo: b.docNo })].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block text-xs text-amber-800 dark:text-amber-300">
                      {b.tanda === "MENUNGGU_KANTOR" ? t("tandaMenunggu") : t("tandaTungguKeputusan")}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block">{t("pcs", { n: b.qty })}</span>
                    <span className="block text-xs text-muted-foreground">{tk(`kondisi${b.kondisi}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {laporan.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">{t("kosong")}</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {laporan.map((r) => {
            const lencana = LENCANA[r.status];
            return (
              <li key={r.id}>
                <Card className="py-0">
                  <CardContent className="space-y-3 py-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <Link
                          href={`/pwa/spg/${encodeURIComponent(r.spgSaleId)}/nota`}
                          className="inline-flex min-h-11 items-center gap-1 font-mono text-sm font-medium underline decoration-primary decoration-2 underline-offset-4"
                        >
                          <ReceiptText className="h-4 w-4 shrink-0" aria-hidden />
                          {t("nota", { docNo: r.docNo })}
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          {t("dilaporkan", { tanggal: locale === "en" ? r.dilaporkan.en : r.dilaporkan.id })}
                        </p>
                      </div>
                      <Badge variant={lencana.variant} className={cn("shrink-0", lencana.className)}>
                        {ts(`status.${r.status}`)}
                      </Badge>
                    </div>

                    <p className={cn("rounded-lg px-3 py-2 text-sm leading-relaxed", NADA_UANG[r.uang])}>
                      <span className="block font-medium">{ts(`uang.${r.uang}`)}</span>
                      <span className="block">{ts(`uangKet.${r.uang}`)}</span>
                    </p>

                    {r.beban ? (
                      <div className="flex flex-col gap-1 text-sm">
                        <span>{ts(`beban.${r.beban}`)}</span>
                        <Link
                          href="/pwa/beban"
                          className="inline-flex min-h-11 items-center gap-1 font-medium underline decoration-primary decoration-2 underline-offset-4"
                        >
                          <Wallet className="h-4 w-4 shrink-0" aria-hidden />
                          {t("lihatBeban")}
                        </Link>
                      </div>
                    ) : null}

                    <ul className="divide-y rounded-md border text-sm">
                      {r.baris.map((b, i) => (
                        <li key={`${b.variantSku}:${b.kondisi}:${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block font-medium leading-tight">{b.productName}</span>
                            {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            <span className="block">{t("pcs", { n: b.qty })}</span>
                            <span className="block text-xs text-muted-foreground">{tk(`kondisi${b.kondisi}`)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="space-y-1 text-sm">
                      <p className="text-xs text-muted-foreground">{t("alasanPembeli")}</p>
                      <p className="whitespace-pre-line break-words">{r.alasan}</p>
                    </div>
                    {r.alasanKeputusan && (r.status === "DITOLAK" || r.status === "DIBATALKAN") ? (
                      <div className="space-y-1 text-sm">
                        <p className="text-xs text-muted-foreground">{r.status === "DITOLAK" ? t("alasanTolak") : t("alasanTarik")}</p>
                        <p className="whitespace-pre-line break-words">{r.alasanKeputusan}</p>
                      </div>
                    ) : null}

                    {r.bisaCatatUangKembali ? (
                      uangTertahan.has(r.id) ? (
                        <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
                          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                          {t("catatUangTertahan")}
                        </p>
                      ) : (
                        <>
                          {uangGagal.has(r.id) ? (
                            <Link
                              href="/pwa/spg/antrean"
                              className="flex min-h-11 items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                            >
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                              <span>
                                {t("catatUangGagal")} <span className="font-medium underline underline-offset-4">{t("lihatAntrean")}</span>
                              </span>
                            </Link>
                          ) : null}
                          <TombolUangKembali laporan={r} storeId={storeId} />
                        </>
                      )
                    ) : null}
                    {r.bisaDitarik ? <TombolTarik returnId={r.id} docNo={r.docNo} /> : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * "Uang sudah dikembalikan": foto struk pengembalian kasir wajib (P77). Fotonya
 * diunggah ke folder laporan ini, lalu dicatat. Tanpa sinyal (atau unggah/jawaban
 * yang tidak datang): disimpan di HP dan dikirim saat sinyal kembali, dengan jam
 * saat Anda mencatatnya. Selama laporannya masih menunggu kantor, dialognya
 * mengingatkan bahwa uang itu menjadi beban Anda kalau laporannya ditolak.
 */
function TombolUangKembali({ laporan: r, storeId }: { laporan: ReturPembeliHp; storeId: string }) {
  const t = useTranslations("spgRetur.pembeliSaya");
  const te = dinamis(t);
  const tf = dinamis(useTranslations("foto"));
  const tl = useTranslations("pwaLuring.stok");
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [foto, setFoto] = useState<FotoTunda | null>(null);
  const [sibuk, mulai] = useTransition();
  // Satu kunci antrean per dialog: dua ketukan tidak mengantre dua kali.
  const [localId] = useState(newLocalId);

  const kirim = () => {
    if (!foto) return;
    const waktu = Date.now();
    const simpanDiHp = async (key: string | null) => {
      try {
        await antreUangKembali({
          localId,
          returnId: r.id,
          storeId,
          docNo: r.docNo,
          waktu,
          foto: key ? { nama: foto.nama, key } : { nama: foto.nama, blob: foto.berkas },
        });
      } catch {
        toast.error(tl("gagalSimpan"));
        return;
      }
      toast.success(t("catatUangTersimpan"));
      setBuka(false);
      router.refresh();
    };
    mulai(async () => {
      if (tanpaSinyal()) {
        await simpanDiHp(null);
        return;
      }
      let key: string;
      try {
        key = (await denganBatasWaktu(unggahFotoReturPembeli({ berkas: foto.berkas, nama: foto.nama, jenis: "struk", returnId: r.id }))).key;
      } catch (err) {
        const kode = ditolakServer(err);
        if (kode) {
          toast.error(tf(`err${kode}`));
          return;
        }
        await simpanDiHp(null);
        return;
      }
      let hasil: Awaited<ReturnType<typeof catatUangDikembalikanAction>>;
      try {
        hasil = await denganBatasWaktu(catatUangDikembalikanAction({ returnId: r.id, fotoStrukKey: key }));
      } catch {
        await simpanDiHp(key);
        return;
      }
      if (hasil.ok) {
        toast.success(t("catatUangOk"));
        setBuka(false);
        setFoto(null);
        router.refresh();
        return;
      }
      toast.error(t.has(`err.${hasil.kode}`) ? te(`err.${hasil.kode}`) : t("err.GAGAL"));
      setBuka(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button type="button" className="w-full" onClick={() => setBuka(true)}>
        <Banknote className="h-4 w-4" aria-hidden />
        {t("catatUang")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(o) => !sibuk && setBuka(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("catatUangJudul", { docNo: r.docNo })}</AlertDialogTitle>
            <AlertDialogDescription>{t("catatUangIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          {r.status === "MENUNGGU" ? (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{t("catatUangPeringatanMenunggu")}</span>
            </p>
          ) : null}
          <FotoReturTunda id={`struk-${r.id}`} label={t("fotoStruk")} nilai={foto} onChange={setFoto} disabled={sibuk} />
          <KeteranganKirim teks={!sibuk && !foto ? t("kurangFotoStruk") : null} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("catatUangBatal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk || !foto}
              onClick={(e) => {
                // Dialog tetap terbuka sampai server menjawab — ditutup sendiri kalau berhasil.
                e.preventDefault();
                kirim();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("catatUangKirim")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Tarik laporan yang masih menunggu kantor dan uangnya belum tercatat
 * dikembalikan. Alasan wajib; server memeriksa ulang semuanya (laporan milik
 * orang lain, toko lain, yang sudah diputuskan, atau yang uangnya sudah tercatat).
 */
function TombolTarik({ returnId, docNo }: { returnId: string; docNo: string }) {
  const t = useTranslations("spgRetur.pembeliSaya");
  const te = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [sibuk, mulai] = useTransition();
  const idAlasan = `tarik-alasan-${returnId}`;

  const kirim = () =>
    mulai(async () => {
      let hasil: Awaited<ReturnType<typeof tarikReturPembeliAction>>;
      try {
        hasil = await tarikReturPembeliAction({ returnId, alasan });
      } catch {
        toast.error(t("err.GAGAL"));
        return;
      }
      if (hasil.ok) {
        toast.success(t("tarikOk"));
        setBuka(false);
        setAlasan("");
        router.refresh();
        return;
      }
      toast.error(t.has(`err.${hasil.kode}`) ? te(`err.${hasil.kode}`) : t("err.GAGAL"));
      // Sudah diputuskan kantor, atau uangnya sudah tercatat, sementara layar ini terbuka.
      if (hasil.kode === "SUDAH_DIPUTUSKAN" || hasil.kode === "UANG_SUDAH_DIKEMBALIKAN") {
        setBuka(false);
        router.refresh();
      }
    });

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setBuka(true)}>
        <Undo2 className="h-4 w-4" aria-hidden />
        {t("tarik")}
      </Button>
      <AlertDialog open={buka} onOpenChange={(o) => !sibuk && setBuka(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tarikJudul", { docNo })}</AlertDialogTitle>
            <AlertDialogDescription>{t("tarikPenjelasan")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={idAlasan}>{t("tarikAlasan")}</Label>
            <Textarea
              id={idAlasan}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("tarikAlasanContoh")}
              maxLength={BATAS_ALASAN_RETUR_PEMBELI}
              disabled={sibuk}
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("tarikBatal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={sibuk || alasan.trim() === ""}
              onClick={(e) => {
                e.preventDefault();
                kirim();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("tarikKonfirmasi")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
