"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, CircleCheck, Loader2, RefreshCw, Scale } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  postingSemuaJurnalLapanganAction,
  postingUlangJurnalLapanganAction,
  selaraskanJurnalTokoAction,
  type HasilMassalAksi,
} from "@/app/actions/finance-lapangan";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import type { SumberLapangan } from "@/lib/finance/lapangan/aturan";
import type { RekonsiliasiPiutang } from "@/lib/finance/lapangan/rekonsiliasi";
import { journalSourceLabel } from "../journals/journal-source-label";
import { tautanBukuBesar } from "../journals/_sumber/tautan";
import { kunciSebab, perluPemetaanAkun } from "../journals/_tertunda/sebab";

/** Satu dokumen yang perlu tindakan: jurnalnya tertunda (bersebab) atau belum pernah diposting. */
export type BarisTindakan = {
  sumber: SumberLapangan;
  id: string;
  nomor: string | null;
  /** Kode sebab `JOURNAL_PENDING`; null = belum pernah dicoba (ditemukan sapuan). */
  sebab: string | null;
  peran: string | null;
  tanggal: string;
  href?: string | null;
};

type Props = {
  rekon: RekonsiliasiPiutang | null;
  tindakan: BarisTindakan[];
  gagal: boolean;
  bolehMengelola: boolean;
};

