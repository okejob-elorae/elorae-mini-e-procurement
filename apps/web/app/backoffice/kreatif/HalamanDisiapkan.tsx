"use client";

import { useTranslations } from "next-intl";
import { Hammer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Kerangka sementara untuk layar Ruang KOL yang sedang dibangun. Setiap
 * halaman yang memakainya akan diganti layar sebenarnya; judulnya sudah
 * memakai kunci i18n final (`kreatifRuang.halaman.*`).
 */
export type KunciHalamanKreatif =
  | "hariIni"
  | "kolaborasi"
  | "detailKolaborasi"
  | "profilKol"
  | "campaign"
  | "detailCampaign"
  | "sampel"
  | "kontenKol"
  | "pembayaran"
  | "kalender"
  | "laporan"
  | "pengaturan";

export function HalamanDisiapkan({ judul }: { judul: KunciHalamanKreatif }) {
  const t = useTranslations("kreatifRuang");
  return (
    <div className="space-y-6">
      <PageHeader title={t(`halaman.${judul}`)} />
      <Card className="py-0">
        <CardContent className="p-0">
          <EmptyState icon={Hammer} title={t("disiapkan.judul")} description={t("disiapkan.isi")} />
        </CardContent>
      </Card>
    </div>
  );
}
