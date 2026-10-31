"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, CreditCard, Loader2 } from "lucide-react";
import { simpanAturanKredit } from "@/app/actions/settings/salesman";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MODE_KREDIT, type AturanKredit, type ModeKredit } from "@/lib/salesman/kredit";
import { cn } from "@/lib/utils";

const angkaSaja = (s: string) => s.replace(/\D/g, "");
const kelompok = new Intl.NumberFormat("id-ID");
const keAngka = (s: string): number | null => (s === "" ? null : Number(s));

/**
 * Batas kredit toko: bagaimana pesanan PUTUS diperlakukan saat toko menunggak
 * atau melewati batas. Batas di sini adalah BAWAAN — batas per toko di master
 * toko menimpanya. Toko konsinyasi tidak pernah dinilai (tidak punya piutang).
 */
export function KreditTokoCard({
  bolehUbah,
  aturan,
  tokoBatasSendiri,
}: {
  bolehUbah: boolean;
  aturan: AturanKredit;
  /** Toko PUTUS aktif yang punya batas sendiri. */
  tokoBatasSendiri: number;
}) {
  const t = useTranslations("settings.salesman.kredit");
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const [mode, setMode] = useState<ModeKredit>(aturan.mode);
  const [batasNilai, setBatasNilai] = useState(aturan.batasNilai === null ? "" : String(Math.round(aturan.batasNilai)));
  const [batasFaktur, setBatasFaktur] = useState(aturan.batasFaktur === null ? "" : String(aturan.batasFaktur));
  const [hari, setHari] = useState(String(aturan.hariToleransi));

  const hariValid = /^\d+$/.test(hari) && Number(hari) <= 365;
  const berubah =
    mode !== aturan.mode ||
    keAngka(batasNilai) !== (aturan.batasNilai === null ? null : Math.round(aturan.batasNilai)) ||
    keAngka(batasFaktur) !== aturan.batasFaktur ||
    Number(hari) !== aturan.hariToleransi;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAturanKredit({
        mode,
        batasNilai: keAngka(batasNilai),
        batasFaktur: keAngka(batasFaktur),
        hariToleransi: Number(hari),
      });
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? tSalesman("errInvalid") : tSalesman("errForbidden"));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });

  const nonaktif = !bolehUbah || sibuk;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label id="mode-kredit">{t("modeLabel")}</Label>
          <div role="radiogroup" aria-labelledby="mode-kredit" className="grid gap-2 sm:grid-cols-3">
            {MODE_KREDIT.map((m) => (
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

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="kredit-batas-nilai">{t("batasNilai")}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                Rp
              </span>
              <Input
                id="kredit-batas-nilai"
                type="text"
                inputMode="numeric"
                className="pl-9 text-right tabular-nums"
                value={batasNilai ? kelompok.format(Number(batasNilai)) : ""}
                placeholder={t("tanpaBatas")}
                onChange={(e) => setBatasNilai(angkaSaja(e.target.value).slice(0, 13))}
                disabled={nonaktif}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t("batasNilaiIsi")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kredit-batas-faktur">{t("batasFaktur")}</Label>
            <Input
              id="kredit-batas-faktur"
              type="text"
              inputMode="numeric"
              className="tabular-nums"
              value={batasFaktur}
              placeholder={t("tanpaBatas")}
              onChange={(e) => setBatasFaktur(angkaSaja(e.target.value).slice(0, 5))}
              disabled={nonaktif}
            />
            <p className="text-xs text-muted-foreground">{t("batasFakturIsi")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kredit-hari">{t("hariToleransi")}</Label>
            <Input
              id="kredit-hari"
              type="text"
              inputMode="numeric"
              className="tabular-nums"
              value={hari}
              placeholder="0"
              onChange={(e) => setHari(angkaSaja(e.target.value).slice(0, 3))}
              disabled={nonaktif}
            />
            <p className="text-xs text-muted-foreground">{t("hariToleransiIsi")}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {tokoBatasSendiri > 0 ? t("tokoBatasSendiri", { n: tokoBatasSendiri }) : t("perTokoIsi")}{" "}
            <Link href="/backoffice/stores" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
              {t("bukaMasterToko")}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !hariValid}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
