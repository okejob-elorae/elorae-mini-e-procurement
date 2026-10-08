import { gagalTakTerduga, jawab, perangkatPermintaan } from "@/lib/creative/pantau-api";
import { putuskanSendiri } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/putus → `{ ok: true }`. "Putuskan" di popup
 * ekstensi: perangkat mencabut tokennya sendiri; tugas pinjamannya kembali ke
 * antrean. Untuk memakainya lagi, buat kode baru di Kreatif → Pemantauan.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    return jawab(await putuskanSendiri({ perangkat: p.perangkat }));
  } catch (e) {
    return gagalTakTerduga("putus", e);
  }
}
