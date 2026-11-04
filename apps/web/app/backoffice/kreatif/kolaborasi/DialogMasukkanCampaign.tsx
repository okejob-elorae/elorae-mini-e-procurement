"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pindahkanKeCampaignAction } from "@/app/actions/kreatif-kolaborasi";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import { useTeksGalatKolaborasi } from "./usePindahTahap";

/**
 * Aksi massal "Masukkan ke campaign" di daftar Kolaborasi: campaign kolaborasi
 * yang dipilih diganti di tempat. Hanya campaign aktif yang ditawarkan; yang
 * dilewati (sudah di sana, atau KOL-nya sudah punya kolaborasi di sana)
 * disebut di toast.
 */
export function DialogMasukkanCampaign({
  buka,
  onBuka,
  ids,
  campaigns,
  onSelesai,
}: {
  buka: boolean;
  onBuka: (b: boolean) => void;
  ids: string[];
  campaigns: PilihanCampaign[];
  onSelesai: () => void;
}) {
  const t = useTranslations("kreatifRuang.kolaborasi");
  const galat = useTeksGalatKolaborasi();
  const router = useRouter();
  const [campaignId, setCampaignId] = useState("");
  const [sedang, mulai] = useTransition();
  const aktif = campaigns.filter((c) => !c.arsip);

  const lanjut = () => {
    const c = aktif.find((x) => x.id === campaignId);
    if (!c) return;
    mulai(async () => {
      const r = await pindahkanKeCampaignAction(ids, c.id);
      if (!r.ok) {
        toast.error(galat(r.kode));
        return;
      }
      const lewat = r.sudahAda + r.kembar;
      const pesan =
        lewat === 0
          ? t("ok.masukkan", { dipindah: r.dipindah, campaign: c.name })
          : t("ok.masukkanLewati", { dipindah: r.dipindah, campaign: c.name, sudahAda: r.sudahAda, kembar: r.kembar });
      if (r.dipindah > 0) toast.success(pesan);
      else toast.warning(pesan);
      onBuka(false);
      setCampaignId("");
      onSelesai();
      router.refresh();
    });
  };

  return (
    <Dialog open={buka} onOpenChange={onBuka}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("masukkan.judul", { n: ids.length })}</DialogTitle>
          <DialogDescription>{t("masukkan.deskripsi")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="masuk-campaign">{t("masukkan.pilih")}</Label>
          <Select value={campaignId} onValueChange={setCampaignId}>
            <SelectTrigger id="masuk-campaign" className="w-full">
              <SelectValue placeholder={t("masukkan.pilih")} />
            </SelectTrigger>
            <SelectContent>
              {aktif.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onBuka(false)} disabled={sedang}>
            {t("masukkan.batal")}
          </Button>
          <Button onClick={lanjut} disabled={!campaignId || sedang || ids.length === 0}>
            {t("masukkan.lanjut")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
