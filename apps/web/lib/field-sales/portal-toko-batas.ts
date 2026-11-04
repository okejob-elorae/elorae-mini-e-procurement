/**
 * Pembatas portal toko — pratinjau dan kiriman per tautan per menit, plus galat
 * batas pesanan harian. Murni (tanpa Prisma): penulis pesanan (`writer.ts`)
 * mengimpor galatnya tanpa menarik modul portal.
 *
 * Kenapa peta memori proses, bukan menghitung baris AuditLog:
 * - Pratinjau adalah titik PUBLIK. Menulis satu baris AuditLog per pratinjau
 *   memberi pemegang tautan cara menggembungkan AuditLog (dan setiap pratinjau
 *   jadi satu tulisan basis data) — pembatasnya sendiri jadi celah.
 * - Produksi menjalankan satu proses web (layanan `web` docker compose), jadi
 *   jendela di memori tepat di sana. Mulai ulang mengosongkannya — diterima:
 *   ini rem penebak, bukan pembukuan. Bila kelak berjalan N proses, batas
 *   efektifnya menjadi N × batas ini.
 */

/** Pratinjau + kiriman per tautan per jendela. Ubah di sini saja. */
export const MAKS_PERIKSA_PORTAL_PER_MENIT = 30;
export const JENDELA_PERIKSA_PORTAL_MS = 60_000;

export type PembatasJendela = {
  /** true = boleh (dan dicatat); false = sudah penuh (tidak dicatat). */
  coba(kunci: string, sekarang?: number): boolean;
  ukuran(): number;
  kosongkan(): void;
};

/** Jendela geser: setiap kunci menyimpan waktu percobaan yang diterima di jendela terakhir. */
export function buatPembatasJendela(maks: number, jendelaMs: number): PembatasJendela {
  const peta = new Map<string, number[]>();
  let sapuTerakhir = 0;

  function sapu(sekarang: number) {
    for (const [k, w] of peta) if (w.length === 0 || sekarang - w[w.length - 1] >= jendelaMs) peta.delete(k);
    sapuTerakhir = sekarang;
  }

  return {
    coba(kunci, sekarang = Date.now()) {
      if (sekarang - sapuTerakhir >= jendelaMs) sapu(sekarang);
      const waktu = (peta.get(kunci) ?? []).filter((t) => sekarang - t < jendelaMs);
      if (waktu.length >= maks) {
        peta.set(kunci, waktu);
        return false;
      }
      waktu.push(sekarang);
      peta.set(kunci, waktu);
      return true;
    },
    ukuran: () => peta.size,
    kosongkan: () => peta.clear(),
  };
}

/** Satu per proses — dipakai aksi publik portal (app/actions/portal-toko.ts). */
export const pembatasPeriksaPortal = buatPembatasJendela(MAKS_PERIKSA_PORTAL_PER_MENIT, JENDELA_PERIKSA_PORTAL_MS);

/** Dilempar penulis pesanan (di dalam transaksinya) saat pesanan portal hari ini sudah mencapai batas. */
export class BatasHarianPortalError extends Error {
  constructor(public readonly batas: number) {
    super(`Batas harian pesanan portal (${batas}) sudah tercapai`);
    this.name = "BatasHarianPortalError";
  }
}
