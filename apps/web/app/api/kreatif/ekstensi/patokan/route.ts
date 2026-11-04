import { gagalTakTerduga, jawab, perangkatPermintaan } from "@/lib/creative/pantau-api";
import { patokanHargaKol } from "@/lib/creative/patokan-harga-queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/kreatif/ekstensi/patokan → patokan harga per 1.000 views dari kolaborasi berbayar Elorae
 * (`patokan-harga.ts`). Hanya angka ringkasan — tidak ada nama KOL atau fee per kolaborasi.
 */
export async function GET(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    return jawab({ ok: true, patokan: await patokanHargaKol() });
  } catch (e) {
    return gagalTakTerduga("patokan", e);
  }
}
