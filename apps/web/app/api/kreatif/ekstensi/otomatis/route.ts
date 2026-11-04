import { bacaBadan, gagalTakTerduga, jawab, perangkatPermintaan, tolak } from "@/lib/creative/pantau-api";
import { pembatasOtomatisPantau } from "@/lib/creative/pantau-batas";
import { bacaHasil, linkPantau } from "@/lib/creative/pantau-muatan";
import { simpanOtomatis } from "@/lib/creative/pantau-writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/kreatif/ekstensi/otomatis `{ url, data }` — kiriman otomatis panel
 * ekstensi begitu selesai membaca profil atau video TikTok, Instagram, atau YouTube
 * (tanpa tombol).
 * Badan sama dengan `/manual`. Server yang memutuskan apa yang disimpan
 * (`simpanOtomatis`); yang tidak relevan dijawab `DIABAIKAN` tanpa menulis
 * apa pun. Tanpa tugas, tidak memakan kuota harian. Dibatasi 120 kiriman per
 * jam per perangkat (`TERLALU_SERING`, 429).
 *
 * Jawaban sukses: `{ ok: true, hasil: "DISIMPAN" | "DIABAIKAN", kol?: { id, nama }, videoMasuk, brand }`.
 */
export async function POST(req: Request) {
  try {
    const p = await perangkatPermintaan(req);
    if (!p.ok) return p.respons;
    if (!pembatasOtomatisPantau.coba(p.perangkat.id)) return tolak("TERLALU_SERING");
    const badan = await bacaBadan(req);
    if (!badan || typeof badan !== "object" || Array.isArray(badan)) return tolak("MUATAN_TIDAK_SAH");
    const { url, data } = badan as Record<string, unknown>;
    if (typeof url !== "string" || url.length > 2000 || !linkPantau(url)) return tolak("MUATAN_TIDAK_SAH");
    const hasil = bacaHasil(data);
    if (!hasil.ok) return tolak(hasil.kode);
    const r = await simpanOtomatis({ perangkat: p.perangkat, url, data: hasil.hasil });
    if (!r.ok) return tolak(r.kode);
    return jawab({
      ok: true,
      hasil: r.hasil,
      ...(r.kol ? { kol: { id: r.kol.id, nama: r.kol.nama } } : {}),
      videoMasuk: r.videoMasuk,
      brand: r.brand,
    });
  } catch (e) {
    return gagalTakTerduga("otomatis", e);
  }
}
