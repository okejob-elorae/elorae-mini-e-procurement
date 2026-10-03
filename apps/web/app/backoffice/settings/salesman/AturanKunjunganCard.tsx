"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { simpanAturanHasilKunjungan } from "@/app/actions/settings/salesman-kunjungan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AturanHasilKunjungan } from "@/lib/salesman/aturan-kunjungan";

/**
 * Hasil kunjungan: apakah salesman wajib memberi alasan bila pulang tanpa
 * transaksi (bawaan wajib) dan wajib memotret sebelum check-out (bawaan tidak).
 * Setiap saklar langsung tersimpan; bila gagal, saklar kembali ke posisi semula.
 */
export function AturanKunjunganCard({ bolehUbah, aturan }: { bolehUbah: boolean; aturan: AturanHasilKunjungan }) {
  const t = useTranslations("settings.salesman.kunjungan.hasil");
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [nilai, setNilai] = useState<AturanHasilKunjungan>(aturan);

  const ubah = (baru: AturanHasilKunjungan) => {
    const lama = nilai;
    setNilai(baru);
    mulai(async () => {
      const r = await simpanAturanHasilKunjungan(baru);
      if (!r.ok) {
        setNilai(lama);
        toast.error(r.code === "INVALID" ? tSalesman("errInvalid") : tSalesman("errForbidden"));
        return;
      }
      toast.success(tToasts("saved"));
      router.refresh();
    });
  };

  const nonaktif = !bolehUbah || sibuk;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="hasil-alasan-wajib" className="text-sm font-medium">
              {t("alasanJudul")}
            </Label>
            <p className="text-sm text-muted-foreground">{nilai.alasanWajib ? t("alasanNyala") : t("alasanMati")}</p>
          </div>
          <Switch
            id="hasil-alasan-wajib"
            checked={nilai.alasanWajib}
            disabled={nonaktif}
            onCheckedChange={(v) => ubah({ ...nilai, alasanWajib: v })}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="hasil-foto-wajib" className="text-sm font-medium">
              {t("fotoJudul")}
            </Label>
            <p className="text-sm text-muted-foreground">{nilai.fotoWajib ? t("fotoNyala") : t("fotoMati")}</p>
          </div>
          <Switch
            id="hasil-foto-wajib"
            checked={nilai.fotoWajib}
            disabled={nonaktif}
            onCheckedChange={(v) => ubah({ ...nilai, fotoWajib: v })}
          />
        </div>

        <p className="text-sm text-muted-foreground">{t("spgCatatan")}</p>
      </CardContent>
    </Card>
  );
}
