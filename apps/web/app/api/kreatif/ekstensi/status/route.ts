import { gagalTakTerduga, jawab, perangkatPermintaan } from "@/lib/creative/pantau-api";
import { statusPerangkat } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/** GET /api/kreatif/ekstensi/status → keadaan perangkat, pengaturan jam & jeda, hitungan hari ini. */
export async function GET(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    return jawab(await statusPerangkat(p.perangkat));
  } catch (e) {
    return gagalTakTerduga("status", e);
  }
}
