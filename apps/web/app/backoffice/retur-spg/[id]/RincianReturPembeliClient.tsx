"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, History, Loader2, Package, X } from "lucide-react";
import { setujuiReturPembeliAction, tolakReturPembeliAction, type HasilPutusanReturPembeliAksi } from "@/app/actions/spg-retur";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { auditActionLabel } from "@/lib/audit/action-label";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_ALASAN_RETUR_PEMBELI, ENTITAS_RETUR_PEMBELI, type StatusReturPembeli } from "@/lib/spg/retur-pembeli-status";
import type { RincianReturPembeliKantor } from "@/lib/spg/retur-pembeli-queries";
import { NADA_STATUS_RETUR_PEMBELI } from "../tampilan";

/** Rincian yang sudah diformat di server (tanggal WIB, nama bulan dua bahasa). */
export type RincianReturPembeliTampil = {
  id: string;
  status: StatusReturPembeli;
  dilaporkan: string;
  pelapor: string;
  toko: RincianReturPembeliKantor["toko"];
  nota: { id: string; docNo: string; waktu: string; total: number };
  alasan: string;
  diputuskan: { oleh: string | null; pada: string | null; alasanTolak: string | null };
  langsungBerlaku: boolean;
  baris: RincianReturPembeliKantor["baris"];
  peringatan: { bulan: { id: string; en: string }; komisiPutusDicek: boolean; siklusKonsiTerkunci: boolean };
  jejak: { action: string; oleh: string; pada: string; reason: string | null }[];
};

