import { penjualanKolaborasi } from "@/lib/creative/penjualan-queries";
import { PanelPenjualanKlien } from "./PanelPenjualanKlien";

/**
 * Panel Penjualan di rincian kolaborasi (server): penjualan afiliasi yang
 * diketik per kolaborasi (tanggal, order, GMV, komisi, sumber) beserta
 * totalnya. GMV dan ROAS gabungan tetap dihitung `angka-queries.ts`.
 */
export async function PanelPenjualan({ kolaborasiId, bolehMengelola }: { kolaborasiId: string; bolehMengelola: boolean }) {
  const data = await penjualanKolaborasi(kolaborasiId);
  return <PanelPenjualanKlien kolaborasiId={kolaborasiId} baris={data.baris} total={data.total} bolehMengelola={bolehMengelola} />;
}
