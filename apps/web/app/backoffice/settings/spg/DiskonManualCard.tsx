"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { HandCoins, Loader2 } from "lucide-react";
import { simpanDiskonManualSpg } from "@/app/actions/settings/spg-diskon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dinamis } from "@/lib/i18n/dinamis";
import { DISKON_MANUAL_BAWAAN, type AturanDiskonManualSpg } from "@/lib/spg/pengaturan";
import { sahkanDiskonManual } from "@/lib/spg/promo-konter-kantor";

const angka = (s: string) => (s.trim() === "" ? Number.NaN : Number(s.replace(",", ".")));

/**
 * Diskon manual SPG di konter. Bawaan MATI: SPG tidak bisa memberi potongan
 * sendiri sampai kantor menyalakannya. Diskon manual dihitung SESUDAH promo,
 * dari nilai bersih nota, dibatasi persen per nota, dan tercatat di nota
 * beserta alasannya. Diubah oleh pengelola promo (`promos:manage`).
 */
export function DiskonManualCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanDiskonManualSpg }) {
  const t = useTranslations("pengaturanDiskonManualSpg");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [aktif, setAktif] = useState(nilai.aktif);
  const [maks, setMaks] = useState(String(nilai.maksPersen));
  const [alasanWajib, setAlasanWajib] = useState(nilai.alasanWajib);
  const [bagianToko, setBagianToko] = useState(String(nilai.bagianTokoPersen));

  const isian = { aktif, maksPersen: angka(maks), alasanWajib, bagianTokoPersen: angka(bagianToko) };
  const sah = sahkanDiskonManual(isian);
  const berubah = JSON.stringify(isian) !== JSON.stringify(nilai);
  const nonaktif = !bolehUbah || sibuk;
  const maksSah = Number.isInteger(isian.maksPersen) && isian.maksPersen >= 0 && isian.maksPersen <= 100;

  const simpan = () => {
    if (!sah) return;
    mulai(async () => {
      try {
        const r = await simpanDiskonManualSpg(sah);
        if (!r.ok) {
          toast.error(td(`err.${r.code}`));
          return;
        }
        toast.success(t("tersimpan"));
        router.refresh();
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });
  };

  const pakaiBawaan = () => {
    setAktif(DISKON_MANUAL_BAWAAN.aktif);
    setMaks(String(DISKON_MANUAL_BAWAAN.maksPersen));
    setAlasanWajib(DISKON_MANUAL_BAWAAN.alasanWajib);
    setBagianToko(String(DISKON_MANUAL_BAWAAN.bagianTokoPersen));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HandCoins className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <Label htmlFor="diskon-manual-aktif" className="cursor-pointer">
            <span className="block">{t("aktif")}</span>
            <span className="block text-xs font-normal text-muted-foreground">{aktif ? t("aktifYa") : t("aktifTidak")}</span>
          </Label>
          <Switch id="diskon-manual-aktif" checked={aktif} disabled={nonaktif} onCheckedChange={setAktif} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="diskon-manual-maks">{t("maksPersen")}</Label>
            <Input
              id="diskon-manual-maks"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={maks}
              disabled={nonaktif}
              aria-invalid={!maksSah}
              onChange={(e) => setMaks(e.target.value)}
            />
            <p className={maksSah ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{maksSah ? t("maksBantu") : t("maksSalah")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diskon-manual-toko">{t("bagianToko")}</Label>
            <Input
              id="diskon-manual-toko"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              value={bagianToko}
              disabled={nonaktif}
              onChange={(e) => setBagianToko(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("bagianTokoBantu")}</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border p-3">
          <Label htmlFor="diskon-manual-alasan" className="cursor-pointer">
            <span className="block">{t("alasanWajib")}</span>
            <span className="block text-xs font-normal text-muted-foreground">{t("alasanBantu")}</span>
          </Label>
          <Switch id="diskon-manual-alasan" checked={alasanWajib} disabled={nonaktif} onCheckedChange={setAlasanWajib} />
        </div>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("urutan")}</li>
          <li>{t("tercatat")}</li>
          <li>{t("pengawasan")}</li>
        </ul>

        {!bolehUbah ? <p className="text-sm text-amber-700 dark:text-amber-400">{t("hanyaLihat")}</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={pakaiBawaan} disabled={nonaktif}>
            {t("pakaiBawaan")}
          </Button>
          <Button onClick={simpan} disabled={nonaktif || !berubah || !sah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
        {berubah && !sah && bolehUbah ? <p className="text-right text-xs text-destructive">{t("isianSalah")}</p> : null}
      </CardContent>
    </Card>
  );
}
