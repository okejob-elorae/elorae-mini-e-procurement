"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, MessageCircle } from "lucide-react";
import { simpanAturanJarakJauh } from "@/app/actions/settings/salesman-jarak-jauh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { bacaAturanJarakJauh } from "@/lib/field-sales/jarak-jauh";

/**
 * Pesanan jarak jauh: salesman mencatat pesanan toko yang masuk lewat
 * WhatsApp/telepon tanpa check-in. Bawaan: diizinkan, hanya untuk toko yang ia
 * pegang. Harga, promo, minimum, dan batas kredit tetap berlaku sama persis.
 *
 * Menerima nilai MENTAH `SystemSetting["salesman.pesananJarakJauh"]` dan
 * membacanya dengan pembaca yang sama dengan server.
 */
export function PesananJarakJauhCard({ bolehUbah, nilai }: { bolehUbah: boolean; nilai: string | null }) {
  const t = useTranslations("pwa.jarakJauh.pengaturan");
  const tSalesman = useTranslations("settings.salesman");
  const tToasts = useTranslations("toasts");
  const router = useRouter();
  const [sibuk, mulai] = useTransition();

  const aturan = bacaAturanJarakJauh(nilai);
  const [aktif, setAktif] = useState(aturan.aktif);
  const [hanyaTokoSendiri, setHanyaTokoSendiri] = useState(aturan.hanyaTokoSendiri);
  const berubah = aktif !== aturan.aktif || hanyaTokoSendiri !== aturan.hanyaTokoSendiri;

  const simpan = () =>
    mulai(async () => {
      const r = await simpanAturanJarakJauh({ aktif, hanyaTokoSendiri });
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
          <MessageCircle className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("penjelasan")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="jarak-jauh-aktif" className="cursor-pointer">
              {t("aktif")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("aktifIsi")}</p>
          </div>
          <Switch id="jarak-jauh-aktif" checked={aktif} onCheckedChange={setAktif} disabled={nonaktif} />
        </div>
        <div className="flex items-start justify-between gap-4 rounded-md border p-3">
          <div className="space-y-0.5">
            <Label htmlFor="jarak-jauh-sendiri" className="cursor-pointer">
              {t("hanyaTokoSendiri")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("hanyaTokoSendiriIsi")}</p>
          </div>
          <Switch
            id="jarak-jauh-sendiri"
            checked={hanyaTokoSendiri}
            onCheckedChange={setHanyaTokoSendiri}
            disabled={nonaktif || !aktif}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("aturanSama")}</p>
        <div className="flex justify-end">
          <Button onClick={simpan} disabled={nonaktif || !berubah}>
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : t("simpan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
