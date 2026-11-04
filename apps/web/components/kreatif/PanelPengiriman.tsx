import { dataPanelPengiriman } from "@/lib/creative/sampel-queries";
import { PanelPengirimanClient } from "./pengiriman/PanelPengirimanClient";

/**
 * Panel Pengiriman untuk halaman detail kolaborasi — komponen server async:
 * memuat paket-paket sampel kolaborasinya lalu menyerahkannya ke klien.
 * Kolaborasi yang tidak ada tidak merender apa pun (halamannya sendiri yang
 * memutuskan 404).
 */
export async function PanelPengiriman({ kolaborasiId, bolehMengelola }: { kolaborasiId: string; bolehMengelola: boolean }) {
  const data = await dataPanelPengiriman(kolaborasiId);
  if (!data) return null;
  return <PanelPengirimanClient data={data} bolehMengelola={bolehMengelola} />;
}