export function RekonsiliasiPiutangClient({ rekon, tindakan, gagal, bolehMengelola }: Props) {
  const t = useTranslations("rekonsiliasiPiutang");
  const tJurnal = useTranslations("financeJournals");
  const tPeran = useTranslations("financeAccountMapping");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [sedang, setSedang] = useState<string | null>(null);

  function namaPeran(peran: string | null): string | null {
    if (!peran) return null;
    const kunci = `role.${peran}`;
    return /^[A-Z0-9_]+$/.test(peran) && tPeran.has(kunci) ? tPeran(kunci) : null;
  }

  function teksSebab(b: BarisTindakan): string {
    if (!b.sebab) return t("tindakan.belumDicoba");
    // Kode yang bukan kegagalan (tidak pernah menjadi JOURNAL_PENDING) — jawaban tombol Posting.
    if (b.sebab === "NOTHING_TO_POST") return t("tindakan.tidakAdaYangDijurnal");
    if (b.sebab === "BELUM_BERLAKU") return t("tindakan.belumBerlaku");
    const kunci = kunciSebab(b.sebab);
    if (kunci === "UNMAPPED_ROLE") {
      const peran = namaPeran(b.peran);
      return peran ? tJurnal("tertunda.sebab.UNMAPPED_ROLE", { peran }) : tJurnal("tertunda.sebab.UNMAPPED_ROLE_TANPA_PERAN");
    }
    return tJurnal(`tertunda.sebab.${kunci}`);
  }

  function laporMassal(r: HasilMassalAksi) {
    if (!r.ok) {
      toast.error(t(`galat.${r.kode}`));
      return;
    }
    if (r.gagal.length > 0) toast.warning(t("massal.adaGagal", { berubah: r.berubah, gagal: r.gagal.length, diperiksa: r.diperiksa }));
    else toast.success(t("massal.selesai", { berubah: r.berubah, diperiksa: r.diperiksa }));
    router.refresh();
  }

  const selaraskanToko = (storeId: string) =>
    mulai(async () => {
      setSedang(`toko|${storeId}`);
      try {
        laporMassal(await selaraskanJurnalTokoAction(storeId));
      } finally {
        setSedang(null);
      }
    });

  const postingSemua = () =>
    mulai(async () => {
      setSedang("semua");
      try {
        laporMassal(await postingSemuaJurnalLapanganAction());
      } finally {
        setSedang(null);
      }
    });

  const postingSatu = (b: BarisTindakan) =>
    mulai(async () => {
      setSedang(`doc|${b.sumber}|${b.id}`);
      try {
        const r = await postingUlangJurnalLapanganAction(b.sumber, b.id);
        if (r.ok) {
          toast.success(r.created ? t("tindakan.berhasil") : t("tindakan.sudahSelaras"));
          router.refresh();
          return;
        }
        if (r.kode === "TANPA_AKSES" || r.kode === "PERMINTAAN_RUSAK" || r.kode === "GAGAL") {
          toast.error(t(`galat.${r.kode}`));
          return;
        }
        toast.error(teksSebab({ ...b, sebab: r.kode, peran: "peran" in r ? (r.peran ?? null) : null }));
        router.refresh();
      } finally {
        setSedang(null);
      }
    });

  const meta = rekon
    ? [
        rekon.akun ? t("meta.akun", { kode: rekon.akun.kode, nama: rekon.akun.nama }) : t("meta.akunBelum"),
        rekon.tanggalMulai ? t("meta.mulai", { tanggal: formatDisplayDate(rekon.tanggalMulai, locale) }) : t("meta.mulaiBelum"),
      ].join(" · ")
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={meta}
        actions={
          bolehMengelola ? (
            <Button variant="outline" onClick={postingSemua} disabled={pending}>
              {sedang === "semua" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
              {t("postingSemua")}
            </Button>
          ) : null
        }
      />

      {gagal || !rekon ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("gagal.judul")}</AlertTitle>
          <AlertDescription>{t("gagal.isi")}</AlertDescription>
        </Alert>
      ) : (
        <>
          {!rekon.akun ? (
            <Alert>
              <CircleAlert className="h-4 w-4" aria-hidden />
              <AlertTitle>{t("akunBelum.judul")}</AlertTitle>
              <AlertDescription>
                <p>{t("akunBelum.isi")}</p>
                <Link href="/backoffice/finance/account-mapping" className="font-medium text-tautan underline underline-offset-4">
                  {t("akunBelum.tautan")}
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
          {!rekon.tanggalMulai ? (
            <Alert>
              <CircleAlert className="h-4 w-4" aria-hidden />
              <AlertTitle>{t("mulaiBelum.judul")}</AlertTitle>
              <AlertDescription>{t("mulaiBelum.isi")}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.bukuBesar")}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatRupiah(rekon.total.bukuBesar)}</p>
                {rekon.akun ? (
                  <Link href={tautanBukuBesar(rekon.akun.id)} className="text-xs text-tautan hover:underline">
                    {t("kartu.bukaBukuBesar")}
                  </Link>
                ) : null}
              </CardContent>
            </Card>
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.modul")}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatRupiah(rekon.total.modul)}</p>
                <Link href="/backoffice/piutang" className="text-xs text-tautan hover:underline">
                  {t("kartu.bukaPiutang")}
                </Link>
              </CardContent>
            </Card>
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.kreditRetur")}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatRupiah(rekon.total.kreditRetur)}</p>
              </CardContent>
            </Card>
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.selisih")}</p>
                <p className={`text-2xl font-semibold tabular-nums ${rekon.total.tokoTidakCocok > 0 ? "text-destructive" : ""}`}>
                  {formatRupiah(rekon.total.selisih)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {rekon.total.tokoTidakCocok > 0 ? t("kartu.tokoTidakCocok", { n: rekon.total.tokoTidakCocok }) : t("kartu.semuaCocok")}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" aria-hidden />
                {t("perToko.judul")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rekon.baris.length === 0 ? (
                <EmptyState icon={Scale} title={t("perToko.kosong")} />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[160px]">{t("kolom.toko")}</TableHead>
                        <TableHead className="text-right">{t("kolom.bukuBesar")}</TableHead>
                        <TableHead className="text-right">{t("kolom.modul")}</TableHead>
                        <TableHead className="hidden text-right lg:table-cell">{t("kolom.kreditRetur")}</TableHead>
                        <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.harapan")}</TableHead>
                        <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.diLuarJurnal")}</TableHead>
                        <TableHead className="text-right">{t("kolom.selisih")}</TableHead>
                        <TableHead>{t("kolom.status")}</TableHead>
                        {bolehMengelola ? <TableHead className="w-[140px]" /> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rekon.baris.map((b) => (
                        <TableRow key={b.storeId}>
                          <TableCell className="whitespace-normal font-medium">{b.storeName}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRupiah(b.bukuBesar)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRupiah(b.modul)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatRupiah(b.kreditRetur)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(b.harapan)}</TableCell>
                          <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(b.diLuarJurnal)}</TableCell>
                          <TableCell className={`text-right font-medium tabular-nums ${b.cocok ? "" : "text-destructive"}`}>{formatRupiah(b.selisih)}</TableCell>
                          <TableCell>
                            <StatusPill tone={b.cocok ? "settled" : "attention"}>{b.cocok ? t("status.cocok") : t("status.selisih")}</StatusPill>
                          </TableCell>
                          {bolehMengelola ? (
                            <TableCell>
                              <Button variant="outline" size="sm" onClick={() => selaraskanToko(b.storeId)} disabled={pending}>
                                {sedang === `toko|${b.storeId}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                                {t("perToko.selaraskan")}
                              </Button>
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {rekon.tanpaToko !== 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("perToko.tanpaToko", { nilai: formatRupiah(rekon.tanpaToko) })}</p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}

      <Card id="tertunda">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlert className="h-5 w-5" aria-hidden />
            {t("tindakan.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tindakan.length === 0 ? (
            <EmptyState icon={CircleCheck} title={t("tindakan.kosong")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">{t("tindakan.kolomDokumen")}</TableHead>
                    <TableHead className="min-w-[220px]">{t("tindakan.kolomSebab")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("tindakan.kolomTanggal")}</TableHead>
                    <TableHead className="w-[200px]">{t("tindakan.kolomAksi")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tindakan.map((b) => (
                    <TableRow key={`${b.sumber}|${b.id}`}>
                      <TableCell className="whitespace-normal">
                        <div className="space-y-1">
                          <Badge variant="outline">{journalSourceLabel(tJurnal, b.sumber)}</Badge>
                          <div className="text-sm">
                            {b.href ? (
                              <Link href={b.href} className="font-medium underline underline-offset-4">
                                {b.nomor ?? t("tindakan.bukaDokumen")}
                              </Link>
                            ) : (
                              <span className="font-medium">{b.nomor ?? "—"}</span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">{teksSebab(b)}</TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                        {formatDisplayDateTime(b.tanggal, locale)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {perluPemetaanAkun(b.sebab) ? (
                            <Button variant="outline" size="sm" asChild>
                              <Link href="/backoffice/finance/account-mapping">{tJurnal("tertunda.actionMapping")}</Link>
                            </Button>
                          ) : null}
                          {bolehMengelola ? (
                            <Button variant="outline" size="sm" onClick={() => postingSatu(b)} disabled={pending}>
                              {sedang === `doc|${b.sumber}|${b.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                              {t("tindakan.posting")}
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
