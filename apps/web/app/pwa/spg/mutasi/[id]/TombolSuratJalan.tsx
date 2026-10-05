"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RincianMutasiHp } from "@/lib/spg/mutasi-queries";
import { keadaanSuratJalan, tautanSuratJalanHp, teksBagikanSuratJalan } from "@/lib/spg/surat-jalan";

const tanpaLangganan = () => () => undefined;
const bisaBagikanServer = () => false;
const bisaBagikan = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Surat jalan di rincian mutasi HP (toko asal maupun tujuan). "Cetak / simpan
 * PDF" membuka dokumen A4 di halaman sendiri yang langsung masuk jendela cetak
 * peramban — di sana SPG memilih printer atau "Simpan sebagai PDF". Tautan
 * biasa (`<a>`), bukan `Link`: tujuannya dokumen HTML dari rute, bukan halaman
 * aplikasi, dan pra-ambil `Link` akan memanggilnya diam-diam.
 *
 * "Bagikan" mengikuti nota SPG: teks ringkas tanpa harga lewat `navigator.share`.
 */
export function TombolSuratJalan({ rincian }: { rincian: Pick<RincianMutasiHp, "id" | "docNo" | "status" | "asal" | "tujuan" | "baris"> }) {
  const t = useTranslations("suratJalanMutasi");
  // Deteksi lewat useSyncExternalStore: navigator tidak ada di server.
  const canShare = useSyncExternalStore(tanpaLangganan, bisaBagikan, bisaBagikanServer);
  const keadaan = keadaanSuratJalan(rincian.status);
  if (keadaan === "TIDAK_BISA") return null;

  async function bagikan() {
    try {
      await navigator.share({ title: t("judulBagikan", { docNo: rincian.docNo }), text: teksBagikanSuratJalan(rincian) });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error(t("gagalBagikan"));
    }
  }

  return (
    <section className="beranda-kartu space-y-3" aria-labelledby="judul-surat-jalan">
      <div className="space-y-1">
        <h2 id="judul-surat-jalan" className="font-semibold leading-tight">
          {t("judul")}
        </h2>
        {keadaan === "DRAF" ? <p className="text-sm text-muted-foreground">{t("drafIsi")}</p> : null}
      </div>
      <Button asChild variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2">
        <a href={tautanSuratJalanHp(rincian.id)}>
          <Printer className="h-4 w-4" aria-hidden />
          {t("cetak")}
        </a>
      </Button>
      {canShare ? (
        <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal py-2" onClick={bagikan}>
          <Share2 className="h-4 w-4" aria-hidden />
          {t("bagikan")}
        </Button>
      ) : null}
    </section>
  );
}
