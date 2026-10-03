"use client";

import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const LANGKAH = ["satu", "prioritas", "paket", "belanja", "manual", "waktu"] as const;

/**
 * Aturan tumpuk promo konter dalam bahasa awam — terjemahan kepala
 * `lib/spg/promo-konter.ts`. Kalau aturan di mesin berubah, teks ini ikut.
 */
export function AturanTumpukPromo() {
  const t = useTranslations("promoKonter.aturan");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-5 w-5" />
          {t("judul")}
        </CardTitle>
        <CardDescription>{t("pengantar")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {LANGKAH.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
