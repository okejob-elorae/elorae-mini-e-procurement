"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Camera, Check, ExternalLink, History, Loader2, Package, Pencil, RotateCcw, Scale, Wallet, X } from "lucide-react";
import {
  batalkanPenolakanReturPembeliAction,
  putuskanBarangReturPembeliAction,
  setujuiReturPembeliAction,
  tolakReturPembeliAction,
  ubahBesarBebanSpgAction,
  type HasilPutusanReturPembeliAksi,
} from "@/app/actions/retur-spg";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { auditActionLabel } from "@/lib/audit/action-label";
import { formatRupiah } from "@/lib/format/rupiah";
import { dinamis } from "@/lib/i18n/dinamis";
import type { KeadaanBebanSpg, KeputusanBarangBeban } from "@/lib/spg/beban-spg";
import {
  BATAS_ALASAN_RETUR_PEMBELI,
  type KeadaanUangRetur,
  type StatusReturPembeli,
} from "@/lib/spg/retur-pembeli-status";
import type { RincianReturPembeliKantor } from "@/lib/spg/retur-pembeli-queries";
import { NADA_BEBAN_SPG, NADA_STATUS_RETUR_PEMBELI, NADA_UANG_RETUR_PEMBELI } from "../tampilan";

type DuaBahasa = { id: string; en: string };

/** Beban SPG yang sudah diformat di server (tanggal WIB, nama bulan dua bahasa). */
export type BebanReturTampil = {
  spg: string;
  keadaan: KeadaanBebanSpg;
  dihitung: number;
  jumlah: number;
  alasanJumlah: string | null;
  dipotong: number;
  sisa: number;
  potongan: { bulan: DuaBahasa; jumlah: number; dariKomisi: number; dariGaji: number; keUtang: boolean; utangLunas: boolean | null }[];
  barang: { keputusan: KeputusanBarangBeban; oleh: string; pada: string; catatan: string | null } | null;
  kembali: { jumlah: number; mengurangiUtang: number; dibayar: boolean; bulan: DuaBahasa | null } | null;
  dibatalkan: { oleh: string; pada: string; alasan: string | null } | null;
  bisaDibatalkan: boolean;
  bisaDiubah: boolean;
  bisaDiputuskan: boolean;
};

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
  uang: { keadaan: KeadaanUangRetur; pada: string | null; olehKantor: { oleh: string; alasan: string | null } | null };
  foto: { barang: string | null; struk: string | null };
  bebanJikaDitolak: number;
  beban: BebanReturTampil | null;
  baris: RincianReturPembeliKantor["baris"];
  /** Komisi berkurang di bulan nota aslinya (P9); laporan konsinyasi di bulan laporannya (R25). */
  peringatan: { bulanKomisi: DuaBahasa; komisiDitutup: boolean; bulanLaporan: DuaBahasa; siklusKonsiTerkunci: boolean };
  jejak: { action: string; entityType: string; oleh: string; pada: string; reason: string | null }[];
};

