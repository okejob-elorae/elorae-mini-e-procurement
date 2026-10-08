"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Boxes, CircleAlert, CircleCheck, ListChecks, Loader2, RefreshCw, Scale, Wrench } from "lucide-react";
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
  lengkapiNilaiGudangRusakAction,
  postingSemuaJurnalOperasionalAction,
  postingUlangJurnalOperasionalAction,
} from "@/app/actions/finance-operasional";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelJenisGerakan } from "@/lib/inventory/jenis-gerakan-stok";
import type { SumberOperasional } from "@/lib/finance/operasional/aturan";
import { ringkasRekonPersediaan } from "@/lib/finance/operasional/rekonsiliasi-persediaan";
import type { RekonsiliasiPersediaan } from "@/lib/finance/operasional/rekonsiliasi-persediaan-queries";
import { journalSourceLabel } from "../journals/journal-source-label";
import { tautanBukuBesar } from "../journals/_sumber/tautan";
import { kunciSebab, perluPemetaanAkun } from "../journals/_tertunda/sebab";

/** Satu dokumen operasional yang perlu tindakan: jurnalnya tertunda (bersebab) atau belum pernah diposting. */
export type BarisTindakanOperasional = {
  sumber: SumberOperasional;
  id: string;
  nomor: string | null;
  /** Kode sebab `JOURNAL_PENDING`; null = belum pernah dicoba (ditemukan sapuan). */
  sebab: string | null;
  peran: string | null;
  tanggal: string;
  href?: string | null;
};

type Props = {
  rekon: RekonsiliasiPersediaan | null;
  tindakan: BarisTindakanOperasional[];
  gagal: boolean;
  bolehMengelola: boolean;
};

