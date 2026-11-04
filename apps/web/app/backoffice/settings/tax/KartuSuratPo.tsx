"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ambilSuratPo, simpanSuratPo } from "@/app/actions/settings/surat-po";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { MAKS_PANJANG_SURAT_PO, SURAT_PO_BAWAAN, type SuratPo } from "@/lib/purchase-orders/surat-po";

/**
 * Pengaturan → Pajak → Surat PO: paragraf pembuka dan penutup bawaan cetak PO.
 * Diubah dengan izin yang sama dengan tarif PPN; setiap simpan tercatat di
 * jejak audit. Per cetak, teksnya masih bisa diubah di dialog Cetak PO.
 */
export function KartuSuratPo() {
  const t = useTranslations("tax.suratPo");
  const { data: session } = useSession();
  const bolehUbah = hasPermission(session?.user?.permissions ?? [], PERMISSIONS.SETTINGS_TAX_MANAGE);
  const [surat, setSurat] = useState<SuratPo | null>(null);
  const [menyimpan, mulai] = useTransition();

  useEffect(() => {
    let batal = false;
    ambilSuratPo()
      .then((h) => {
        if (batal) return;
        if (h.ok) setSurat(h.surat);
        else toast.error(t("gagalMuat"));
      })
      .catch(() => {
        if (!batal) toast.error(t("gagalMuat"));
      });
    return () => {
      batal = true;
    };
  }, [t]);

  const simpan = () => {
    if (!surat) return;
    mulai(async () => {
      try {
        const h = await simpanSuratPo(surat);
        if (h.ok) toast.success(t("tersimpan"));
        else toast.error(t(`err.${h.code}`));
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("judul")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!surat ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("memuat")}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="surat-pembuka">{t("pembuka")}</Label>
              <Textarea
                id="surat-pembuka"
                rows={3}
                maxLength={MAKS_PANJANG_SURAT_PO}
                value={surat.pembuka}
                disabled={!bolehUbah}
                onChange={(e) => setSurat({ ...surat, pembuka: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="surat-penutup">{t("penutup")}</Label>
              <Textarea
                id="surat-penutup"
                rows={3}
                maxLength={MAKS_PANJANG_SURAT_PO}
                value={surat.penutup}
                disabled={!bolehUbah}
                onChange={(e) => setSurat({ ...surat, penutup: e.target.value })}
              />
            </div>
            {bolehUbah ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={simpan} disabled={menyimpan}>
                  {menyimpan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t("simpan")}
                </Button>
                <Button type="button" variant="outline" disabled={menyimpan} onClick={() => setSurat({ ...SURAT_PO_BAWAAN })}>
                  {t("pakaiBawaan")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
