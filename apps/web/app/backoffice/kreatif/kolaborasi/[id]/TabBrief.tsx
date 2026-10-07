"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LABEL_PLATFORM } from "@/lib/creative/aturan";
import type { PilihanCampaign } from "@/lib/creative/campaign-queries";
import type { DetailKolaborasi, PilihanPengguna } from "@/lib/creative/kolaborasi-queries";
import { DialogKolaborasi } from "../DialogKolaborasi";
import { keAwalKolaborasi } from "./KepalaKolaborasi";

/**
 * Tab Brief: brief, yang harus ada / dihindari, deliverable, dan rencana
 * sampel. Pengelola mengubahnya lewat dialog kolaborasi yang sama.
 */
export function TabBrief({
  d,
  campaigns,
  pics,
  bolehMengelola,
}: {
  d: DetailKolaborasi;
  campaigns: PilihanCampaign[];
  pics: PilihanPengguna[];
  bolehMengelola: boolean;
}) {
  const t = useTranslations("kreatifRuang.kolaborasi.detail");
  const [ubah, setUbah] = useState(false);
  const kosong = !d.briefText && !d.doList && !d.dontList && d.deliverables.length === 0 && d.rencanaSampel.length === 0;
  return (
    <Card className="py-0">
      <CardContent className="space-y-5 p-4">
        {bolehMengelola ? (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => setUbah(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t("brief.ubah")}
            </Button>
          </div>
        ) : null}
        {kosong ? <p className="text-sm text-muted-foreground">{t("brief.kosong")}</p> : null}
        {d.briefText ? <p className="whitespace-pre-line text-sm">{d.briefText}</p> : null}
        {d.doList || d.dontList ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {d.doList ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">{t("brief.do")}</p>
                <p className="whitespace-pre-line text-sm">{d.doList}</p>
              </div>
            ) : null}
            {d.dontList ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">{t("brief.dont")}</p>
                <p className="whitespace-pre-line text-sm">{d.dontList}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {d.deliverables.length ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">{t("brief.deliverable")}</p>
            <ul className="space-y-0.5 text-sm">
              {d.deliverables.map((x) => (
                <li key={x.id}>
                  {t("deliverableBaris", {
                    platform: LABEL_PLATFORM[x.platform],
                    format: x.format.charAt(0) + x.format.slice(1).toLowerCase(),
                    qty: x.qty,
                  })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.rencanaSampel.length ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">{t("brief.sampel")}</p>
            <ul className="space-y-0.5 text-sm">
              {d.rencanaSampel.map((s) => (
                <li key={s.id}>
                  {t("sampelBaris", { nama: s.variantSku ? `${s.itemName} — ${s.variantSku}` : s.itemName, qty: s.qty })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {bolehMengelola ? (
          <DialogKolaborasi buka={ubah} onBuka={setUbah} campaigns={campaigns} pics={pics} awal={keAwalKolaborasi(d)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
