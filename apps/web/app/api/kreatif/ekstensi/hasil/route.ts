import { bacaBadan, gagalTakTerduga, jawab, perangkatPermintaan, tolak } from "@/lib/creative/pantau-api";
import { bacaHasil } from "@/lib/creative/pantau-muatan";
import { simpanHasil, tolakMuatan } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/hasil `{ tugasId, data: HasilProfil | HasilKonten }`.
 * Idempoten: hasil kedua untuk tugas yang sudah SELESAI → `{ ok: true, ulang: true }`.
 * Muatan yang tidak sah tetap dihitung satu percobaan gagal untuk tugasnya
 * (sekali per pinjaman), supaya halaman yang bentuknya berubah tidak membuat
 * tugas berputar selamanya.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    const badan = await bacaBadan(req);
    if (!badan || typeof badan !== "object" || Array.isArray(badan)) return tolak("MUATAN_TIDAK_SAH");
    const { tugasId, data } = badan as Record<string, unknown>;
    if (typeof tugasId !== "string" || !/^[0-9A-Za-z_-]{1,64}$/.test(tugasId)) return tolak("MUATAN_TIDAK_SAH");
    const hasil = bacaHasil(data);
    if (!hasil.ok) return tolak((await tolakMuatan({ perangkat: p.perangkat, tugasId })).kode);
    const r = await simpanHasil({ perangkat: p.perangkat, tugasId, data: hasil.hasil });
    return r.ok ? jawab(r) : tolak(r.kode);
  } catch (e) {
    return gagalTakTerduga("hasil", e);
  }
}
