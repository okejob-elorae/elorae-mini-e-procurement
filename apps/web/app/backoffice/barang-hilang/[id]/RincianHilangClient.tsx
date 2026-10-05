"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, ExternalLink, History, Package, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auditActionLabel } from "@/lib/audit/action-label";
import { dinamis } from "@/lib/i18n/dinamis";
import { keSen } from "@/lib/spg/hilang";
import type { RincianHilangKantor } from "@/lib/spg/hilang-queries";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";
import { nadaPenanggung, nadaStatusHilang } from "../tampilan";
import { KeputusanHilangDialog } from "./KeputusanHilangDialog";
import { BatalkanHilang, TandaiTokoDitagih } from "./TombolHilangKantor";

type Orang = { spg: { id: string; nama: string; toko: string | null }[]; sales: { id: string; nama: string }[] };

export function RincianHilangClient({
  rincian: r,
  bolehKelola,
  orang,
}: {
  rincian: RincianHilangKantor;
  bolehKelola: boolean;
  orang: Orang;
}) {
  const t = useTranslations("barangHilang");
  const td = dinamis(t);
  const tAudit = useTranslations("auditActions");

  const bisaPutuskan = bolehKelola && r.status === "TERBUKA";
  const bisaUbah = bolehKelola && (r.status === "DITETAPKAN" || r.status === "SELESAI") && !r.terkunci;
  const bisaBatal = bolehKelola && r.status !== "DIBATALKAN" && !r.terkunci;
  const totalDiubah = keSen(r.total) !== keSen(r.nilaiBarang);
  // Bagian SPG/sales yang sudah dikurangi keringanan diskon pegawai (dari jejak keputusannya).
  const diringankan = (b: { bearer: string; orang: { id: string } | null }) =>
    r.keringanan?.perOrang.find((p) => p.bearer === b.bearer && p.bearerUserId === (b.orang?.id ?? null)) ?? null;
  const judul = r.toko ? t("rincian.judulToko", { toko: r.toko.name }) : t("rincian.judul");

  const info: { label: string; nilai: ReactNode | null }[] = [
    {
      label: t("rincian.sumber"),
      nilai: (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{td(`sumber.${r.sumber}`)}</span>
          {r.sourceDocNo ? <span className="text-muted-foreground">{r.sourceDocNo}</span> : null}
          {r.tautanSumber ? (
            <Link href={r.tautanSumber} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
              {t("rincian.bukaSumber")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      label: t("rincian.toko"),
      nilai: r.toko ? `${r.toko.name} · ${td(`syarat.${r.toko.termsType}`)}` : t("tanpaToko"),
    },
    {
      label: t("rincian.orangToko"),
      nilai: r.toko
        ? [
            r.toko.spg.length > 0 ? t("rincian.spgToko", { nama: r.toko.spg.map((s) => s.nama).join(", ") }) : t("rincian.tanpaSpg"),
            r.toko.pemegang ? t("rincian.pemegangToko", { nama: r.toko.pemegang.nama }) : t("rincian.tanpaPemegang"),
          ].join(" · ")
        : null,
    },
    { label: t("rincian.dibuka"), nilai: `${r.dibuatOleh} · ${r.dibuat}` },
    { label: t("rincian.catatan"), nilai: r.catatan },
    { label: t("rincian.dasarNilai"), nilai: td(`dasar.${r.dasarNilai}`) },
    {
      label: r.status === "DIBATALKAN" ? t("rincian.dibatalkan") : t("rincian.diputuskan"),
      nilai: r.keputusan ? `${r.keputusan.oleh} · ${r.keputusan.pada}` : null,
    },
    { label: r.status === "DIBATALKAN" ? t("rincian.alasanBatal") : t("rincian.catatanKeputusan"), nilai: r.keputusan?.catatan ?? null },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/backoffice/barang-hilang">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          {t("rincian.kembali")}
        </Link>
      </Button>

      <PageHeader
        title={judul}
        meta={t("rincian.deskripsi", { pcs: r.totalQty, nilai: formatIDR(r.total) })}
        actions={
          bolehKelola ? (
            <div className="flex flex-wrap gap-2">
              {bisaPutuskan ? <KeputusanHilangDialog rincian={r} orang={orang} mode="PUTUSKAN" /> : null}
              {bisaUbah ? <KeputusanHilangDialog rincian={r} orang={orang} mode="UBAH" /> : null}
              {bisaBatal ? <BatalkanHilang lossId={r.id} /> : null}
            </div>
          ) : null
        }
      />

      {r.status === "TERBUKA" ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {bolehKelola ? t("rincian.menungguKelola") : t("rincian.menungguLihat")}
        </p>
      ) : null}
      {r.adaBarisTanpaNilai && r.status === "TERBUKA" ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("rincian.adaTanpaNilai")}
        </p>
      ) : null}
      {r.terkunci && r.status !== "DIBATALKAN" ? <p className="text-sm text-muted-foreground">{t("rincian.terkunci")}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{t("rincian.rincianJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-sm font-medium", nadaStatusHilang(r.status))}>{td(`status.${r.status}`)}</span>
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
            {r.riwayat.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("rincian.riwayatKosong")}</p>
            ) : (
              <ol className="space-y-3 text-sm">
                {r.riwayat.map((j) => (
                  <li key={j.id} className="space-y-0.5">
                    <p className="font-medium">{auditActionLabel(tAudit, j.action, "StockLoss")}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.oleh} · {j.pada}
                    </p>
                    {j.alasan ? <p className="text-xs">{j.alasan}</p> : null}
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
            {t("rincian.barangJudul", { baris: r.baris.length, pcs: r.totalQty })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rincian.kolom.barang")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.qty")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.satuan")}</TableHead>
                  <TableHead className="text-right">{t("rincian.kolom.nilai")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.baris.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="min-w-[14rem] whitespace-normal">
                      <span className="block font-medium">{b.productName}</span>
                      {b.variantSku ? <span className="block text-xs text-muted-foreground">{b.variantSku}</span> : null}
                      {b.tanpaNilai ? <span className="mt-0.5 inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300">{t("rincian.tanpaNilai")}</span> : null}
                      {!b.tanpaNilai && b.hargaCadangan ? (
                        <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("rincian.hargaCadangan")}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.qty}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(b.nilaiSatuan)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(b.nilai)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">{t("rincian.nilaiBarang")}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{r.totalQty}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">{formatIDR(r.nilaiBarang)}</TableCell>
                </TableRow>
                {totalDiubah ? (
                  <TableRow>
                    <TableCell className="font-semibold">{t("rincian.totalDitetapkan")}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">{formatIDR(r.total)}</TableCell>
                  </TableRow>
                ) : null}
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      {r.bagian.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("rincian.bagianJudul")}
            </CardTitle>
            {r.keringanan ? (
              <p className="text-sm text-muted-foreground">
                {t("rincian.keringanan", { persen: r.keringanan.persen, nilai: formatIDR(r.keringanan.diserap) })}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rincian.kolom.penanggung")}</TableHead>
                    <TableHead className="text-right">{t("rincian.kolom.bagian")}</TableHead>
                    <TableHead className="text-right">{t("rincian.kolom.dipotong")}</TableHead>
                    <TableHead className="text-right">{t("rincian.kolom.sisa")}</TableHead>
                    <TableHead>{t("rincian.kolom.pelunasan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.bagian.map((b) => (
                    <TableRow key={b.id} className="align-top">
                      <TableCell className="min-w-[12rem] whitespace-normal">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaPenanggung(b.bearer))}>{td(`penanggung.${b.bearer}`)}</span>
                        <span className="mt-1 block font-medium">{b.orang?.nama ?? (b.bearer === "TOKO" ? r.toko?.name : t("rincian.elorae"))}</span>
                        {diringankan(b) ? (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {t("rincian.bagianDiringankan", { persen: r.keringanan?.persen ?? 0, nilai: formatIDR(diringankan(b)?.sebelum ?? 0) })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(b.nilai)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(b.dipotong)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", b.sisa > 0 && "font-medium")}>{formatIDR(b.sisa)}</TableCell>
                      <TableCell className="min-w-[16rem] space-y-1.5 whitespace-normal text-sm">
                        {b.lunas ? (
                          <p className="text-emerald-700 dark:text-emerald-400">
                            {t("rincian.lunasPada", { pada: b.lunasPada ?? "—" })}
                            {b.catatanLunas ? <span className="block text-xs text-muted-foreground">{b.catatanLunas}</span> : null}
                          </p>
                        ) : (
                          <p className="text-muted-foreground">{td(`caraLunas.${b.bearer === "TOKO" && r.toko?.termsType === "KONSI" ? "TOKO_KONSI" : b.bearer}`)}</p>
                        )}
                        {b.potongan.length > 0 ? (
                          <ul className="space-y-0.5 text-xs text-muted-foreground">
                            {b.potongan.map((p) => (
                              <li key={p.id}>
                                {t("rincian.potonganBaris", { jumlah: formatIDR(p.jumlah), pada: p.pada, oleh: p.oleh, dari: td(`ref.${refKunci(p.refType)}`) })}
                                {p.catatan ? ` — ${p.catatan}` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {bolehKelola && !b.lunas && b.bearer === "TOKO" && r.status === "DITETAPKAN" && r.toko?.termsType !== "KONSI" ? (
                          <TandaiTokoDitagih shareId={b.id} />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

const REF_DIKENAL = ["ConsignmentCycle", "TagihanTokoManual", "KomisiSalesman", "SpgCommission", "ConsignmentCommission"];
const refKunci = (refType: string) => (REF_DIKENAL.includes(refType) ? refType : "LAIN");
