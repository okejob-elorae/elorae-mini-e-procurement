import { bacaBadan, gagalTakTerduga, jawab, perangkatPermintaan, tolak } from "@/lib/creative/pantau-api";
import { bacaHasil, linkPantau } from "@/lib/creative/pantau-muatan";
import { simpanManual } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/manual `{ url, data }` — "Simpan ke Elorae" dari
 * panel di halaman TikTok, Instagram, atau YouTube. Tanpa tugas, tidak memakan kuota.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    const badan = await bacaBadan(req);
    if (!badan || typeof badan !== "object" || Array.isArray(badan)) return tolak("MUATAN_TIDAK_SAH");
    const { url, data } = badan as Record<string, unknown>;
    if (typeof url !== "string" || url.length > 2000 || !linkPantau(url)) return tolak("MUATAN_TIDAK_SAH");
    const hasil = bacaHasil(data);
    if (!hasil.ok) return tolak(hasil.kode);
    const r = await simpanManual({ perangkat: p.perangkat, url, data: hasil.hasil });
    return r.ok ? jawab(r) : tolak(r.kode);
  } catch (e) {
    return gagalTakTerduga("manual", e);
  }
}
