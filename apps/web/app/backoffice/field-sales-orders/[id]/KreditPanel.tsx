"use client";

import Link from "next/link";
import { tautanPiutangFaktur } from "./tautan-penagihan";
import { useTranslations } from "next-intl";
import { CreditCard } from "lucide-react";
import type { PanelKredit } from "@/lib/field-sales/kredit-panel";
import type { FakturKreditTampil } from "./tautan-pesanan";
import type { AlasanKredit, TingkatKredit } from "@/lib/salesman/kredit";
import { formatIDR } from "@/lib/sales-orders/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type T = ReturnType<typeof useTranslations>;

function teksAlasan(a: AlasanKredit, t: T): string {
  switch (a.kode) {
    case "LEWAT_JANJI":
      return t("alasanLewatJanji", { nilai: formatIDR(a.nilai), faktur: a.faktur });
    case "MELEBIHI_BATAS_NILAI":
      return t("alasanBatasNilai", { sisa: formatIDR(a.sisaSesudah), batas: formatIDR(a.batas) });
    case "MELEBIHI_BATAS_FAKTUR":
      return t("alasanBatasFaktur", { faktur: a.faktur, batas: a.batas });
  }
}

const KELAS_TINGKAT: Record<TingkatKredit, string> = {
  AMAN: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  PERINGATAN: "border-amber-500/50 text-amber-700 dark:text-amber-400",
  TAHAN: "border-destructive/50 text-destructive",
  BLOKIR: "border-destructive/50 text-destructive",
};

const KUNCI_TINGKAT: Record<TingkatKredit, "tingkatAman" | "tingkatPeringatan" | "tingkatTahan" | "tingkatBlokir"> = {
  AMAN: "tingkatAman",
  PERINGATAN: "tingkatPeringatan",
  TAHAN: "tingkatTahan",
  BLOKIR: "tingkatBlokir",
};

/**
 * Kredit toko pada pesanan PUTUS: keadaan yang DIBEKUKAN saat pesanan dibuat
 * berdampingan dengan tagihan toko sekarang, supaya penyetuju melihat apakah
 * toko sudah membayar (atau makin menunggak) sejak salesman mengambil pesanan.
 */
export function KreditPanel({
  kredit,
  fakturTampil = null,
  menunggu,
  bolehBukaPiutang = false,
}: {
  kredit: PanelKredit;
  /** Faktur dengan janji bayar + keadaan per jatuh tempo; null = tidak termuat (kolom lama). */
  fakturTampil?: FakturKreditTampil[] | null;
  menunggu: boolean;
  /** Nomor faktur menjadi tautan ke daftar piutang (tersaring keadaannya) bila boleh membacanya. */
  bolehBukaPiutang?: boolean;
}) {
  const t = useTranslations("fieldSalesOrders.kredit");
  const { sekarang } = kredit;
  const lengkap = fakturTampil !== null;

  return (
    <Card className={cn(kredit.ditahan && menunggu && "border-destructive/50")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CreditCard className="h-5 w-5" />
          {t("judul")}
          {kredit.ditahan && menunggu && <Badge variant="destructive">{t("lencanaDitahan")}</Badge>}
        </CardTitle>
        <CardDescription>{t("aturan", { mode: t(`mode${kredit.mode}`) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {kredit.ditahan && menunggu && <p className="text-destructive">{t("ditahanPenjelasan")}</p>}

        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("saatDibuat")}</div>
          <p className={cn(!kredit.catatan && "text-muted-foreground")}>{kredit.catatan ?? t("saatDibuatAman")}</p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("sekarang")}</span>
            {sekarang && (
              <Badge variant="outline" className={KELAS_TINGKAT[sekarang.tingkat]}>
                {t(KUNCI_TINGKAT[sekarang.tingkat])}
              </Badge>
            )}
          </div>
          {!sekarang ? (
            <p className="text-destructive">{t("takTerbaca")}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("sisa")}</dt>
                  <dd className="font-medium tabular-nums">{formatIDR(sekarang.keadaan.sisa)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("lewatJanji")}</dt>
                  <dd className={cn("font-medium tabular-nums", sekarang.keadaan.lewatJanji > 0 && "text-destructive")}>
                    {formatIDR(sekarang.keadaan.lewatJanji)}
                    {sekarang.keadaan.fakturLewatJanji > 0 && (
                      <span className="ml-1 text-xs font-normal">({t("jumlahFaktur", { n: sekarang.keadaan.fakturLewatJanji })})</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("fakturTerbuka")}</dt>
                  <dd className="font-medium tabular-nums">
                    {kredit.batasFaktur === null
                      ? sekarang.keadaan.fakturTerbuka
                      : t("dariBatas", { nilai: sekarang.keadaan.fakturTerbuka, batas: kredit.batasFaktur })}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("batasNilai")}</dt>
                  <dd className="font-medium tabular-nums">
                    {kredit.batasNilai === null ? t("tanpaBatas") : formatIDR(kredit.batasNilai)}
                  </dd>
                </div>
              </dl>
              {sekarang.nilaiPesanan > 0 && (
                <p className="text-xs text-muted-foreground">{t("termasukPesanan", { nilai: formatIDR(sekarang.nilaiPesanan) })}</p>
              )}
              {sekarang.alasan.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5">
                  {sekarang.alasan.map((a) => (
                    <li key={a.kode}>{teksAlasan(a, t)}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {kredit.faktur.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t("fakturJudul")}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolomFaktur")}</TableHead>
                  <TableHead>{t("kolomJatuhTempo")}</TableHead>
                  {lengkap && <TableHead>{t("kolomJanji")}</TableHead>}
                  <TableHead className="text-right">{t("kolomSisa")}</TableHead>
                  <TableHead>{t("kolomKeadaan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lengkap
                  ? fakturTampil.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">
                          {bolehBukaPiutang && f.keadaanPiutang ? (
                            <Link
                              href={tautanPiutangFaktur(f.invoiceNo)}
                              className="underline underline-offset-2"
                              title={t("bukaPiutang")}
                            >
                              {f.invoiceNo}
                            </Link>
                          ) : (
                            f.invoiceNo
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{f.jatuhTempo}</TableCell>
                        <TableCell className="whitespace-nowrap">{f.janjiBayar ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatIDR(f.sisa)}</TableCell>
                        <TableCell>
                          {f.keadaanTampil.jenis === "LEWAT_JANJI" ? (
                            <Badge variant="outline" className="border-destructive/50 text-destructive">
                              {t("lewatJanjiHari", { hari: f.keadaanTampil.hari })}
                            </Badge>
                          ) : f.keadaanTampil.jenis === "LEWAT_TEMPO" ? (
                            <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
                              {t("lewatTempoHari", { hari: f.keadaanTampil.hari })}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">{t("belumJatuhTempo")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  : kredit.faktur.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">{f.invoiceNo}</TableCell>
                        <TableCell>{f.jatuhTempo}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatIDR(f.sisa)}</TableCell>
                        <TableCell>
                          {f.lewat ? (
                            <Badge variant="outline" className="border-destructive/50 text-destructive">
                              {f.hariTerlambat ? t("lewatJanjiHari", { hari: f.hariTerlambat }) : t("lencanaLewat")}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">{t("belumLewat")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
            {kredit.fakturLainnya > 0 && (
              <p className="text-xs text-muted-foreground">{t("fakturLainnya", { n: kredit.fakturLainnya })}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
