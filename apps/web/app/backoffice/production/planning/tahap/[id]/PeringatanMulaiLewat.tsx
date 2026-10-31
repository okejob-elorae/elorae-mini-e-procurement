"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PeringatanJadwal } from "./ruang-kerja";

/** Peringatan sebelum menyimpan jadwal mundur — lihat `peringatanJadwal`. */
export function PeringatanMulaiLewat({
  peringatan,
  pendek,
}: {
  peringatan: PeringatanJadwal | null;
  pendek: (teks: string | null) => string;
}) {
  const t = useTranslations("jadwalProduksi.ruang");
  if (!peringatan || peringatan.hari <= 0) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <span>
        {peringatan.jenis === "LEWAT_TENGGAT"
          ? t("lewatTenggat", { selesai: pendek(peringatan.selesai), n: peringatan.hari })
          : t("mulaiLewat", { langkah: peringatan.langkah, mulai: pendek(peringatan.mulai), n: peringatan.hari })}
      </span>
    </p>
  );
}
