import { bacaBadan, gagalTakTerduga, jawab, perangkatPermintaan, tolak } from "@/lib/creative/pantau-api";
import { bacaMasalah } from "@/lib/creative/pantau-muatan";
import { laporMasalah } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/masalah `{ tugasId?, kode, pesan? }`.
 * CAPTCHA/LOGIN menjeda perangkat; jawaban menyebut sampai kapan.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    const m = bacaMasalah(await bacaBadan(req));
    if (!m.ok) return tolak(m.kode);
    return jawab(await laporMasalah({ perangkat: p.perangkat, masalah: m.masalah }));
  } catch (e) {
    return gagalTakTerduga("masalah", e);
  }
}
