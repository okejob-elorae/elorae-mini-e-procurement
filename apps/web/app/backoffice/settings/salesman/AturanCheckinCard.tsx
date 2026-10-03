"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, Loader2, MapPinned, ShieldAlert } from "lucide-react";
import { simpanAturanCheckin } from "@/app/actions/settings/salesman-kunjungan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AKURASI_MAKS_MAKS,
  AKURASI_MAKS_MIN,
  MODE_RADIUS,
  RADIUS_GLOBAL_MAKS,
  RADIUS_GLOBAL_MIN,
  type AturanCheckin,
  type ModeRadius,
} from "@/lib/salesman/aturan-kunjungan";
import { cn } from "@/lib/utils";

const angkaSaja = (s: string) => s.replace(/\D/g, "");
const dalam = (s: string, min: number, maks: number) => /^\d+$/.test(s) && Number(s) >= min && Number(s) <= maks;

/**
 * Aturan check-in: radius bawaan, apa yang terjadi di luar radius (PERINGATAN
 * = perilaku lama, atau TOLAK), dan batas akurasi GPS untuk tanda
 * "mencurigakan". Berlaku untuk salesman dan SPG.
 */
export function AturanCheckinCard({
  bolehUbah,
  aturan,
  radiusMeter,
}: {
  bolehUbah: boolean;
  aturan: AturanCheckin;
  /** Radius check-in bawaan saat ini (`checkin.radiusMeters`, atau 100 bila belum diatur). */
  radiusMeter: number;
}) {
  const t = useTranslations("settings.salesman.kunjungan.checkin");
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [mode, setMode] = useState<ModeRadius>(aturan.modeRadius);
  const [radius, setRadius] = useState(String(radiusMeter));
  const [akurasi, setAkurasi] = useState(String(aturan.akurasiMaksMeter));

  const radiusSah = dalam(radius, RADIUS_GLOBAL_MIN, RADIUS_GLOBAL_MAKS);
  const akurasiSah = dalam(akurasi, AKURASI_MAKS_MIN, AKURASI_MAKS_MAKS);
  const berubah =
    mode !== aturan.modeRadius || Number(radius) !== radiusMeter || Number(akurasi) !== aturan.akurasiMaksMeter;
  const nonaktif = !bolehUbah || sibuk;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAturanCheckin({
        modeRadius: mode,
        akurasiMaksMeter: Number(akurasi),
        radiusMeter: Number(radius),
      });
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? tSalesman("errInvalid") : tSalesman("errForbidden"));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPinned className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label id="mode-radius">{t("modeLabel")}</Label>
          <div role="radiogroup" aria-labelledby="mode-radius" className="grid gap-2 sm:grid-cols-2">
            {MODE_RADIUS.map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                variant="outline"
                disabled={nonaktif}
                onClick={() => setMode(m)}
                className={cn(
                  "h-auto flex-col items-start gap-1 whitespace-normal py-3 text-left",
                  mode === m && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                <span className="font-semibold">{t(`mode${m}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">{t(`mode${m}Isi`)}</span>
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="checkin-radius">{t("radiusLabel")}</Label>
            <div className="relative">
              <Input
                id="checkin-radius"
                type="text"
                inputMode="numeric"
                className="pr-9 text-right tabular-nums"
                value={radius}
                aria-invalid={!radiusSah}
                onChange={(e) => setRadius(angkaSaja(e.target.value).slice(0, 4))}
                disabled={nonaktif}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {t("meter")}
              </span>
            </div>
            <p className={cn("text-xs", radiusSah ? "text-muted-foreground" : "text-destructive")}>
              {radiusSah ? t("radiusIsi") : t("rentang", { min: RADIUS_GLOBAL_MIN, maks: RADIUS_GLOBAL_MAKS })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="checkin-akurasi">{t("akurasiLabel")}</Label>
            <div className="relative">
              <Input
                id="checkin-akurasi"
                type="text"
                inputMode="numeric"
                className="pr-9 text-right tabular-nums"
                value={akurasi}
                aria-invalid={!akurasiSah}
                onChange={(e) => setAkurasi(angkaSaja(e.target.value).slice(0, 4))}
                disabled={nonaktif}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {t("meter")}
              </span>
            </div>
            <p className={cn("text-xs", akurasiSah ? "text-muted-foreground" : "text-destructive")}>
              {akurasiSah ? t("akurasiIsi") : t("rentang", { min: AKURASI_MAKS_MIN, maks: AKURASI_MAKS_MAKS })}
            </p>
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t("catatanPalsu")}</span>
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="link" className="h-auto px-0">
            <Link href="/backoffice/stores">
              {t("radiusPerToko")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !radiusSah || !akurasiSah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
