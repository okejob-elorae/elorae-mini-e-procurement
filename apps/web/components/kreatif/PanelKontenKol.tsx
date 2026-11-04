import { kontenKolaborasi } from "@/lib/creative/konten-kol-queries";
import { bacaAmbangKreatif } from "@/lib/creative/pengaturan";
import { hariIniWib } from "@/lib/tanggal-isian";
import { PanelKontenKolKlien } from "./PanelKontenKolKlien";

/**
 * Panel Konten di rincian kolaborasi (server). Memuat semua konten
 * kolaborasi ini beserta draf, persetujuan, link tayang, dan SELURUH riwayat
 * angkanya; isiannya di `PanelKontenKolKlien`.
 */
export async function PanelKontenKol({ kolaborasiId, bolehMengelola }: { kolaborasiId: string; bolehMengelola: boolean }) {
  const hariIni = hariIniWib();
  const ambang = await bacaAmbangKreatif();
  const data = await kontenKolaborasi(kolaborasiId, { hariIni, ambang });
  if (!data) return null;
  return <PanelKontenKolKlien data={data} ambang={ambang} bolehMengelola={bolehMengelola} />;
}
