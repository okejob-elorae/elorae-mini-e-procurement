"use client";

import { useTranslations } from "next-intl";
import { Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelTautanPortal } from "@/components/portal-toko/PanelTautanPortal";

/**
 * Kartu "Portal pesan toko" di detail toko (kantor): buat tautan, salin,
 * kirim lewat WhatsApp, cabut, dan daftar tautan dengan kapan terakhir dipakai.
 * Hanya untuk pemegang `stores:manage` — tanpa itu kartunya tidak tampil
 * (aksinya pun menolak).
 */
export function TautanPortalCard({
  storeId,
  namaToko,
  teleponToko,
  bolehKelola,
}: {
  storeId: string;
  namaToko: string;
  teleponToko: string | null;
  bolehKelola: boolean;
}) {
  const t = useTranslations("portalToko.kelola");
  if (!bolehKelola) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <PanelTautanPortal storeId={storeId} namaToko={namaToko} teleponToko={teleponToko} />
      </CardContent>
    </Card>
  );
}
