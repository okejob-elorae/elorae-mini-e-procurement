import { bacaBadan, gagalTakTerduga, jawab, perangkatPermintaan } from "@/lib/creative/pantau-api";
import { bacaPlatformEkstensi, pinjamTugas } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/tugas `{ platform?: ("TIKTOK" | "INSTAGRAM" | "YOUTUBE")[] }` → pinjam
 * satu tugas (lease 5 menit) dari platform yang sanggup dikerjakan ekstensi saat ini, atau
 * `tugas: null` dengan alasannya. Tanpa `platform` (ekstensi ≤ 0.10) = TikTok saja.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    const badan = await bacaBadan(req);
    const platforms = bacaPlatformEkstensi(badan && typeof badan === "object" && !Array.isArray(badan) ? (badan as Record<string, unknown>).platform : undefined);
    const r = await pinjamTugas({ perangkatId: p.perangkat.id, platforms });
    return jawab({ ok: true, tugas: r.tugas, ...(r.alasan ? { alasan: r.alasan } : {}) });
  } catch (e) {
    return gagalTakTerduga("tugas", e);
  }
}
