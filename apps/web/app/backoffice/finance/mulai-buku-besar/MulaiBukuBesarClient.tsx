"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, BookLock, CalendarRange, Loader2, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { pratinjauTanggalMulaiAction, tetapkanTanggalMulaiAction } from "@/app/actions/finance-periode";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import type { DampakTanggalMulai, PeringatanTanggalMulai } from "@/lib/finance/periode/tanggal-mulai-aturan";
import type { InfoTanggalMulai } from "@/lib/finance/periode/tanggal-mulai";

type Props = { info: InfoTanggalMulai | null; hariIni: string; bolehMengelola: boolean };

type Pratinjau = { tanggal: string; peringatan: PeringatanTanggalMulai[]; dampak: DampakTanggalMulai };

const tglWib = (t: string) => `${t}T00:00:00+07:00`;

export function MulaiBukuBesarClient({ info, hariIni, bolehMengelola }: Props) {
  const t = useTranslations("mulaiBukuBesar");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [tanggal, setTanggal] = useState(info?.tanggal ?? hariIni);
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);
  const [setuju, setSetuju] = useState(false);

  if (!info) {
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

  const ubahTanggal = (v: string) => {
    setTanggal(v);
    setPratinjau(null);
    setSetuju(false);
  };

  const periksa = () =>
    mulai(async () => {
      const r = await pratinjauTanggalMulaiAction({ tanggal });
      if (!r.ok) {
        toast.error(t(`err.${r.kode}`));
        return;
      }
      setPratinjau({ tanggal: r.tanggal, peringatan: r.peringatan, dampak: r.dampak });
      setSetuju(false);
    });

  const simpan = () =>
    mulai(async () => {
      if (!pratinjau) return;
      const r = await tetapkanTanggalMulaiAction({ tanggal: pratinjau.tanggal, setuju });
      if (!r.ok) {
        toast.error(t(`err.${r.kode}`));
        return;
      }
      toast.success(t("tersimpan", { tanggal: formatDisplayDate(tglWib(r.tanggal), locale) }));
      setPratinjau(null);
      setSetuju(false);
      router.refresh();
    });

  const bisaUbah = bolehMengelola && !info.adaPeriodeTertutup;
  const alasanSimpanMati = !pratinjau ? t("simpanMati.periksaDulu") : !setuju ? t("simpanMati.setuju") : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        meta={
          info.tanggal
            ? t("meta", {
                tanggal: formatDisplayDate(tglWib(info.tanggal), locale),
                oleh: info.diubahOleh ?? "—",
                pada: info.diubahPada ? formatDisplayDateTime(info.diubahPada, locale) : "—",
              })
            : t("metaBelum")
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/backoffice/finance/tutup-buku">
              <BookLock className="h-4 w-4" aria-hidden />
              {t("keTutupBuku")}
            </Link>
          </Button>
        }
      />

      {info.mentahTidakSah ? (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/50 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t("mentahTidakSah", { nilai: info.mentahTidakSah })}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5" aria-hidden />
            {t("kartu.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {info.adaPeriodeTertutup ? (
            <p className="text-sm text-muted-foreground">{t("terkunci")}</p>
          ) : !bolehMengelola ? (
            <p className="text-sm text-muted-foreground">{t("hanyaLihat")}</p>
          ) : null}

          {bisaUbah ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label htmlFor="tanggal-mulai">{t("isian")}</Label>
                  <TanggalInput id="tanggal-mulai" value={tanggal} onChange={(e) => ubahTanggal(e.target.value)} required />
                </div>
                <Button variant="outline" onClick={periksa} disabled={pending || !tanggal}>
                  {pending && !pratinjau ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                  {t("periksa")}
                </Button>
              </div>

              {pratinjau ? (
                <div className="space-y-3 rounded-md border p-4">
                  <p className="font-medium">{t("pratinjau.judul", { tanggal: formatDisplayDate(tglWib(pratinjau.tanggal), locale) })}</p>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {pratinjau.peringatan.map((p) => (
                      <li key={p.kunci}>{t(`peringatan.${p.kunci}`, { n: "n" in p ? p.n : 0 })}</li>
                    ))}
                  </ul>
                  {pratinjau.dampak.dokumenAkanDisapu.length > 0 ? (
                    <div className="text-sm">
                      <p className="text-muted-foreground">{t("pratinjau.disapu")}</p>
                      <ul className="pl-5">
                        {pratinjau.dampak.dokumenAkanDisapu.map((d) => (
                          <li key={d.label}>
                            {d.label} — {d.jumlah}
                            {pratinjau.dampak.terpotong ? "+" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <label className="flex items-start gap-2 text-sm">
                    <Checkbox checked={setuju} onCheckedChange={(v) => setSetuju(v === true)} className="mt-0.5" />
                    <span>{t("setuju")}</span>
                  </label>
                </div>
              ) : null}

              <div className="space-y-1">
                <Button onClick={simpan} disabled={pending || alasanSimpanMati != null}>
                  {pending && pratinjau ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                  {t("simpan")}
                </Button>
                {alasanSimpanMati ? <p className="text-sm text-muted-foreground">{alasanSimpanMati}</p> : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
