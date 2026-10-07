import { hariIniWib } from "@/lib/tanggal-isian";
import { dataPanelBayar } from "@/lib/creative/bayar-queries";
import { PanelBayarKlien } from "./PanelBayarKlien";

/**
 * Panel pembayaran di rincian kolaborasi — komponen SERVER (membaca basis
 * data). Isi dan formulirnya di `PanelBayarKlien`. Riwayatnya dibaca dari
 * jejak `PEMBAYARAN_KOL_DICATAT`, karena baris kolaborasi hanya menyimpan
 * keadaan terakhir.
 */
export async function PanelBayar({ kolaborasiId, bolehMengelola }: { kolaborasiId: string; bolehMengelola: boolean }) {
  const hariIni = hariIniWib();
  const data = await dataPanelBayar(kolaborasiId, hariIni);
  return <PanelBayarKlien data={data} hariIni={hariIni} bolehMengelola={bolehMengelola} />;
}
