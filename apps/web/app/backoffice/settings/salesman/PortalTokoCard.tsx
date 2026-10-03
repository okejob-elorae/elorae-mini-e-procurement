"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link2, Loader2 } from "lucide-react";
import { simpanAturanPortalToko } from "@/app/actions/settings/salesman-portal-toko";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  bacaAturanPortalToko,
  BATAS_MASA_BERLAKU,
  BATAS_PESANAN_PER_HARI,
  sahkanAturanPortalToko,
} from "@/lib/field-sales/portal-toko-aturan";

/**
 * Portal pesan mandiri toko: toko memesan sendiri lewat tautan, tanpa
 * didatangi salesman. Bawaan: dinyalakan, tautan berlaku 90 hari, 5 pesanan
 * per toko per hari. Mematikan portal langsung mematikan SEMUA tautan toko.
 *
 * Menerima nilai MENTAH `SystemSetting["salesman.portalToko"]` dan membacanya
 * dengan pembaca yang sama dengan server.
 */
export function PortalTokoCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: string | null }) {
  const t = useTranslations("portalToko.pengaturan");
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const aturan = bacaAturanPortalToko(nilai);
  const [aktif, setAktif] = useState(aturan.aktif);
  const [masa, setMasa] = useState(String(aturan.masaBerlakuHari));
  const [maks, setMaks] = useState(String(aturan.maksPesananPerHari));

  const usulan = sahkanAturanPortalToko({ aktif, masaBerlakuHari: Number(masa), maksPesananPerHari: Number(maks) });
  const berubah =
    aktif !== aturan.aktif || Number(masa) !== aturan.masaBerlakuHari || Number(maks) !== aturan.maksPesananPerHari;

  const simpan = () =>
    mulai(async () => {
      if (!usulan) {
        toast.error(tSalesman("errInvalid"));
        return;
      }
      const r = await simpanAturanPortalToko(usulan);
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
          <Link2 className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="portal-toko-aktif" className="cursor-pointer">
              {t("aktif")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("aktifIsi")}</p>
          </div>
          <Switch id="portal-toko-aktif" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="portal-toko-masa">{t("masaBerlaku")}</Label>
            <Input
              id="portal-toko-masa"
              type="number"
              inputMode="numeric"
              min={BATAS_MASA_BERLAKU.min}
              max={BATAS_MASA_BERLAKU.maks}
              value={masa}
              onChange={(e) => setMasa(e.target.value)}
              disabled={nonaktif}
            />
            <p className="text-xs text-muted-foreground">{t("masaBerlakuIsi", { min: BATAS_MASA_BERLAKU.min, maks: BATAS_MASA_BERLAKU.maks })}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-toko-maks">{t("maksPesanan")}</Label>
            <Input
              id="portal-toko-maks"
              type="number"
              inputMode="numeric"
              min={BATAS_PESANAN_PER_HARI.min}
              max={BATAS_PESANAN_PER_HARI.maks}
              value={maks}
              onChange={(e) => setMaks(e.target.value)}
              disabled={nonaktif}
            />
            <p className="text-xs text-muted-foreground">
              {t("maksPesananIsi", { min: BATAS_PESANAN_PER_HARI.min, maks: BATAS_PESANAN_PER_HARI.maks })}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("aturanSama")}</p>
        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah || !usulan}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
