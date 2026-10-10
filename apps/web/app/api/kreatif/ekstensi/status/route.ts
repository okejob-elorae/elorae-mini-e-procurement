import { gagalTakTerduga, jawab, perangkatPermintaan } from "@/lib/creative/pantau-api";
import { bacaPlatformEkstensi, statusPerangkat } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * GET /api/kreatif/ekstensi/status[?platform=TIKTOK,YOUTUBE] → keadaan perangkat, pengaturan jam &
 * jeda, hitungan hari ini. `permintaanLangsung` hanya menghitung permintaan "Cek sekarang" untuk
 * platform yang disebut (tanpa daftar = TikTok).
 */
export async function GET(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    const platforms = bacaPlatformEkstensi(new URL(req.url).searchParams.get("platform") ?? undefined);
    return jawab(await statusPerangkat(p.perangkat, { platforms }));
  } catch (e) {
    return gagalTakTerduga("status", e);
  }
}
