import { alamatPeminta, bacaBadan, gagalTakTerduga, jawab, tolak } from "@/lib/creative/pantau-api";
import { pembatasSambungPantau } from "@/lib/creative/pantau-batas";
import { sambungPerangkat } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/sambung `{ kode, versi }` → token perangkat.
 * Satu-satunya rute ekstensi tanpa token: kodenya (8 tanda, 15 menit, sekali
 * pakai) dibuat di Kreatif → Pemantauan. Batas laju per alamat IP.
 */
export async function POST(req: Request) {
  try {
    if (!pembatasSambungPantau.coba(alamatPeminta(req))) return tolak("TERLALU_SERING");
    const badan = await bacaBadan(req);
    if (!badan || typeof badan !== "object" || Array.isArray(badan)) return tolak("MUATAN_TIDAK_SAH");
    const { kode, versi } = badan as Record<string, unknown>;
    const r = await sambungPerangkat({ kode, versi });
    return r.ok ? jawab(r) : tolak(r.kode);
  } catch (e) {
    return gagalTakTerduga("sambung", e);
  }
}
