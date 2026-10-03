"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { simpanAturanTutupHari } from "@/app/actions/settings/spg-tutup-hari";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AturanTutupHari } from "@/lib/spg/pengaturan";

type Kunci = keyof AturanTutupHari;
const SAKLAR: Kunci[] = ["tanyaPengunjung", "tanyaTotalKasir", "wajibFoto"];

/**
 * Isian laporan tutup hari SPG. Angka penjualan selalu dihitung sistem; yang
 * diatur di sini hanya apa yang DITANYAKAN ke SPG: jumlah pengunjung, total
 * kasir toko untuk merek kita (selisihnya ditandai), dan apakah foto wajib.
 * Bawaan: pengunjung dan kasir ditanyakan (boleh kosong), foto tidak wajib.
 */
export function TutupHariCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: AturanTutupHari }) {
  const t = useTranslations("spgTutupHari.pengaturan");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [isi, setIsi] = useState<AturanTutupHari>(nilai);
  const berubah = SAKLAR.some((k) => isi[k] !== nilai[k]);

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAturanTutupHari(isi);
      if (!r.ok) {
        toast.error(r.code === "INVALID" ? t("errInvalid") : t("errForbidden"));
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
          <ClipboardCheck className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {SAKLAR.map((k) => (
          <div key={k} className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor={`tutup-hari-${k}`} className="cursor-pointer">
                {t(`${k}.label`)}
              </Label>
              <p className="text-xs text-muted-foreground">{t(`${k}.isi`)}</p>
            </div>
            <Switch
              id={`tutup-hari-${k}`}
              checked={isi[k]}
              onCheckedChange={(v) => setIsi((lama) => ({ ...lama, [k]: v }))}
              disabled={nonaktif}
            />
          </div>
        ))}
        {!bolehUbah ? <p className="text-xs text-muted-foreground">{t("hanyaLihat")}</p> : null}
        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
