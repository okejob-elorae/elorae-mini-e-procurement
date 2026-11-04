"use client";

import { useTranslations } from "next-intl";
import { MessageSquareWarning } from "lucide-react";

/**
 * Permintaan koreksi yang sudah dikirim dan masih menunggu kantor. Menggantikan
 * tombolnya, supaya sales tahu permintaannya sampai dan tidak mengirim ulang.
 */
export function KoreksiTerkirim({ pada, alasan }: { pada: string; alasan: string }) {
  const t = useTranslations("pwaTarik");
  return (
    <div className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
      <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        <span className="block">{t("koreksiTerkirim", { tanggal: pada })}</span>
        {alasan && <span className="block text-muted-foreground">{alasan}</span>}
      </span>
    </div>
  );
}
