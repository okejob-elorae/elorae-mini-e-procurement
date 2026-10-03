"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PanelTautanPortal } from "@/components/portal-toko/PanelTautanPortal";

/**
 * "Portal pesan toko" di halaman toko HP — hanya untuk salesman yang MEMEGANG
 * toko ini (pemanggil memutuskan tampil-tidaknya; aksinya menilai ulang).
 * Lembarnya membuat tautan, membagikannya lewat WhatsApp, dan mencabutnya.
 * Daftar dimuat saat lembar dibuka, bukan saat halaman toko dimuat.
 */
export function TombolPortalToko({
  storeId,
  namaToko,
  teleponToko,
}: {
  storeId: string;
  namaToko: string;
  teleponToko: string | null;
}) {
  const t = useTranslations("portalToko.kelola");
  const [buka, setBuka] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setBuka(true)}>
        <Link2 className="h-4 w-4" aria-hidden />
        {t("tombol")}
      </Button>
      <Sheet open={buka} onOpenChange={setBuka}>
        <SheetContent side="bottom" className="flex max-h-[90vh] flex-col gap-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{t("judul")}</SheetTitle>
            <SheetDescription>{namaToko}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4">
            {buka && <PanelTautanPortal storeId={storeId} namaToko={namaToko} teleponToko={teleponToko} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
