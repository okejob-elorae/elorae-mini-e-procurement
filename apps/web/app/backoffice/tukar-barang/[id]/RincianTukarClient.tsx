"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, History, Printer, Scale } from "lucide-react";
import { logPrint } from "@/app/actions/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { buatSuratTukarHtml } from "@/lib/print/tukar-barang-html";
import { formatIDR } from "@/lib/sales-orders/format";
import { periksaNilaiTukar } from "@/lib/salesman/tukar-barang";
import type { BarisRincianTukar, RincianTukar } from "@/lib/salesman/tukar-queries";
import { cn } from "@/lib/utils";
import { nadaStatusTukar } from "@/app/pwa/tukar/tampilan";
import { TombolKeputusanTukar } from "./TombolKeputusanTukar";

/** Cetak lewat iframe tersembunyi — pola yang sama dengan surat keluar konsinyasi. */
function cetakHtml(html: string, judul: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("style", "position:absolute;width:0;height:0;border:0;visibility:hidden;");
  iframe.setAttribute("title", judul);
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => iframe.contentWindow?.print(), 350);
  }
  setTimeout(() => document.body.removeChild(iframe), 60_000);
}

export function RincianTukarClient({
  rincian: r,
  bolehSetujui,
  bolehSelesaikan,
  milikSendiri,
}: {
  rincian: RincianTukar;
  bolehSetujui: boolean;
  bolehSelesaikan: boolean;
  /** Dokumen milik orang yang sedang membuka — server menolak ia memutuskannya. */
  milikSendiri: boolean;
}) {
  const t = useTranslations("tukarBarang");
  const td = dinamis(t);
  const masuk = r.baris.filter((b) => b.direction === "MASUK");
  const keluar = r.baris.filter((b) => b.direction === "KELUAR");
  const setara = r.nilai ? periksaNilaiTukar(r.nilai).ok : false;
  const terbuka = r.status === "DIAJUKAN" || r.status === "DISETUJUI";

  const cetak = async () => {
    await logPrint("StoreExchange", r.id);
    const html = buatSuratTukarHtml({
      docNo: r.docNo,
      dibuatIso: r.dibuatIso,
      selesaiIso: r.selesaiIso,
      status: td(`status.${r.status}`),
      toko: { nama: r.toko.nama, kode: r.toko.kode, alamat: r.toko.alamat },
      salesman: r.salesman,
      catatan: r.catatan,
      masuk: masuk.map((b) => ({ nama: b.nama, qty: b.qty })),
      keluar: keluar.map((b) => ({ nama: b.nama, qty: b.qty })),
      ringkasNilai: r.nilai ? `${formatIDR(r.nilai.masuk)} ↔ ${formatIDR(r.nilai.keluar)}` : null,
      label: {
        judul: t("cetak.judul"),
        terbit: t("cetak.terbit"),
        nomor: t("cetak.nomor"),
        tanggal: t("cetak.tanggal"),
        selesai: t("cetak.selesai"),
        status: t("cetak.status"),
        toko: t("cetak.toko"),
        salesman: t("cetak.salesman"),
        catatan: t("cetak.catatan"),
        masuk: t("cetak.masuk"),
        keluar: t("cetak.keluar"),
        no: t("cetak.no"),
        barang: t("cetak.barang"),
        qty: t("cetak.qty"),
        total: t("cetak.total"),
        netral: t("cetak.netral"),
        nilai: t("cetak.nilai"),
        ttdToko: t("cetak.ttdToko"),
        ttdSalesman: t("cetak.ttdSalesman"),
        ttdGudang: t("cetak.ttdGudang"),
      },
    });
    cetakHtml(html, t("cetak.judul"));
  };

  const info: { label: string; nilai: string | null; merah?: boolean }[] = [
    { label: t("kolom.toko"), nilai: `${r.toko.nama} (${r.toko.kode})` },
    { label: t("kolom.alamat"), nilai: r.toko.alamat || null },
    { label: t("kolom.salesman"), nilai: r.salesman },
    { label: t("kolom.diajukan"), nilai: r.dibuat },
    { label: t("kolom.catatan"), nilai: r.catatan },
    { label: t("kolom.diputuskanOleh"), nilai: r.diputuskanOleh ? `${r.diputuskanOleh} · ${r.diputuskanPada ?? ""}` : null },
    {
      label: r.status === "DITOLAK" || r.status === "DIBATALKAN" ? t("kolom.alasan") : t("kolom.catatanKeputusan"),
      nilai: r.catatanKeputusan,
      merah: r.status === "DITOLAK" || r.status === "DIBATALKAN",
    },
    { label: t("kolom.selesai"), nilai: r.selesaiPada },
  ];

  const tabel = (judul: string, ikon: "MASUK" | "KELUAR", isi: BarisRincianTukar[]) => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {ikon === "MASUK" ? <ArrowDownToLine className="h-5 w-5" /> : <ArrowUpFromLine className="h-5 w-5" />}
          {judul}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolom.barang")}</TableHead>
                <TableHead className="text-right">{t("kolom.qty")}</TableHead>
                <TableHead className="text-right">{t("kolom.harga")}</TableHead>
                <TableHead className="text-right">{t("kolom.nilai")}</TableHead>
                {ikon === "KELUAR" && terbuka ? <TableHead className="text-right">{t("kolom.stok")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isi.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="min-w-[14rem] whitespace-normal font-medium">{b.nama}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.harga ? formatIDR(b.harga) : t("hargaBelumDiset")}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.nilai != null ? formatIDR(b.nilai) : "—"}</TableCell>
                  {ikon === "KELUAR" && terbuka ? (
                    <TableCell
                      className={cn("text-right tabular-nums", (b.tersedia ?? 0) < b.qty && "font-medium text-destructive")}
                    >
                      {b.tersedia ?? 0}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/tukar-barang">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("kembaliDaftar")}
        </Link>
      </Button>

      <PageHeader
        title={r.docNo}
        description={t("rincianDeskripsi", { toko: r.toko.nama, salesman: r.salesman })}
        actions={
          <span className="inline-flex flex-wrap gap-2">
            <TombolKeputusanTukar
              id={r.id}
              status={r.status}
              docNo={r.docNo}
              bolehSetujui={bolehSetujui}
              bolehSelesaikan={bolehSelesaikan}
              milikSendiri={milikSendiri}
            />
            <Button variant="outline" onClick={() => void cetak()}>
              <Printer className="h-4 w-4" />
              {t("cetakSurat")}
            </Button>
          </span>
        }
      />

      {milikSendiri && terbuka ? <p className="text-sm text-muted-foreground">{t("milikSendiri")}</p> : null}

      {terbuka && r.kurang.length > 0 ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("stokKurangPeringatan", {
            baris: r.kurang.map((k) => t("kurangBaris", { nama: k.nama, tersedia: k.tersedia, butuh: k.butuh })).join(", "),
          })}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("rincianJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-sm font-medium", nadaStatusTukar(r.status))}>
              {td(`status.${r.status}`)}
            </span>
            <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              {info
                .filter((b) => b.nilai)
                .map((b) => (
                  <div key={b.label} className="contents">
                    <dt className="text-muted-foreground">{b.label}</dt>
                    <dd className={cn("whitespace-pre-wrap", b.merah && "text-destructive")}>{b.nilai}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              {t("nilaiJudul")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {r.nilai ? (
              <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("nilaiMasuk")}</dt>
                <dd className="font-semibold tabular-nums">{formatIDR(r.nilai.masuk)}</dd>
                <dt className="text-muted-foreground">{t("nilaiKeluar")}</dt>
                <dd className="font-semibold tabular-nums">{formatIDR(r.nilai.keluar)}</dd>
                <dt className="text-muted-foreground">{t("selisih")}</dt>
                <dd className={cn("font-semibold tabular-nums", setara ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
                  {setara ? t("setara") : formatIDR(r.nilai.selisih)}
                </dd>
              </dl>
            ) : (
              <p className="text-sm text-destructive">{t("hargaKosong")}</p>
            )}
            <p className="text-xs text-muted-foreground">{terbuka && r.nilai && !setara ? t("nilaiBerubah") : t("bukanRetur")}</p>
          </CardContent>
        </Card>
      </div>

      {tabel(t("masukJudul"), "MASUK", masuk)}
      {tabel(t("keluarJudul"), "KELUAR", keluar)}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t("jejakJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {r.jejak.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("jejakKosong")}</p>
          ) : (
            <ol className="space-y-3">
              {r.jejak.map((j) => (
                <li key={j.id} className="border-l-2 border-muted pl-3 text-sm">
                  <span className="block font-medium">{td(`jejak.${j.aksi}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {j.oleh} · {j.pada}
                  </span>
                  {j.alasan ? <span className="mt-0.5 block text-xs">{j.alasan}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
