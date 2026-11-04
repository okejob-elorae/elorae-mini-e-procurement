"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { cekDuplikatUsulan } from "@/lib/stores/usulan-queries";
import { ajukanUsulanToko } from "@/lib/stores/usulan-writer";
import type { GalatUsulan, KandidatDuplikat, MasukanUsulanToko } from "@/lib/stores/usulan-toko";

/**
 * Aksi HP untuk "Daftarkan toko baru". Siapa pun yang memegang `pwa:access`
 * (salesman, juga SPG) boleh mengusulkan — usulan tidak mengubah master toko
 * sampai admin menyetujuinya.
 */

/** Kandidat duplikat untuk layar HP — tanpa koordinat, yang tidak ditampilkan. */
export type KandidatDuplikatHp = Pick<
  KandidatDuplikat,
  "jenis" | "id" | "code" | "name" | "address" | "aktif" | "namaMirip" | "jarakMeter"
>;

function ringkas(k: KandidatDuplikat[]): KandidatDuplikatHp[] {
  return k.map(({ jenis, id, code, name, address, aktif, namaMirip, jarakMeter }) => ({
    jenis,
    id,
    code,
    name,
    address,
    aktif,
    namaMirip,
    jarakMeter,
  }));
}

async function penggunaLapangan(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return hasPermission(session.user.permissions ?? [], "pwa:access") ? session.user.id : null;
}

export async function cekDuplikatUsulanAction(input: {
  name: string;
  lat: number | null;
  lng: number | null;
}): Promise<{ ok: true; kandidat: KandidatDuplikatHp[] } | { ok: false; code: "TANPA_AKSES" }> {
  if (!(await penggunaLapangan())) return { ok: false, code: "TANPA_AKSES" };
  const lat = typeof input?.lat === "number" && Number.isFinite(input.lat) ? input.lat : null;
  const lng = typeof input?.lng === "number" && Number.isFinite(input.lng) ? input.lng : null;
  const name = typeof input?.name === "string" ? input.name : "";
  // Setengah titik tidak bisa dibandingkan jaraknya — nama saja yang dipakai.
  const lengkap = lat !== null && lng !== null;
  const kandidat = await cekDuplikatUsulan({ name, lat: lengkap ? lat : null, lng: lengkap ? lng : null });
  return { ok: true, kandidat: ringkas(kandidat) };
}

export type HasilAjukanTokoBaru =
  | { ok: true; id: string; ulang: boolean }
  | { ok: false; code: GalatUsulan | "TANPA_AKSES" | "AREA_TIDAK_ADA" | "KUNCI_TIDAK_SAH" | "KUNCI_MILIK_LAIN" }
  | { ok: false; code: "MUNGKIN_DUPLIKAT"; kandidat: KandidatDuplikatHp[] };

/**
 * Kirim usulan. `tetapAjukan` = salesman sudah melihat kandidat duplikat dan
 * memilih "Tetap ajukan"; tanpa itu server memeriksa ulang dan menahan usulan
 * yang mirip toko lain.
 */
export async function ajukanTokoBaruAction(
  input: MasukanUsulanToko & { idempotencyKey: string; tetapAjukan: boolean },
): Promise<HasilAjukanTokoBaru> {
  const userId = await penggunaLapangan();
  if (!userId) return { ok: false, code: "TANPA_AKSES" };
  const { idempotencyKey, tetapAjukan, ...masukan } = input ?? ({} as typeof input);
  const hasil = await ajukanUsulanToko({
    userId,
    masukan,
    idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : "",
    tetapAjukan: tetapAjukan === true,
  });
  if (!hasil.ok) {
    return hasil.code === "MUNGKIN_DUPLIKAT" ? { ok: false, code: hasil.code, kandidat: ringkas(hasil.kandidat) } : hasil;
  }
  revalidatePath("/pwa/stores/usulan");
  revalidatePath("/backoffice/stores");
  revalidatePath("/backoffice/stores/usulan");
  return hasil;
}
