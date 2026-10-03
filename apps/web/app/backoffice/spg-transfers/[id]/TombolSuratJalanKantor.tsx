"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StatusMutasi } from "@/lib/spg/mutasi-aturan";
import { keadaanSuratJalan, tautanSuratJalanKantor } from "@/lib/spg/surat-jalan";

/**
 * Surat jalan dari layar kantor: dokumen yang sama dengan HP SPG, dibuka di tab
 * baru dan langsung masuk jendela cetak (printer atau "Simpan sebagai PDF").
 * Mutasi yang ditolak/dibatalkan/dikembalikan tidak punya surat jalan.
 * Tautan biasa, bukan `Link` — tujuannya dokumen HTML dari rute, tanpa pra-ambil.
 */
export function TombolSuratJalanKantor({ id, status }: { id: string; status: StatusMutasi }) {
  const t = useTranslations("suratJalanMutasi");
  const keadaan = keadaanSuratJalan(status);
  if (keadaan === "TIDAK_BISA") return null;
  return (
    <div className="flex max-w-xs flex-col items-start gap-1">
      <Button asChild variant="outline">
        <a href={tautanSuratJalanKantor(id)} target="_blank" rel="noopener noreferrer">
          <Printer className="h-4 w-4" aria-hidden />
          {t("cetak")}
        </a>
      </Button>
      <p className="text-xs text-muted-foreground">
        {keadaan === "DRAF" ? `${t("drafIsi")} ` : null}
        {t("petunjuk")}
      </p>
    </div>
  );
}