export function RekonsiliasiPersediaanClient({ rekon, tindakan, gagal, bolehMengelola }: Props) {
  const t = useTranslations("rekonsiliasiPersediaan");
  const tJurnal = useTranslations("financeJournals");
  const tPeran = useTranslations("financeAccountMapping");
  const tGerak = useTranslations("inventory.stockMoveKind");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [sedang, setSedang] = useState<string | null>(null);

  function namaPeran(peran: string | null): string | null {
    if (!peran) return null;
    const kunci = `role.${peran}`;
    return /^[A-Z0-9_]+$/.test(peran) && tPeran.has(kunci) ? tPeran(kunci) : null;
  }

  function teksSebab(b: { sebab: string | null; peran: string | null }): string {
    if (!b.sebab) return t("tindakan.belumDicoba");
    if (b.sebab === "NOTHING_TO_POST") return t("tindakan.tidakAdaYangDijurnal");
    if (b.sebab === "BELUM_BERLAKU") return t("tindakan.belumBerlaku");
    const kunci = kunciSebab(b.sebab);
    if (kunci === "UNMAPPED_ROLE") {
      const peran = namaPeran(b.peran);
      return peran ? tJurnal("tertunda.sebab.UNMAPPED_ROLE", { peran }) : tJurnal("tertunda.sebab.UNMAPPED_ROLE_TANPA_PERAN");
    }
    return tJurnal(`tertunda.sebab.${kunci}`);
  }

  const postingSemua = () =>
    mulai(async () => {
      setSedang("semua");
      try {
        const r = await postingSemuaJurnalOperasionalAction();
        if (!r.ok) {
          toast.error(t(`galat.${r.kode}`));
          return;
        }
        if (r.gagal.length > 0) toast.warning(t("massal.adaGagal", { berubah: r.berubah, gagal: r.gagal.length, diperiksa: r.diperiksa }));
        else toast.success(t("massal.selesai", { berubah: r.berubah, diperiksa: r.diperiksa }));
        router.refresh();
      } finally {
        setSedang(null);
      }
    });

  const postingSatu = (b: BarisTindakanOperasional) =>
    mulai(async () => {
      setSedang(`doc|${b.sumber}|${b.id}`);
      try {
        const r = await postingUlangJurnalOperasionalAction(b.sumber, b.id);
        if (r.ok) {
          toast.success(r.created ? t("tindakan.berhasil") : t("tindakan.sudahSelaras"));
          router.refresh();
          return;
        }
        if (r.kode === "TANPA_AKSES" || r.kode === "PERMINTAAN_RUSAK" || r.kode === "GAGAL") {
          toast.error(t(`galat.${r.kode}`));
          return;
        }
        toast.error(teksSebab({ sebab: r.kode, peran: "peran" in r ? (r.peran ?? null) : null }));
        router.refresh();
      } finally {
        setSedang(null);
      }
    });

  const lengkapiRusak = () =>
    mulai(async () => {
      setSedang("rusak");
      try {
        const r = await lengkapiNilaiGudangRusakAction();
        if (!r.ok) {
          toast.error(t(`galat.${r.kode}`));
          return;
        }
        toast.success(t("rincian.lengkapiSelesai", { n: r.diisi }));
        router.refresh();
      } finally {
        setSedang(null);
      }
    });

  const ringkas = rekon ? ringkasRekonPersediaan(rekon.baris) : null;
  const meta = rekon
    ? [
        t("meta.perHariIni"),
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

      {gagal || !rekon || !ringkas ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>{t("gagal.judul")}</AlertTitle>
          <AlertDescription>{t("gagal.isi")}</AlertDescription>
        </Alert>
      ) : (
        <>
          {ringkas.adaBelumDipetakan ? (
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

          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.bukuBesar")}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatRupiah(ringkas.bukuBesar)}</p>
              </CardContent>
            </Card>
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.sistem")}</p>
                <p className="text-2xl font-semibold tabular-nums">{formatRupiah(ringkas.sistem)}</p>
              </CardContent>
            </Card>
            <Card className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-sm text-muted-foreground">{t("kartu.selisih")}</p>
                <p className={`text-2xl font-semibold tabular-nums ${ringkas.semuaCocok ? "" : "text-destructive"}`}>{formatRupiah(ringkas.selisih)}</p>
                <p className="text-xs text-muted-foreground">{ringkas.semuaCocok ? t("kartu.semuaCocok") : t("kartu.adaSelisih")}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5" aria-hidden />
                {t("perAkun.judul")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">{t("kolom.akun")}</TableHead>
                      <TableHead className="hidden min-w-[180px] lg:table-cell">{t("kolom.peran")}</TableHead>
                      <TableHead className="text-right">{t("kolom.bukuBesar")}</TableHead>
                      <TableHead className="text-right">{t("kolom.sistem")}</TableHead>
                      <TableHead className="text-right">{t("kolom.selisih")}</TableHead>
                      <TableHead>{t("kolom.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rekon.baris.map((b) => (
                      <TableRow key={b.akun?.id ?? b.peran.join("|")}>
                        <TableCell className="whitespace-normal font-medium">
                          {b.akun ? (
                            <Link href={tautanBukuBesar(b.akun.id)} className="underline underline-offset-4">
                              {b.akun.code} · {b.akun.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{t("perAkun.belumDipetakan")}</span>
                          )}
                          <div className="text-xs font-normal text-muted-foreground lg:hidden">
                            {b.peran.map((p) => namaPeran(p) ?? p).join(", ")}
                          </div>
                        </TableCell>
                        <TableCell className="hidden whitespace-normal text-sm lg:table-cell">{b.peran.map((p) => namaPeran(p) ?? p).join(", ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.bukuBesar === null ? "—" : formatRupiah(b.bukuBesar)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatRupiah(b.sistem)}</TableCell>
                        <TableCell className={`text-right font-medium tabular-nums ${b.cocok ? "" : "text-destructive"}`}>
                          {b.selisih === null ? "—" : formatRupiah(b.selisih)}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={b.cocok ? "settled" : "attention"}>
                            {b.akun === null ? t("status.belumDipetakan") : b.cocok ? t("status.cocok") : t("status.selisih")}
                          </StatusPill>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Boxes className="h-5 w-5" aria-hidden />
                  {t("rincian.judul")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <BarisNilai label={t("rincian.bahanGudang")} nilai={rekon.rincian.bahanGudang} />
                <BarisNilai label={t("rincian.bahanDiProduksi")} nilai={rekon.rincian.bahanDiProduksi} />
                <BarisNilai label={t("rincian.barangJadi")} nilai={rekon.rincian.barangJadi} />
                <BarisNilai
                  label={t("rincian.konsinyasi", { toko: rekon.rincian.tokoKonsinyasi })}
                  nilai={rekon.rincian.konsinyasi}
                  catatan={rekon.rincian.konsinyasiCadangan > 0 ? t("rincian.konsinyasiCadangan", { n: rekon.rincian.konsinyasiCadangan }) : null}
                />
                <BarisNilai
                  label={t("rincian.gudangRusak")}
                  nilai={rekon.rincian.gudangRusak}
                  catatan={rekon.rincian.gudangRusakTanpaNilai > 0 ? t("rincian.gudangRusakTanpaNilai", { n: rekon.rincian.gudangRusakTanpaNilai }) : null}
                />
                <BarisNilai label={t("rincian.van")} nilai={rekon.rincian.van} />
                {bolehMengelola && rekon.rincian.gudangRusakTanpaNilai > 0 ? (
                  <Button variant="outline" size="sm" onClick={lengkapiRusak} disabled={pending}>
                    {sedang === "rusak" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wrench className="h-4 w-4" aria-hidden />}
                    {t("rincian.lengkapi")}
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" aria-hidden />
                  {t("penyebab.judul")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {rekon.penyebab.stokTanpaJurnal.length === 0 && rekon.penyebab.returPemasokDiproses.jumlah === 0 ? (
                  <p className="text-muted-foreground">{t("penyebab.kosong")}</p>
                ) : null}
                {rekon.penyebab.stokTanpaJurnal.map((s) => (
                  <BarisNilai
                    key={s.source}
                    label={t("penyebab.stokTanpaJurnal", { sumber: labelJenisGerakan(tGerak, s.source), n: s.jumlah })}
                    nilai={s.nilai}
                  />
                ))}
                {rekon.penyebab.returPemasokDiproses.jumlah > 0 ? (
                  <BarisNilai
                    label={t("penyebab.returPemasok", { n: rekon.penyebab.returPemasokDiproses.jumlah })}
                    nilai={-rekon.penyebab.returPemasokDiproses.nilai}
                  />
                ) : null}
              </CardContent>
            </Card>
          </div>
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

function BarisNilai({ label, nilai, catatan }: { label: string; nilai: number; catatan?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p>{label}</p>
        {catatan ? <p className="text-xs text-muted-foreground">{catatan}</p> : null}
      </div>
      <p className="shrink-0 font-medium tabular-nums">{formatRupiah(nilai)}</p>
    </div>
  );
}
