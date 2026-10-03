"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { simpanAturanTitipPesan } from "@/app/actions/settings/spg-titip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AturanTitipPesan } from "@/lib/spg/pengaturan";

const MIN = 1;
const MAKS = 30;

/**
 * Titip pesan: berapa hari barang yang sudah datang disimpankan untuk pembeli
 * sesudah SPG mengabarinya lewat WhatsApp. Tanggal terakhirnya ikut tertulis
 * di pesan ke pembeli. Mengubahnya tidak menggeser titipan yang sudah dikabari.
 */
export function TitipPesanCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanTitipPesan }) {
  const t = useTranslations("spgTitip.pengaturan");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [hari, setHari] = useState(String(nilai.hariSimpan));

  const angka = Number(hari);
  const sah = Number.isInteger(angka) && angka >= MIN && angka <= MAKS;
  const berubah = sah && angka !== nilai.hariSimpan;
  const nonaktif = !bolehUbah || sibuk;

  const simpan = () =>
    mulai(async () => {
      if (!sah) return;
      let r: Awaited<ReturnType<typeof simpanAturanTitipPesan>>;
      try {
        r = await simpanAturanTitipPesan({ hariSimpan: angka });
      } catch {
        toast.error(t("errUmum"));
        return;
      }
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? t("errTidakSah", { min: MIN, maks: MAKS }) : t("errIzin"));
        return;
      }
      toast.success(t("tersimpan"));
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="titip-hari-simpan">{t("hariSimpan")}</Label>
          <Input
            id="titip-hari-simpan"
            type="number"
            inputMode="numeric"
            min={MIN}
            max={MAKS}
            value={hari}
            onChange={(e) => setHari(e.target.value)}
            aria-invalid={!sah}
            disabled={nonaktif}
          />
          <p className={sah ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{t("hariSimpanIsi", { min: MIN, maks: MAKS })}</p>
        </div>
        <p className="text-xs text-muted-foreground">{bolehUbah ? t("catatan") : t("hanyaLihat")}</p>
        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
