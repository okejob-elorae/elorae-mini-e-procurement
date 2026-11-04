"use client";

import { useTranslations } from "next-intl";
import { LinkIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Link formulir tidak dikenal, dicabut, kedaluwarsa, atau KOL-nya diblokir — SATU pesan untuk
 * semuanya, tanpa nama KOL atau keterangan tentang link-nya.
 */
export default function FormulirKolTidakBerlaku() {
  const t = useTranslations("formulirKol.mati");
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full py-0">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <LinkIcon className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold">{t("judul")}</h1>
          <p className="text-sm text-muted-foreground">{t("isi")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
