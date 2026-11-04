"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookLock,
  CalendarCheck,
  CalendarRange,
  CheckCircle2,
  CircleMinus,
  ClipboardCheck,
  Loader2,
  LockOpen,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { bukaBulanAction, bukaTahunAction, tutupBulanAction, tutupTahunAction } from "@/app/actions/finance-periode";
import { formatDisplayDate } from "@/lib/date-only";
import {
  MIN_ALASAN,
  alasanCukup,
  bacaKunciBulan,
  labelBulan,
  STATUS_PERIODE,
  type ButirPeriksa,
  type DaftarPeriksa,
  type KodeGalatPeriode,
} from "@/lib/finance/periode/periode";
import type { BarisBulan, BarisTahun, DaftarPeriode } from "@/lib/finance/periode/queries";

type Props = {
  data: DaftarPeriode | null;
  dipilih: string | null;
  periksa: DaftarPeriksa | null;
  bolehMengelola: boolean;
};

type Buka = { jenis: "bulan"; kunci: string } | { jenis: "tahun"; tahun: number };

/** Halaman tujuan per butir daftar periksa — hanya yang sudah ada halamannya. */
function tautanButir(b: ButirPeriksa, bulan: string): string | null {
  switch (b.kunci) {
    case "dokumenTanpaJurnal":
      return `/backoffice/finance/integritas?bulan=${bulan}`;
    case "jurnalGagalTanpaTanggal":
      return "/backoffice/finance/journals?status=tertunda";
    case "settlement":
      return "/backoffice/finance/settlements";
    default:
      return null;
  }
}

