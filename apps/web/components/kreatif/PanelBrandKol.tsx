import { brandKol } from "@/lib/creative/brand-queries";
import { PanelBrandKolKlien } from "./PanelBrandKolKlien";

/*
 * Tab "Brand" di profil KOL (D1 rancangan KOL Manager lengkap). Komponen
 * server: membaca riwayat brand KOL itu lalu menyerahkannya ke klien untuk
 * ditampilkan, ditambah, dan dihapus (`creative:manage`).
 */
export async function PanelBrandKol({ kolId, bolehMengelola }: { kolId: string; bolehMengelola: boolean }) {
  const { baris, total } = await brandKol(kolId);
  return <PanelBrandKolKlien kolId={kolId} awal={baris} total={total} bolehMengelola={bolehMengelola} />;
}