export function RincianReturPembeliClient({
  rincian: r,
  bolehMemutuskan,
  alasanTidakBoleh,
}: {
  rincian: RincianReturPembeliTampil;
  /** `spg_returns:approve` DAN bukan pelapornya — pemeriksaan yang sama dengan aksi dan penulisnya. */
  bolehMemutuskan: boolean;
  alasanTidakBoleh: "PELAPOR_SENDIRI" | "TANPA_IZIN" | null;
}) {
  const t = useTranslations("spgReturPembeli");
  const td = dinamis(t);
  const tKondisi = dinamis(useTranslations("spgRetur"));
  const tAudit = useTranslations("auditActions");
  const locale = useLocale();
  const bulan = locale.startsWith("en") ? r.peringatan.bulan.en : r.peringatan.bulan.id;

  const menunggu = r.status === "MENUNGGU";
  const pcs = r.baris.reduce((n, b) => n + b.qty, 0);
  const pcsKeRak = r.baris.filter((b) => b.kondisi === "LAYAK" && !b.terhitungOpnameSesudah).reduce((n, b) => n + b.qty, 0);
  const pcsTerhitung = r.baris.filter((b) => b.kondisi === "LAYAK" && b.terhitungOpnameSesudah).reduce((n, b) => n + b.qty, 0);
  const pcsRusak = r.baris.filter((b) => b.kondisi !== "LAYAK").reduce((n, b) => n + b.qty, 0);
  const nilaiTotal = r.baris.reduce((n, b) => n + b.nilaiBersih, 0);

  const info: { label: string; nilai: ReactNode | null }[] = [
    { label: t("rincian.pelapor"), nilai: r.pelapor },
    { label: t("rincian.dilaporkanPada"), nilai: r.dilaporkan },
    { label: t("kantor.kolom.toko"), nilai: `${r.toko.nama} · ${td(`syarat.${r.toko.termsType}`)}` },
    {
      label: t("rincian.notaAsal"),
      nilai: (
        <span className="flex flex-wrap items-center gap-1.5">
          <Link href={`/backoffice/spg-sales/${r.nota.id}`} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
            {r.nota.docNo}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <span className="text-muted-foreground">
            {r.nota.waktu} · {formatRupiah(r.nota.total)}
          </span>
        </span>
      ),
    },
    { label: t("kantor.kolom.alasan"), nilai: r.alasan },
    {
      label: r.status === "DIBATALKAN" ? t("rincian.ditarik") : t("kantor.kolom.diputuskan"),
      nilai: r.langsungBerlaku
        ? t("rincian.langsungBerlaku")
        : r.diputuskan.pada
          ? t("rincian.diputuskan", { oleh: r.diputuskan.oleh ?? "—", pada: r.diputuskan.pada })
          : null,
    },
    {
      label: r.status === "DIBATALKAN" ? t("rincian.alasanTarikLabel") : t("rincian.alasanTolakLabel"),
      nilai: r.status === "DITOLAK" || r.status === "DIBATALKAN" ? r.diputuskan.alasanTolak : null,
    },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/retur-spg">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("rincian.kembali")}
        </Link>
      </Button>

      <PageHeader
        title={
          <span className="flex items-center gap-1">
            {t("rincian.judulToko", { toko: r.toko.nama })}
            <TombolBantuan judul={t("rincian.judul")} />
          </span>
        }
        meta={t("rincian.ringkas", { pcs, docNo: r.nota.docNo })}
        actions={
          menunggu && bolehMemutuskan ? (
            <div className="flex flex-wrap gap-2">
              <TolakDialog returnId={r.id} />
              <SetujuiDialog returnId={r.id} pcs={pcs} keRak={pcsKeRak} terhitung={pcsTerhitung} rusak={pcsRusak} />
            </div>
          ) : null
        }
      />

      {menunggu ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {bolehMemutuskan
            ? t("rincian.menungguBoleh")
            : alasanTidakBoleh === "PELAPOR_SENDIRI"
              ? t("rincian.pelaporSendiri")
              : t("rincian.tanpaIzin")}
        </p>
      ) : null}
      {menunggu && r.peringatan.komisiPutusDicek ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.peringatanKomisi", { bulan })}
        </p>
      ) : null}
      {menunggu && r.peringatan.siklusKonsiTerkunci ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.peringatanKonsi", { bulan })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("rincian.judul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <StatusPill tone={NADA_STATUS_RETUR_PEMBELI[r.status]}>{td(`status.${r.status}`)}</StatusPill>
            <dl className="space-y-3 text-sm">
              {info
                .filter((x) => x.nilai)
                .map((x) => (
                  <div key={x.label} className="space-y-0.5">
                    <dt className="text-xs text-muted-foreground">{x.label}</dt>
                    <dd className="whitespace-pre-line">{x.nilai}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t("rincian.riwayat")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {r.jejak.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rincian.riwayatKosong")}</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {r.jejak.map((j, i) => (
                  <li key={`${j.action}-${i}`} className="space-y-0.5">
                    <p className="font-medium">{auditActionLabel(tAudit, j.action, ENTITAS_RETUR_PEMBELI)}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.oleh} · {j.pada}
                    </p>
                    {j.reason ? <p className="text-xs">{j.reason}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("rincian.barangJudul", { pcs })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kantor.kolom.barang")}</TableHead>
                  <TableHead>{t("rincian.kolom.kondisi")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.qty")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.terjual")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.sudahKembali")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.menungguLain")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.nilai")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.baris.map((b) => (
                  <TableRow key={b.id} className="align-top">
                    <TableCell className="min-w-[14rem] whitespace-normal">
                      <span className="block font-medium">{b.productName}</span>
                      {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                      {menunggu && b.terhitungOpnameSesudah ? (
                        <span className="mt-1 block text-xs text-amber-800 dark:text-amber-300">{t("rincian.terhitungOpname")}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{tKondisi(`kondisi${b.kondisi}`)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{b.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.terjual}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.sudahKembali > 0 ? b.sudahKembali : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.menungguLain > 0 ? b.menungguLain : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(b.nilaiBersih)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold" colSpan={2}>
                    {t("rincian.total")}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{pcs}</TableCell>
                  <TableCell colSpan={3} />
                  <TableCell className="text-right font-semibold tabular-nums">{formatRupiah(nilaiTotal)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function useJalankan() {
  const t = useTranslations("spgReturPembeli");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const jalankan = (aksi: () => Promise<HasilPutusanReturPembeliAksi>, sukses: string, selesai: () => void) =>
    mulai(async () => {
      let h: HasilPutusanReturPembeliAksi;
      try {
        h = await aksi();
      } catch {
        toast.error(t("err.GAGAL"));
        return;
      }
      if (!h.ok) {
        toast.error(td(`err.${h.kode}`));
        router.refresh();
        return;
      }
      toast.success(sukses);
      selesai();
      router.refresh();
    });
  return { t, sibuk, jalankan };
}

function SetujuiDialog({ returnId, pcs, keRak, terhitung, rusak }: { returnId: string; pcs: number; keRak: number; terhitung: number; rusak: number }) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button>
          <Check className="mr-1.5 h-4 w-4" />
          {t("rincian.setujui")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rincian.setujuiJudul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("rincian.setujuiIsi", { layak: keRak, rusak, pcs })}</AlertDialogDescription>
        </AlertDialogHeader>
        {terhitung > 0 ? <p className="text-sm text-muted-foreground">{t("rincian.setujuiOpname", { n: terhitung })}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("rincian.batal")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={sibuk}
            onClick={(e) => {
              e.preventDefault();
              jalankan(() => setujuiReturPembeliAction({ returnId }), t("rincian.okSetujui"), () => setBuka(false));
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {sibuk ? t("rincian.menyimpan") : t("rincian.setujui")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TolakDialog({ returnId }: { returnId: string }) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <X className="mr-1.5 h-4 w-4" />
          {t("rincian.tolak")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rincian.tolakJudul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("rincian.tolakIsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="retur-pembeli-tolak-alasan">{t("rincian.tolakLabel")}</Label>
          <Textarea
            id="retur-pembeli-tolak-alasan"
            value={alasan}
            maxLength={BATAS_ALASAN_RETUR_PEMBELI}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("rincian.batal")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={sibuk || alasan.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              jalankan(() => tolakReturPembeliAction({ returnId, alasan }), t("rincian.okTolak"), () => {
                setBuka(false);
                setAlasan("");
              });
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {sibuk ? t("rincian.menyimpan") : t("rincian.tolakKirim")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
