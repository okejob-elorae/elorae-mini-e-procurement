"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, BookLock, CheckCircle2, FileQuestion, FileX2, Loader2, RefreshCw, Scale, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { jalankanSapuanAction } from "@/app/actions/finance-periode";
import { teksKeteranganJurnal } from "@/lib/finance/journals/keterangan-tampil";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { bacaKunciBulan, labelBulan } from "@/lib/finance/periode/periode";
import type {
  HasilJurnalYatim,
  HasilTanpaJurnal,
  JurnalSesudahTutup,
  JurnalTakSeimbang,
  SaldoTerbalikBaris,
} from "@/lib/finance/integritas/queries";

type Props = {
  saring: { bulan: string | null; hanyaDiam: boolean };
  tanpaJurnal: HasilTanpaJurnal | null;
  takSeimbang: JurnalTakSeimbang[] | null;
  yatim: HasilJurnalYatim | null;
  terbalik: SaldoTerbalikBaris[] | null;
  sesudahTutup: JurnalSesudahTutup[] | null;
  bolehMengelola: boolean;
};

function rupiah(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

function alamat(saring: { bulan: string | null; hanyaDiam: boolean }): string {
  const qs = new URLSearchParams();
  if (saring.bulan) qs.set("bulan", saring.bulan);
  if (saring.hanyaDiam) qs.set("tanpaJurnal", "diam");
  const s = qs.toString();
  return s ? `/backoffice/finance/integritas?${s}` : "/backoffice/finance/integritas";
}

export function IntegritasClient({ saring, tanpaJurnal, takSeimbang, yatim, terbalik, sesudahTutup, bolehMengelola }: Props) {
  const t = useTranslations("integritasBukuBesar");
  // Keterangan jurnal otomatis lama tersimpan berbahasa Inggris — diterjemahkan saat tampil.
  const tj = useTranslations("financeJournals");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const tgl = (iso: string) => formatDisplayDate(iso, locale);
  const namaBulan = (k: string) => {
    const tb = bacaKunciBulan(k);
    return tb ? labelBulan(tb, locale) : k;
  };

  const sapu = () =>
    mulai(async () => {
      const r = await jalankanSapuanAction();
      if (!r.ok) {
        toast.error(t(`err.${r.kode === "TANPA_AKSES" ? "TANPA_AKSES" : "GAGAL"}`));
        return;
      }
      if (r.hasil.dilewati) {
        toast.warning(t(`sapu.dilewati.${r.hasil.dilewati}`));
        return;
      }
      const diposting = r.hasil.sumber.reduce((s, x) => s + x.diposting, 0);
      const gagal = r.hasil.sumber.reduce((s, x) => s + x.gagal, 0);
      if (gagal > 0) toast.warning(t("sapu.sebagian", { diposting, gagal }));
      else toast.success(t("sapu.selesai", { diposting }));
      router.refresh();
    });

  const jumlahTanpaJurnal = tanpaJurnal?.berlaku ? tanpaJurnal.dokumen.length : 0;
  const ringkasan = [
    { kunci: "tanpaJurnal", n: tanpaJurnal == null ? null : jumlahTanpaJurnal },
    { kunci: "takSeimbang", n: takSeimbang?.length ?? null },
    { kunci: "yatim", n: yatim?.yatim.length ?? null },
    { kunci: "terbalik", n: terbalik?.length ?? null },
    { kunci: "sesudahTutup", n: sesudahTutup?.length ?? null },
  ] as const;

  const gagalDibaca = <p className="text-sm text-destructive">{t("gagalDibaca")}</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={t("meta", { n: ringkasan.filter((r) => (r.n ?? 0) > 0).length })}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/backoffice/finance/tutup-buku">
                <BookLock className="h-4 w-4" aria-hidden />
                {t("keTutupBuku")}
              </Link>
            </Button>
            {bolehMengelola ? (
              <Button onClick={sapu} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                {t("sapu.tombol")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {ringkasan.map((r) => (
          <Card key={r.kunci} className="py-0">
            <CardContent className="space-y-1 p-4">
              <p className="text-sm text-muted-foreground">{t(`ringkas.${r.kunci}`)}</p>
              {r.n == null ? (
                <p className="text-sm text-destructive">{t("gagalDibacaSingkat")}</p>
              ) : r.n === 0 ? (
                <p className="flex items-center gap-1 text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />0
                </p>
              ) : (
                <p className="flex items-center gap-1 text-lg font-semibold text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  {r.n}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileQuestion className="h-5 w-5" aria-hidden />
            {t("tanpaJurnal.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={saring.hanyaDiam ? "outline" : "secondary"} size="sm" asChild>
              <Link href={alamat({ ...saring, hanyaDiam: false })} replace scroll={false}>
                {t("tanpaJurnal.semua")}
              </Link>
            </Button>
            <Button variant={saring.hanyaDiam ? "secondary" : "outline"} size="sm" asChild>
              <Link href={alamat({ ...saring, hanyaDiam: true })} replace scroll={false}>
                {t("tanpaJurnal.diam")}
              </Link>
            </Button>
            {saring.bulan ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={alamat({ ...saring, bulan: null })} replace scroll={false}>
                  {t("tanpaJurnal.bulan", { bulan: namaBulan(saring.bulan) })}
                  <X className="h-3.5 w-3.5" aria-label={t("hapusSaring")} />
                </Link>
              </Button>
            ) : null}
          </div>
          {tanpaJurnal == null ? (
            gagalDibaca
          ) : !tanpaJurnal.berlaku ? (
            <p className="text-sm text-muted-foreground">{t(`tanpaJurnal.belum.${tanpaJurnal.sebab}`)}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t("tanpaJurnal.rentang", { sejak: tgl(tanpaJurnal.sejak), sampai: tgl(tanpaJurnal.sampai) })}
              </p>
              {tanpaJurnal.perSumber.some((s) => s.galat || s.terpotong) ? (
                <ul className="text-sm text-amber-700 dark:text-amber-400">
                  {tanpaJurnal.perSumber
                    .filter((s) => s.galat || s.terpotong)
                    .map((s) => (
                      <li key={s.sourceType}>{s.galat ? t("tanpaJurnal.galatSumber", { jenis: s.label }) : t("tanpaJurnal.terpotong", { jenis: s.label, n: s.jumlah })}</li>
                    ))}
                </ul>
              ) : null}
              {tanpaJurnal.dokumen.length === 0 ? (
                <EmptyState icon={CheckCircle2} title={t("tanpaJurnal.kosong")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kol.jenis")}</TableHead>
                      <TableHead>{t("kol.dokumen")}</TableHead>
                      <TableHead>{t("kol.tanggal")}</TableHead>
                      <TableHead>{t("kol.keadaan")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tanpaJurnal.dokumen.map((d) => (
                      <TableRow key={`${d.sourceType}|${d.id}`}>
                        <TableCell className="whitespace-normal">{d.jenis}</TableCell>
                        <TableCell className="font-medium">
                          {d.tautan ? (
                            <Link href={d.tautan} className="text-tautan underline-offset-4 hover:underline">
                              {d.nomor}
                            </Link>
                          ) : (
                            d.nomor
                          )}
                        </TableCell>
                        <TableCell>{tgl(d.tanggal)}</TableCell>
                        <TableCell>
                          {d.tercatatGagal ? (
                            <Link href="/backoffice/finance/journals?status=tertunda">
                              <StatusPill tone="attention">{t("tanpaJurnal.tercatatGagal")}</StatusPill>
                            </Link>
                          ) : (
                            <StatusPill tone="waiting">{t("tanpaJurnal.belumTercatat")}</StatusPill>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" aria-hidden />
            {t("takSeimbang.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {takSeimbang == null ? (
            gagalDibaca
          ) : takSeimbang.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t("takSeimbang.kosong")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kol.tanggal")}</TableHead>
                  <TableHead>{t("kol.jurnal")}</TableHead>
                  <TableHead className="text-right">{t("kol.debit")}</TableHead>
                  <TableHead className="text-right">{t("kol.kredit")}</TableHead>
                  <TableHead className="text-right">{t("kol.baris")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {takSeimbang.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell>{tgl(j.tanggal)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <Link href={`/backoffice/finance/journals/${j.id}`} className="text-tautan underline-offset-4 hover:underline">
                        {teksKeteranganJurnal(tj, j.keterangan)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(j.debit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{rupiah(j.kredit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{j.jumlahBaris}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileX2 className="h-5 w-5" aria-hidden />
            {t("yatim.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {yatim == null ? (
            gagalDibaca
          ) : (
            <>
              {yatim.yatim.length === 0 ? (
                <EmptyState icon={CheckCircle2} title={t("yatim.kosong")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("kol.tanggal")}</TableHead>
                      <TableHead>{t("kol.jurnal")}</TableHead>
                      <TableHead className="hidden 2xl:table-cell">{t("kol.sumber")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {yatim.yatim.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell>{tgl(j.tanggal)}</TableCell>
                        <TableCell className="whitespace-normal">
                          <Link href={`/backoffice/finance/journals/${j.id}`} className="text-tautan underline-offset-4 hover:underline">
                            {teksKeteranganJurnal(tj, j.keterangan)}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs 2xl:table-cell">
                          {j.sourceType} · {j.sourceId}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {yatim.terpotong ? <p className="text-sm text-muted-foreground">{t("terpotong")}</p> : null}
              {yatim.tidakDiperiksa.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("yatim.tidakDiperiksa", { daftar: yatim.tidakDiperiksa.map((x) => `${x.sourceType} (${x.jumlah})`).join(", ") })}
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" aria-hidden />
            {t("terbalik.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {terbalik == null ? (
            gagalDibaca
          ) : terbalik.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t("terbalik.kosong")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kol.akun")}</TableHead>
                  <TableHead>{t("kol.tipe")}</TableHead>
                  <TableHead className="text-right">{t("kol.saldo")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terbalik.map((a) => (
                  <TableRow key={a.accountId}>
                    <TableCell className="whitespace-normal">
                      <Link href={`/backoffice/finance/journals/ledger/${a.accountId}`} className="text-tautan underline-offset-4 hover:underline">
                        {a.kode} {a.nama}
                      </Link>
                    </TableCell>
                    <TableCell>{t(`tipe.${a.tipe}`)}</TableCell>
                    <TableCell className="text-right tabular-nums text-red-700 dark:text-red-400">{rupiah(a.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookLock className="h-5 w-5" aria-hidden />
            {t("sesudahTutup.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sesudahTutup == null ? (
            gagalDibaca
          ) : sesudahTutup.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t("sesudahTutup.kosong")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kol.bulan")}</TableHead>
                  <TableHead>{t("kol.jurnal")}</TableHead>
                  <TableHead>{t("kol.dibuat")}</TableHead>
                  <TableHead className="hidden 2xl:table-cell">{t("kol.ditutup")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sesudahTutup.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="capitalize">{namaBulan(j.bulan)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <Link href={`/backoffice/finance/journals/${j.id}`} className="text-tautan underline-offset-4 hover:underline">
                        {teksKeteranganJurnal(tj, j.keterangan)}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDisplayDateTime(j.dibuat, locale)}</TableCell>
                    <TableCell className="hidden 2xl:table-cell">{formatDisplayDateTime(j.ditutup, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
