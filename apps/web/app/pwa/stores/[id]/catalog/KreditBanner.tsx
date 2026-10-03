"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Ban, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatIDR } from "@/lib/sales-orders/format";
import type { AlasanKredit, ModeKredit } from "@/lib/salesman/kredit";
import { cn } from "@/lib/utils";

export type PenilaianKatalog = {
  tingkat: ModeKredit;
  alasan: AlasanKredit[];
  /** Tagihan toko gagal dibaca di server — pesanan akan ditahan, bukan dinilai. */
  takTerbaca: boolean;
};

type T = ReturnType<typeof useTranslations>;

export function teksAlasanKredit(a: AlasanKredit, t: T): string {
  switch (a.kode) {
    case "LEWAT_JANJI":
      return t("alasanLewatJanji", { nilai: formatIDR(a.nilai), faktur: a.faktur });
    case "MELEBIHI_BATAS_NILAI":
      return t("alasanBatasNilai", { sisa: formatIDR(a.sisaSesudah), batas: formatIDR(a.batas) });
    case "MELEBIHI_BATAS_FAKTUR":
      return t("alasanBatasFaktur", { faktur: a.faktur, batas: a.batas });
  }
}

/**
 * Peringatan kredit di layar tinjau pesanan PUTUS. Kuning untuk PERINGATAN
 * (pesanan jalan), merah untuk TAHAN (tercatat tapi ditahan) dan BLOKIR
 * (tidak bisa dikirim — tombol Kirim dimatikan pemanggil).
 */
export function KreditBanner({ penilaian }: { penilaian: PenilaianKatalog }) {
  const t = useTranslations("pwa.kredit");
  const { tingkat, alasan, takTerbaca } = penilaian;
  const Ikon = tingkat === "BLOKIR" ? Ban : tingkat === "TAHAN" ? ShieldAlert : AlertTriangle;
  const judul = takTerbaca
    ? t("judulTakTerbaca")
    : tingkat === "BLOKIR"
      ? t("judulBlokir")
      : tingkat === "TAHAN"
        ? t("judulTahan")
        : t("judulPeringatan");
  return (
    <Alert
      variant={tingkat === "PERINGATAN" ? "default" : "destructive"}
      className={cn(
        tingkat === "PERINGATAN"
          ? "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "border-destructive/50 bg-destructive/10",
      )}
    >
      <Ikon />
      <AlertTitle className="line-clamp-none">{judul}</AlertTitle>
      <AlertDescription className={tingkat === "PERINGATAN" ? "text-amber-900/90 dark:text-amber-200/90" : undefined}>
        {takTerbaca ? (
          <p>{t("isiTakTerbaca")}</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4">
            {alasan.map((a) => (
              <li key={a.kode}>{teksAlasanKredit(a, t)}</li>
            ))}
          </ul>
        )}
        {tingkat === "BLOKIR" && <p>{t("isiBlokir")}</p>}
        {tingkat === "TAHAN" && !takTerbaca && <p>{t("isiTahan")}</p>}
      </AlertDescription>
    </Alert>
  );
}
