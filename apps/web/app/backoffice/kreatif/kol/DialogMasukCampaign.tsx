"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import { pesanGagalKol } from "./format-kol";
import { masukkanKeCampaign, TAHAP_AWAL_CAMPAIGN, type TahapAwalCampaign } from "./sambungan-campaign";

/**
 * "Masukkan ke campaign": buat kolaborasi untuk setiap KOL terpilih di satu
 * campaign, mulai dari tahap yang dipilih. KOL yang sudah punya kolaborasi di
 * campaign itu dilewati oleh aksinya.
 */
export function DialogMasukCampaign({
  buka,
  onBukaUbah,
  kolIds,
  campaign,
  onSelesai,
}: {
  buka: boolean;
  onBukaUbah: (b: boolean) => void;
  kolIds: string[];
  campaign: readonly PilihanCampaign[];
  onSelesai: () => void;
}) {
  const t = useTranslations("kreatifRuang");
  const [campaignId, setCampaignId] = useState("");
  const [tahap, setTahap] = useState<TahapAwalCampaign>("PROSPEK");
  const [sibuk, startSibuk] = useTransition();

  const masukkan = () => {
    if (!masukkanKeCampaign || !campaignId || kolIds.length === 0) return;
    const aksi = masukkanKeCampaign;
    startSibuk(async () => {
      const r = await aksi(kolIds, campaignId, tahap);
      if (!r.ok) {
        toast.error(pesanGagalKol(t, r.kode));
        return;
      }
      const pesan = [t("kol.campaign.ok", { dibuat: r.dibuat, ada: r.sudahAda })];
      if (r.diblokir) pesan.push(t("kol.campaign.okBlokir", { n: r.diblokir }));
      if (r.dibuat > 0) toast.success(pesan.join(" · "));
      else toast.warning(pesan.join(" · "));
      onBukaUbah(false);
      onSelesai();
    });
  };

  return (
    <Dialog open={buka} onOpenChange={onBukaUbah}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("kol.campaign.judul", { n: kolIds.length })}</DialogTitle>
        </DialogHeader>
        {campaign.length === 0 ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{t("kol.campaign.belumAda")}</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/backoffice/kreatif/campaign">{t("kol.campaign.buat")}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mc-campaign">{t("kol.campaign.campaign")}</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger id="mc-campaign" className="w-full">
                  <SelectValue placeholder={t("kol.campaign.pilihCampaign")} />
                </SelectTrigger>
                <SelectContent>
                  {campaign.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-tahap">{t("kol.campaign.tahapAwal")}</Label>
              <Select value={tahap} onValueChange={(v) => setTahap(v as TahapAwalCampaign)}>
                <SelectTrigger id="mc-tahap" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAHAP_AWAL_CAMPAIGN.map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`tahap.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t("kol.campaign.lewati")}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onBukaUbah(false)}>
            {t("kol.campaign.batal")}
          </Button>
          <Button onClick={masukkan} disabled={sibuk || !campaignId || !masukkanKeCampaign}>
            {sibuk && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("kol.campaign.masukkan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
