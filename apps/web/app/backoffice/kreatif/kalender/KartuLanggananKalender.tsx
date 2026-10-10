"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, Copy, ExternalLink, Loader2 } from "lucide-react";
import { buatLanggananKalenderAction, cabutLanggananKalenderAction, type HasilBuatLanggananAksi } from "@/app/actions/kreatif-kalender";
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
import { Input } from "@/components/ui/input";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";

type Baru = Extract<HasilBuatLanggananAksi, { ok: true }>;

export type LanggananKartu = { sejak: string; terakhirDibaca: string | null } | null;

/**
 * "Langganan di Google Calendar": satu tautan rahasia per orang. Tautannya
 * hanya tampil sekali, tepat sesudah dibuat; sesudah halaman dimuat ulang yang
 * tersisa hanya "Tautan aktif sejak …" (token tidak pernah disimpan).
 */
export function KartuLanggananKalender({ aktif }: { aktif: LanggananKartu }) {
  const t = useTranslations("kreatifRuang.kalender.langganan");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [baru, setBaru] = useState<Baru | null>(null);
  const [pending, mulai] = useTransition();

  const gagal = (kode: string) => {
    toast.error(t.has(`err.${kode}`) ? td(`err.${kode}`) : t("err.GAGAL"));
  };

  const buat = () =>
    mulai(async () => {
      const r = await buatLanggananKalenderAction({ asal: window.location.origin });
      if (!r.ok) return gagal(r.kode);
      setBaru(r);
      toast.success(t("dibuat"));
      router.refresh();
    });

  const cabut = () =>
    mulai(async () => {
      const r = await cabutLanggananKalenderAction();
      if (!r.ok) return gagal(r.kode);
      setBaru(null);
      toast.success(t("dicabut"));
      router.refresh();
    });

  const salin = async (teks: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast.success(t("disalin"));
    } catch {
      toast.error(t("err.SALIN"));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarPlus className="h-4 w-4" aria-hidden />
            {t("judul")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {aktif
              ? `${t("aktif", { tanggal: formatDisplayDate(new Date(aktif.sejak), locale) })} · ${
                  aktif.terakhirDibaca ? t("terakhirDibaca", { waktu: formatDisplayDateTime(new Date(aktif.terakhirDibaca), locale) }) : t("belumDibaca")
                }`
              : t("tidakAda")}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {aktif ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" disabled={pending}>
                  {t("cabut")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("cabutJudul")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("cabutIsi")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={cabut}>
                    {t("cabut")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {aktif ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {t("buatBaru")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("baruJudul")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("baruIsi")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
                  <AlertDialogAction onClick={buat}>{t("buatBaru")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button size="sm" onClick={buat} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("buat")}
            </Button>
          )}
        </div>
      </CardHeader>
      {baru ? (
        <CardContent>
          <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <p className="text-sm font-medium">{t("siap")}</p>
            <div className="flex gap-2">
              <Input readOnly value={baru.https} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-xs" aria-label={t("judul")} />
              <Button size="sm" variant="outline" onClick={() => salin(baru.https)}>
                <Copy className="h-4 w-4" aria-hidden />
                {t("salin")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={baru.google} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  {t("google")}
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={baru.webcal}>{t("apple")}</a>
              </Button>
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
