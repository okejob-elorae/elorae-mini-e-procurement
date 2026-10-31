"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { kunciGalatJubelio, type GagalJubelio } from "./galat-jubelio";

/** Pesan galat Jubelio untuk toast: hanya kalimat Indonesia, tanpa teks teknis. */
export function usePesanGalatJubelio() {
  const t = useTranslations("jubelio.galat");
  return (gagal: Pick<GagalJubelio, "code">) => t(kunciGalatJubelio(gagal.code));
}

/**
 * Galat di dalam kartu: kalimat yang bisa ditindaklanjuti, teks teknisnya
 * dilipat di balik "Rincian".
 */
export function RincianGalat({ gagal }: { gagal: GagalJubelio }) {
  const t = useTranslations("jubelio.galat");
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 space-y-1">
        <p>{t(kunciGalatJubelio(gagal.code))}</p>
        {gagal.rincian ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("rincian")}</summary>
            <p className="mt-1 break-words font-mono">{gagal.rincian}</p>
          </details>
        ) : null}
      </div>
    </div>
  );
}