export function RincianReturPembeliClient({
  rincian: r,
  bolehMemutuskan,
  alasanTidakBoleh,
}: {
  rincian: RincianReturPembeliTampil;
  /** `spg_returns:approve` DAN bukan pelapornya — pemeriksaan yang sama dengan setiap aksi keputusan dan penulisnya. */
  bolehMemutuskan: boolean;
  alasanTidakBoleh: "PELAPOR_SENDIRI" | "TANPA_IZIN" | null;
}) {
  const t = useTranslations("spgReturPembeli");
  const td = dinamis(t);
  const tKondisi = dinamis(useTranslations("spgRetur"));
  const tAudit = useTranslations("auditActions");
  const locale = useLocale();
  const dua = (x: DuaBahasa) => (locale.startsWith("en") ? x.en : x.id);
  const bulanKomisi = dua(r.peringatan.bulanKomisi);
  const bulanLaporan = dua(r.peringatan.bulanLaporan);

  const menunggu = r.status === "MENUNGGU";
  const pcs = r.baris.reduce((n, b) => n + b.qty, 0);
  const pcsLayak = r.baris.filter((b) => b.kondisi === "LAYAK").reduce((n, b) => n + b.qty, 0);
  const pcsRusak = r.baris.filter((b) => b.kondisi !== "LAYAK").reduce((n, b) => n + b.qty, 0);
  const nilaiTotal = r.baris.reduce((n, b) => n + b.nilaiBersih, 0);
  const uangDicatatSpg = r.uang.pada !== null;

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
      label: t("rincian.uang"),
      nilai: (
        <span className="space-y-1">
          <StatusPill tone={NADA_UANG_RETUR_PEMBELI[r.uang.keadaan]}>{td(`uang.${r.uang.keadaan}`)}</StatusPill>
          {r.uang.pada ? <span className="block text-xs text-muted-foreground">{t("rincian.uangDicatatSpg", { pada: r.uang.pada })}</span> : null}
          {r.uang.olehKantor ? (
            <span className="block text-xs text-muted-foreground">
              {t("rincian.uangDitandaiKantor", { oleh: r.uang.olehKantor.oleh, alasan: r.uang.olehKantor.alasan ?? "—" })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      label: r.status === "DIBATALKAN" ? t("rincian.ditarik") : t("kantor.kolom.diputuskan"),
      nilai: r.diputuskan.pada ? t("rincian.diputuskan", { oleh: r.diputuskan.oleh ?? "—", pada: r.diputuskan.pada }) : null,
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
              <TolakDialog returnId={r.id} pelapor={r.pelapor} uangDicatatSpg={uangDicatatSpg} bebanJikaDitolak={r.bebanJikaDitolak} />
              <SetujuiDialog
                returnId={r.id}
                pcs={pcs}
                layak={pcsLayak}
                rusak={pcsRusak}
                bulanNota={bulanKomisi}
                uangDicatatSpg={uangDicatatSpg}
              />
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
      {menunggu && uangDicatatSpg ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.uangTelanjur")}
        </p>
      ) : null}
      {menunggu && r.peringatan.komisiDitutup ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.peringatanKomisi", { bulan: bulanKomisi })}
        </p>
      ) : null}
      {menunggu && r.peringatan.siklusKonsiTerkunci ? (
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.peringatanKonsi", { bulan: bulanLaporan })}
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
              <Camera className="h-5 w-5" />
              {t("rincian.foto")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Foto label={t("rincian.fotoBarang")} url={r.foto.barang} kosong={t("rincian.fotoTidakAda")} />
            <Foto label={t("rincian.fotoStruk")} url={r.foto.struk} kosong={t("rincian.fotoTidakAda")} />
          </CardContent>
        </Card>
      </div>

      {r.beban ? <KartuBeban returnId={r.id} beban={r.beban} bolehMemutuskan={bolehMemutuskan} dua={dua} /> : null}

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
                  <p className="font-medium">{auditActionLabel(tAudit, j.action, j.entityType)}</p>
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
  );
}

function Foto({ label, url, kosong }: { label: string; url: string | null; kosong: string }) {
  return (
    <figure className="space-y-1.5">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="max-h-72 w-full object-contain" />
        </a>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{kosong}</p>
      )}
    </figure>
  );
}

/** Kartu beban SPG (P13, P78–P82, P79): besar, potongan per pembayaran, sisa, keputusan barang, pengembalian. */
function KartuBeban({
  returnId,
  beban: b,
  bolehMemutuskan,
  dua,
}: {
  returnId: string;
  beban: BebanReturTampil;
  bolehMemutuskan: boolean;
  dua: (x: DuaBahasa) => string;
}) {
  const t = useTranslations("spgReturPembeli");
  const td = dinamis(t);
  const diubah = Math.round(b.jumlah * 100) !== Math.round(b.dihitung * 100);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Wallet className="h-5 w-5" />
          {t("rincian.beban.judul", { spg: b.spg })}
          <StatusPill tone={NADA_BEBAN_SPG[b.keadaan]}>{td(`beban.keadaan.${b.keadaan}`)}</StatusPill>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">{t("rincian.beban.jumlah")}</dt>
            <dd className="font-semibold tabular-nums">{formatRupiah(b.jumlah)}</dd>
            {diubah ? (
              <dd className="text-xs text-muted-foreground">
                {t("rincian.beban.diubah", { dihitung: formatRupiah(b.dihitung), alasan: b.alasanJumlah ?? "—" })}
              </dd>
            ) : null}
          </div>
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">{t("rincian.beban.dipotong")}</dt>
            <dd className="tabular-nums">{formatRupiah(b.dipotong)}</dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">{t("rincian.beban.sisa")}</dt>
            <dd className="tabular-nums">{formatRupiah(b.sisa)}</dd>
          </div>
        </dl>

        {b.potongan.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {b.potongan.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span>
                  {p.keUtang
                    ? t(p.utangLunas ? "rincian.beban.keUtangLunas" : "rincian.beban.keUtang", { bulan: dua(p.bulan) })
                    : t("rincian.beban.potongBulan", { bulan: dua(p.bulan) })}
                </span>
                <span className="tabular-nums">
                  {formatRupiah(p.jumlah)}
                  {!p.keUtang ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("rincian.beban.dariKomisiGaji", { komisi: formatRupiah(p.dariKomisi), gaji: formatRupiah(p.dariGaji) })}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : b.keadaan === "TERBUKA" ? (
          // Hanya beban yang masih berjalan: yang dibatalkan (P82) atau Rp 0 (langsung lunas) tidak akan dipotong.
          <p className="text-muted-foreground">{t("rincian.beban.belumDipotong")}</p>
        ) : null}

        {b.barang ? (
          <p>
            {t("rincian.beban.barangDiputuskan", { keputusan: td(`rincian.beban.opsi.${b.barang.keputusan}`), oleh: b.barang.oleh, pada: b.barang.pada })}
            {b.barang.catatan ? <span className="block text-xs text-muted-foreground">{b.barang.catatan}</span> : null}
          </p>
        ) : null}
        {b.kembali ? (
          <p>
            {b.kembali.dibayar
              ? t("rincian.beban.kembaliDibayar", { jumlah: formatRupiah(b.kembali.jumlah), bulan: b.kembali.bulan ? dua(b.kembali.bulan) : "—" })
              : t("rincian.beban.kembaliMenunggu", { jumlah: formatRupiah(b.kembali.jumlah) })}
            {b.kembali.mengurangiUtang > 0 ? (
              <span className="block text-xs text-muted-foreground">
                {t("rincian.beban.kembaliKeUtang", { jumlah: formatRupiah(b.kembali.mengurangiUtang) })}
              </span>
            ) : null}
          </p>
        ) : null}
        {b.dibatalkan ? (
          <p className="text-muted-foreground">
            {t("rincian.beban.dibatalkanOleh", { oleh: b.dibatalkan.oleh, pada: b.dibatalkan.pada, alasan: b.dibatalkan.alasan ?? "—" })}
          </p>
        ) : null}

        {bolehMemutuskan && (b.bisaDibatalkan || b.bisaDiubah || b.bisaDiputuskan) ? (
          <div className="flex flex-wrap gap-2">
            {b.bisaDiputuskan ? <PutuskanBarangDialog returnId={returnId} jumlah={b.dipotong} /> : null}
            {b.bisaDiubah ? <UbahBesarDialog returnId={returnId} jumlah={b.jumlah} /> : null}
            {b.bisaDibatalkan ? <BatalkanPenolakanDialog returnId={returnId} jumlah={b.jumlah} /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
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
        toast.error(t.has(`err.${h.kode}`) ? td(`err.${h.kode}`) : t("err.GAGAL"));
        router.refresh();
        return;
      }
      toast.success(sukses);
      selesai();
      router.refresh();
    });
  return { t, sibuk, jalankan };
}

function SetujuiDialog({
  returnId,
  pcs,
  layak,
  rusak,
  bulanNota,
  uangDicatatSpg,
}: {
  returnId: string;
  pcs: number;
  layak: number;
  rusak: number;
  /** Bulan nota asli, sudah dalam bahasa layar — bulan komisi yang berkurang (P9). */
  bulanNota: string;
  uangDicatatSpg: boolean;
}) {
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
          <AlertDialogDescription>{t("rincian.setujuiIsi", { layak, rusak, pcs, bulanNota })}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-muted-foreground">{uangDicatatSpg ? t("rincian.setujuiUangSudah") : t("rincian.setujuiUangBelum")}</p>
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

/** Angka rupiah dari isian (kosong → null). Titik/koma ribuan tidak diterima — ketik angkanya saja. */
const bacaAngka = (s: string): number | null => {
  const x = s.trim();
  if (!x) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : NaN;
};

function TolakDialog({
  returnId,
  pelapor,
  uangDicatatSpg,
  bebanJikaDitolak,
}: {
  returnId: string;
  pelapor: string;
  uangDicatatSpg: boolean;
  bebanJikaDitolak: number;
}) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [tandai, setTandai] = useState(false);
  const [alasanTanda, setAlasanTanda] = useState("");
  const [besar, setBesar] = useState("");
  const [alasanBesar, setAlasanBesar] = useState("");
  const dibebankan = uangDicatatSpg || tandai;
  const angka = bacaAngka(besar);
  const berbeda = angka !== null && Math.round((angka || 0) * 100) !== Math.round(bebanJikaDitolak * 100);
  const kurang = sibuk
    ? null
    : alasan.trim() === ""
      ? t("rincian.kurangAlasanTolak")
      : tandai && alasanTanda.trim() === ""
        ? t("rincian.kurangAlasanUang")
        : dibebankan && angka !== null && !(angka > 0)
          ? t("err.BESAR_BEBAN_TIDAK_VALID")
          : dibebankan && berbeda && alasanBesar.trim() === ""
            ? t("rincian.kurangAlasanBesar")
            : null;
  const reset = () => {
    setAlasan("");
    setTandai(false);
    setAlasanTanda("");
    setBesar("");
    setAlasanBesar("");
  };
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
          <AlertDialogDescription>{dibebankan ? t("rincian.tolakIsiBeban") : t("rincian.tolakIsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4">
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
          {!uangDicatatSpg ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Checkbox id="retur-pembeli-tandai-uang" checked={tandai} onCheckedChange={(v) => setTandai(v === true)} disabled={sibuk} />
                <Label htmlFor="retur-pembeli-tandai-uang" className="leading-snug">
                  {t("rincian.tolakUangTernyata")}
                </Label>
              </div>
              {tandai ? (
                <div className="space-y-1.5">
                  <Label htmlFor="retur-pembeli-tandai-alasan">{t("rincian.tolakUangAlasan")}</Label>
                  <Textarea
                    id="retur-pembeli-tandai-alasan"
                    value={alasanTanda}
                    maxLength={BATAS_ALASAN_RETUR_PEMBELI}
                    onChange={(e) => setAlasanTanda(e.target.value)}
                    placeholder={t("rincian.tolakUangAlasanContoh")}
                    rows={2}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          {dibebankan ? (
            <div className="space-y-3 rounded-lg bg-destructive/10 p-3 text-sm">
              <p className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t("rincian.tolakBeban", { spg: pelapor, jumlah: formatRupiah(angka !== null && angka > 0 ? angka : bebanJikaDitolak) })}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="retur-pembeli-besar">{t("rincian.besarBeban")}</Label>
                <Input
                  id="retur-pembeli-besar"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={besar}
                  placeholder={String(bebanJikaDitolak)}
                  onChange={(e) => setBesar(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("rincian.besarBebanKet", { dihitung: formatRupiah(bebanJikaDitolak) })}</p>
              </div>
              {berbeda ? (
                <div className="space-y-1.5">
                  <Label htmlFor="retur-pembeli-besar-alasan">{t("rincian.alasanBesarBeban")}</Label>
                  <Textarea
                    id="retur-pembeli-besar-alasan"
                    value={alasanBesar}
                    maxLength={BATAS_ALASAN_RETUR_PEMBELI}
                    onChange={(e) => setAlasanBesar(e.target.value)}
                    rows={2}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("rincian.tanpaKreditToko")}</p>
        </div>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel disabled={sibuk}>{t("rincian.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={sibuk || kurang !== null}
              onClick={(e) => {
                e.preventDefault();
                jalankan(
                  () =>
                    tolakReturPembeliAction({
                      returnId,
                      alasan,
                      uangTernyataDikembalikan: !uangDicatatSpg && tandai,
                      ...(tandai ? { alasanUangKembali: alasanTanda } : {}),
                      ...(dibebankan && angka !== null ? { besarBeban: angka } : {}),
                      ...(dibebankan && berbeda ? { alasanBesarBeban: alasanBesar } : {}),
                    }),
                  t("rincian.okTolak"),
                  () => {
                    setBuka(false);
                    reset();
                  },
                );
              }}
            >
              {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {sibuk ? t("rincian.menyimpan") : t("rincian.tolakKirim")}
            </AlertDialogAction>
          </div>
          {kurang ? <p className="text-right text-xs text-muted-foreground">{kurang}</p> : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BatalkanPenolakanDialog({ returnId, jumlah }: { returnId: string; jumlah: number }) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          {t("rincian.batalkanPenolakan")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rincian.batalkanPenolakanJudul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("rincian.batalkanPenolakanIsi", { jumlah: formatRupiah(jumlah) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="retur-pembeli-batal-alasan">{t("rincian.batalkanPenolakanAlasan")}</Label>
          <Textarea
            id="retur-pembeli-batal-alasan"
            value={alasan}
            maxLength={BATAS_ALASAN_RETUR_PEMBELI}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("rincian.batal")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={sibuk || alasan.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              jalankan(() => batalkanPenolakanReturPembeliAction({ returnId, alasan }), t("rincian.okBatalkanPenolakan"), () => {
                setBuka(false);
                setAlasan("");
              });
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {sibuk ? t("rincian.menyimpan") : t("rincian.batalkanPenolakan")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UbahBesarDialog({ returnId, jumlah }: { returnId: string; jumlah: number }) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  const [besar, setBesar] = useState("");
  const [alasan, setAlasan] = useState("");
  const angka = bacaAngka(besar);
  const sah = angka !== null && angka > 0 && Math.round(angka * 100) !== Math.round(jumlah * 100);
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <Pencil className="mr-1.5 h-4 w-4" />
          {t("rincian.ubahBesarBeban")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rincian.ubahBesarBebanJudul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("rincian.ubahBesarBebanIsi", { jumlah: formatRupiah(jumlah) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="retur-pembeli-ubah-besar">{t("rincian.besarBeban")}</Label>
            <Input
              id="retur-pembeli-ubah-besar"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={besar}
              onChange={(e) => setBesar(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="retur-pembeli-ubah-alasan">{t("rincian.alasanBesarBeban")}</Label>
            <Textarea
              id="retur-pembeli-ubah-alasan"
              value={alasan}
              maxLength={BATAS_ALASAN_RETUR_PEMBELI}
              onChange={(e) => setAlasan(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("rincian.batal")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={sibuk || !sah || alasan.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              if (angka === null) return;
              jalankan(() => ubahBesarBebanSpgAction({ returnId, besar: angka, alasan }), t("rincian.okUbahBesarBeban"), () => {
                setBuka(false);
                setBesar("");
                setAlasan("");
              });
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {sibuk ? t("rincian.menyimpan") : t("rincian.ubahBesarBeban")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PutuskanBarangDialog({ returnId, jumlah }: { returnId: string; jumlah: number }) {
  const { t, sibuk, jalankan } = useJalankan();
  const td = dinamis(t);
  const [buka, setBuka] = useState(false);
  const [keputusan, setKeputusan] = useState<KeputusanBarangBeban | null>(null);
  const [catatan, setCatatan] = useState("");
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button>
          <Scale className="mr-1.5 h-4 w-4" />
          {t("rincian.putuskanBarang")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("rincian.putuskanBarangJudul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("rincian.putuskanBarangIsi", { jumlah: formatRupiah(jumlah) })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2" role="radiogroup" aria-label={t("rincian.putuskanBarang")}>
            {(["KEMBALI_STOK", "DIBELI_SPG"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                role="radio"
                aria-checked={keputusan === k}
                variant={keputusan === k ? "default" : "outline"}
                className="h-auto flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
                disabled={sibuk}
                onClick={() => setKeputusan(k)}
              >
                <span className="font-medium">{td(`rincian.beban.opsi.${k}`)}</span>
                <span className="text-xs font-normal opacity-80">{td(`rincian.beban.opsiKet.${k}`)}</span>
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="retur-pembeli-putus-catatan">{t("rincian.putuskanBarangCatatan")}</Label>
            <Textarea
              id="retur-pembeli-putus-catatan"
              value={catatan}
              maxLength={BATAS_ALASAN_RETUR_PEMBELI}
              onChange={(e) => setCatatan(e.target.value)}
              rows={2}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("rincian.putuskanBarangSekali")}</p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("rincian.batal")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={sibuk || keputusan === null}
            onClick={(e) => {
              e.preventDefault();
              if (!keputusan) return;
              jalankan(
                () => putuskanBarangReturPembeliAction({ returnId, keputusan, ...(catatan.trim() ? { catatan } : {}) }),
                t("rincian.okPutuskanBarang"),
                () => {
                  setBuka(false);
                  setKeputusan(null);
                  setCatatan("");
                },
              );
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {sibuk ? t("rincian.menyimpan") : t("rincian.putuskanBarang")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
