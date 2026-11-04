import { catatanDanRiwayat } from "@/lib/creative/kol-queries";
import { LinimasaCatatan } from "./LinimasaCatatan";

/*
 * Panel "Catatan & riwayat" untuk profil KOL dan rincian kolaborasi
 * (2026-10-07). Komponen server: membaca linimasa (catatan manual + riwayat
 * otomatis dari jejak), lalu menyerahkannya ke `LinimasaCatatan` di klien —
 * aplikasi ini tidak punya penerjemah di server, jadi label riwayat disusun di
 * klien.
 *
 * Dengan `kolaborasiId`: catatan dan riwayat kolaborasi itu. Hanya `kolId`:
 * semua catatan KOL itu (termasuk catatan kolaborasinya) dan riwayat KOL-nya.
 */
export async function PanelCatatan({
  kolId,
  kolaborasiId,
  bolehMengelola,
}: {
  kolId?: string;
  kolaborasiId?: string;
  bolehMengelola: boolean;
}) {
  const item = await catatanDanRiwayat({ kolId: kolId ?? null, kolaborasiId: kolaborasiId ?? null });
  return (
    <LinimasaCatatan
      kolId={kolId ?? null}
      kolaborasiId={kolaborasiId ?? null}
      bolehMengelola={bolehMengelola}
      awal={item}
    />
  );
}
