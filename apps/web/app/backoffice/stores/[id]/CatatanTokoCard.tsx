"use client";

import { useTranslations } from "next-intl";
import { StickyNote } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PanelCatatanToko } from "@/components/catatan-toko/PanelCatatanToko";
import type { CatatanTampil } from "@/lib/stores/catatan-queries";

/**
 * Kartu "Catatan toko" di detail toko kantor — catatan yang sama dengan yang
 * dilihat salesman/SPG di HP. `stores:view` membaca dan menambah; ubah/hapus/
 * semat milik sendiri, atau semua dengan `stores:manage` (hak per baris dari server).
 */
export function CatatanTokoCard({ storeId, catatan }: { storeId: string; catatan: CatatanTampil[] }) {
  const t = useTranslations("catatanToko");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StickyNote className="h-5 w-5" aria-hidden />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("subjudulKantor")}</CardDescription>
      </CardHeader>
      <CardContent>
        <PanelCatatanToko storeId={storeId} catatan={catatan} bolehTulis sisi="right" batasAwal={5} />
      </CardContent>
    </Card>
  );
}
