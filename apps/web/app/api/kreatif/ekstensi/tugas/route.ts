import { gagalTakTerduga, jawab, perangkatPermintaan } from "@/lib/creative/pantau-api";
import { pinjamTugas } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/tugas `{}` → pinjam satu tugas (lease 5 menit),
 * atau `tugas: null` dengan alasannya.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    const r = await pinjamTugas({ perangkatId: p.perangkat.id });
    return jawab({ ok: true, tugas: r.tugas, ...(r.alasan ? { alasan: r.alasan } : {}) });
  } catch (e) {
    return gagalTakTerduga("tugas", e);
  }
}