export function TutupBukuClient({ data, dipilih, periksa, bolehMengelola }: Props) {
  const t = useTranslations("tutupBuku");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [catatan, setCatatan] = useState("");
  const [setuju, setSetuju] = useState(false);
  const [buka, setBuka] = useState<Buka | null>(null);
  const [alasan, setAlasan] = useState("");
  const [tutupTahun, setTutupTahun] = useState<number | null>(null);

  const namaBulan = (kunci: string) => {
    const tb = bacaKunciBulan(kunci);
    return tb ? labelBulan(tb, locale) : kunci;
  };
  const tgl = (iso: string | null) => (iso ? formatDisplayDate(iso, locale) : "—");

  const pesanGalat = (kode: KodeGalatPeriode, rincian?: Record<string, unknown>) => {
    const bulan = typeof rincian?.bulan === "string" ? namaBulan(rincian.bulan) : "";
    const daftarBulan = Array.isArray(rincian?.bulan) ? (rincian!.bulan as string[]).map(namaBulan).join(", ") : bulan;
    const tahun = typeof rincian?.tahun === "number" ? String(rincian.tahun) : "";
    return t(`err.${kode}`, { bulan: daftarBulan, tahun });
  };

  const tutupBulan = (kunci: string) =>
    mulai(async () => {
      const r = await tutupBulanAction({ bulan: kunci, catatan, setujuPeringatan: setuju });
      if (!r.ok) {
        toast.error(pesanGalat(r.kode, r.rincian));
        return;
      }
      toast.success(t("bulanDitutup", { bulan: namaBulan(kunci) }));
      setCatatan("");
      setSetuju(false);
      router.replace("/backoffice/finance/tutup-buku", { scroll: false });
      router.refresh();
    });

  const kirimBuka = () =>
    mulai(async () => {
      if (!buka) return;
      const r =
        buka.jenis === "bulan"
          ? await bukaBulanAction({ bulan: buka.kunci, alasan })
          : await bukaTahunAction({ tahun: buka.tahun, alasan });
      if (!r.ok) {
        toast.error(pesanGalat(r.kode, r.rincian));
        return;
      }
      toast.success(buka.jenis === "bulan" ? t("bulanDibuka", { bulan: namaBulan(buka.kunci) }) : t("tahunDibuka", { tahun: buka.tahun }));
      setBuka(null);
      setAlasan("");
      router.refresh();
    });

  const kirimTutupTahun = () =>
    mulai(async () => {
      if (tutupTahun == null) return;
      const r = await tutupTahunAction({ tahun: tutupTahun });
      if (!r.ok) {
        toast.error(pesanGalat(r.kode, r.rincian));
        return;
      }
      toast.success(t("tahunDitutup", { tahun: tutupTahun }));
      setTutupTahun(null);
      router.refresh();
    });

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("judul")} />
        <Card>
          <CardContent className="py-10">
            <EmptyState icon={AlertTriangle} title={t("gagalMuat")} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const barisDipilih = dipilih ? data.bulan.find((b) => b.kunci === dipilih) ?? null : null;
  const alasanTutupMati = (): string | null => {
    if (!periksa) return null;
    if (!periksa.bolehTutup) return t("tutupMati.wajib");
    if (periksa.perluPersetujuan && !setuju) return t("tutupMati.setuju");
    return null;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={
          data.tanggalMulai
            ? t("meta", {
                tanggal: formatDisplayDate(`${data.tanggalMulai}T00:00:00+07:00`, locale),
                bulan: data.bulanPertama ? labelBulan(data.bulanPertama, locale) : "—",
              })
            : t("metaTanpaTanggal")
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/backoffice/finance/mulai-buku-besar">
                <CalendarRange className="h-4 w-4" aria-hidden />
                {t("keTanggalMulai")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/backoffice/finance/integritas">
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {t("keIntegritas")}
              </Link>
            </Button>
          </>
        }
      />

      {dipilih && periksa ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" aria-hidden />
              {t("periksa.judul", { bulan: namaBulan(dipilih) })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {barisDipilih?.status === STATUS_PERIODE.TERTUTUP ? (
              <p className="text-sm text-muted-foreground">{t("periksa.sudahDitutup")}</p>
            ) : null}
            <ul className="divide-y rounded-md border">
              {periksa.butir.map((b) => {
                const tautan = tautanButir(b, dipilih);
                return (
                  <li key={b.kunci} className="flex items-start gap-3 p-3">
                    {b.keadaan === "LULUS" ? (
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    ) : b.keadaan === "BELUM_BERLAKU" ? (
                      <CircleMinus className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : b.tingkat === "WAJIB" ? (
                      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium">
                        {t(`periksa.butir.${b.kunci}`)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {b.tingkat === "WAJIB" ? t("periksa.wajib") : t("periksa.peringatan")}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {b.keadaan === "BELUM_BERLAKU"
                          ? t(`periksa.belum.${b.sebabBelumBerlaku ?? "LAIN"}`)
                          : b.keadaan === "LULUS"
                            ? t("periksa.lulus")
                            : t(`periksa.gagal.${b.kunci}`, { n: b.jumlah })}
                      </p>
                      {b.keadaan === "GAGAL" && b.rincian.length > 0 ? (
                        <ul className="text-sm text-muted-foreground">
                          {b.rincian.map((r) => (
                            <li key={r.label}>
                              {r.label}
                              {b.kunci === "settlement" ? "" : ` — ${r.jumlah}`}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {b.keadaan === "GAGAL" && tautan ? (
                        <Link href={tautan} className="text-sm text-tautan underline-offset-4 hover:underline">
                          {t("periksa.buka")}
                        </Link>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {bolehMengelola && barisDipilih?.status !== STATUS_PERIODE.TERTUTUP ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="catatan-tutup">{t("catatan")}</Label>
                  <Textarea id="catatan-tutup" value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} maxLength={1000} />
                </div>
                {periksa.perluPersetujuan ? (
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={setuju} onCheckedChange={(v) => setSetuju(v === true)} className="mt-0.5" />
                    <span>{t("setujuPeringatan")}</span>
                  </label>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => tutupBulan(dipilih)} disabled={pending || alasanTutupMati() != null}>
                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BookLock className="h-4 w-4" aria-hidden />}
                    {t("tutupBulan", { bulan: namaBulan(dipilih) })}
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link href="/backoffice/finance/tutup-buku" scroll={false}>
                      {t("batal")}
                    </Link>
                  </Button>
                </div>
                {alasanTutupMati() ? <p className="text-sm text-muted-foreground">{alasanTutupMati()}</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" aria-hidden />
            {t("bulan.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.bulan.length === 0 ? (
            <EmptyState icon={CalendarCheck} title={t("bulan.kosong")} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bulan.kolBulan")}</TableHead>
                  <TableHead>{t("bulan.kolStatus")}</TableHead>
                  <TableHead className="text-right">{t("bulan.kolJurnal")}</TableHead>
                  <TableHead className="hidden 2xl:table-cell">{t("bulan.kolCatatan")}</TableHead>
                  <TableHead className="text-right">{t("bulan.kolAksi")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bulan.map((b) => (
                  <BarisBulanTabel
                    key={b.kunci}
                    t={t}
                    locale={locale}
                    b={b}
                    nama={namaBulan(b.kunci)}
                    tgl={tgl}
                    dipilih={b.kunci === dipilih}
                    bolehMengelola={bolehMengelola}
                    onBuka={() => {
                      setAlasan("");
                      setBuka({ jenis: "bulan", kunci: b.kunci });
                    }}
                  />
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
            {t("tahun.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("tahun.kolTahun")}</TableHead>
                <TableHead>{t("tahun.kolStatus")}</TableHead>
                <TableHead className="text-right">{t("tahun.kolBulan")}</TableHead>
                <TableHead className="hidden 2xl:table-cell">{t("tahun.kolJurnal")}</TableHead>
                <TableHead className="text-right">{t("tahun.kolAksi")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tahun.map((y) => (
                <BarisTahunTabel
                  key={y.tahun}
                  t={t}
                  y={y}
                  tgl={tgl}
                  pending={pending}
                  bolehMengelola={bolehMengelola}
                  onTutup={() => setTutupTahun(y.tahun)}
                  onBuka={() => {
                    setAlasan("");
                    setBuka({ jenis: "tahun", tahun: y.tahun });
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={buka != null} onOpenChange={(v) => (!v ? setBuka(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {buka?.jenis === "bulan" ? t("buka.judulBulan", { bulan: namaBulan(buka.kunci) }) : t("buka.judulTahun", { tahun: buka?.tahun ?? "" })}
            </DialogTitle>
            <DialogDescription>{buka?.jenis === "bulan" ? t("buka.keteranganBulan") : t("buka.keteranganTahun")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="alasan-buka">{t("buka.alasan")}</Label>
            <Textarea id="alasan-buka" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={3} maxLength={1000} />
            {!alasanCukup(alasan) ? <p className="text-sm text-muted-foreground">{t("buka.alasanMin", { n: MIN_ALASAN })}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuka(null)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button onClick={kirimBuka} disabled={pending || !alasanCukup(alasan)}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />}
              {t("buka.kirim")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={tutupTahun != null} onOpenChange={(v) => (!v ? setTutupTahun(null) : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tahun.konfirmasiJudul", { tahun: tutupTahun ?? "" })}</DialogTitle>
            <DialogDescription>{t("tahun.konfirmasiIsi", { tahun: tutupTahun ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTutupTahun(null)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button onClick={kirimTutupTahun} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BookLock className="h-4 w-4" aria-hidden />}
              {t("tahun.tutup", { tahun: tutupTahun ?? "" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Penerjemah = ReturnType<typeof useTranslations>;

function BarisBulanTabel({
  t,
  locale,
  b,
  nama,
  tgl,
  dipilih,
  bolehMengelola,
  onBuka,
}: {
  t: Penerjemah;
  locale: string;
  b: BarisBulan;
  nama: string;
  tgl: (iso: string | null) => string;
  dipilih: boolean;
  bolehMengelola: boolean;
  onBuka: () => void;
}) {
  const tertutup = b.status === STATUS_PERIODE.TERTUTUP;
  return (
    <TableRow className={dipilih ? "bg-muted/50" : undefined}>
      <TableCell className="font-medium capitalize">{nama}</TableCell>
      <TableCell>
        {tertutup ? (
          <StatusPill tone="settled" detail={t("bulan.ditutupOleh", { nama: b.closedByName ?? "—", tanggal: tgl(b.closedAt) })}>
            {t("status.CLOSED")}
          </StatusPill>
        ) : b.terkunciSebelumBuku ? (
          <StatusPill tone="settled" detail={t("bulan.terkunciSebelumBuku")}>
            {t("status.TERKUNCI")}
          </StatusPill>
        ) : b.sudahBerakhir ? (
          <StatusPill tone="waiting" detail={b.reopenedAt ? t("bulan.dibukaKembali", { tanggal: tgl(b.reopenedAt) }) : undefined}>
            {t("status.OPEN")}
          </StatusPill>
        ) : (
          <StatusPill tone="progress">{t("status.BERJALAN")}</StatusPill>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{b.jumlahJurnal.toLocaleString(locale === "en" ? "en-GB" : "id-ID")}</TableCell>
      <TableCell className="hidden max-w-xs whitespace-normal text-sm text-muted-foreground 2xl:table-cell">
        {tertutup ? (b.closeNote ?? "—") : (b.reopenReason ?? "—")}
      </TableCell>
      <TableCell className="text-right">
        {tertutup ? (
          bolehMengelola ? (
            <Button variant="outline" size="sm" onClick={onBuka}>
              <LockOpen className="h-4 w-4" aria-hidden />
              {t("bulan.bukaKembali")}
            </Button>
          ) : null
        ) : b.terkunciSebelumBuku ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : b.sudahBerakhir ? (
          <Button variant={dipilih ? "secondary" : "outline"} size="sm" asChild>
            <Link href={`/backoffice/finance/tutup-buku?bulan=${b.kunci}`} scroll={false}>
              <ClipboardCheck className="h-4 w-4" aria-hidden />
              {bolehMengelola ? t("bulan.periksaTutup") : t("bulan.periksa")}
            </Link>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">{t("bulan.belumBerakhir")}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function BarisTahunTabel({
  t,
  y,
  tgl,
  pending,
  bolehMengelola,
  onTutup,
  onBuka,
}: {
  t: Penerjemah;
  y: BarisTahun;
  tgl: (iso: string | null) => string;
  pending: boolean;
  bolehMengelola: boolean;
  onTutup: () => void;
  onBuka: () => void;
}) {
  const tertutup = y.status === STATUS_PERIODE.TERTUTUP;
  const alasanMati = !y.sudahBerakhir ? t("tahun.belumBerakhir") : y.bulanTertutup < 12 ? t("tahun.masihAdaBulan", { n: 12 - y.bulanTertutup }) : null;
  return (
    <TableRow>
      <TableCell className="font-medium">{y.tahun}</TableCell>
      <TableCell>
        {tertutup ? (
          <StatusPill tone="settled" detail={t("bulan.ditutupOleh", { nama: y.closedByName ?? "—", tanggal: tgl(y.closedAt) })}>
            {t("status.CLOSED")}
          </StatusPill>
        ) : (
          <StatusPill tone={y.sudahBerakhir ? "waiting" : "progress"}>{y.sudahBerakhir ? t("status.OPEN") : t("status.BERJALAN")}</StatusPill>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{t("tahun.nDari12", { n: y.bulanTertutup })}</TableCell>
      <TableCell className="hidden 2xl:table-cell">
        {y.closingJournalId ? (
          <Link href={`/backoffice/finance/journals/${y.closingJournalId}`} className="text-sm text-tautan underline-offset-4 hover:underline">
            {t("tahun.lihatJurnal")}
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {!bolehMengelola ? null : tertutup ? (
          <Button variant="outline" size="sm" onClick={onBuka} disabled={pending}>
            <LockOpen className="h-4 w-4" aria-hidden />
            {t("tahun.buka")}
          </Button>
        ) : alasanMati ? (
          <span className="text-sm text-muted-foreground">{alasanMati}</span>
        ) : (
          <Button size="sm" onClick={onTutup} disabled={pending}>
            <BookLock className="h-4 w-4" aria-hidden />
            {t("tahun.tutup", { tahun: y.tahun })}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
