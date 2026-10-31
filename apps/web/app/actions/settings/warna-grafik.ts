"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { bacaPermintaanWarnaGrafik, bacaWarnaGrafik, tulisWarnaGrafik, type WarnaGrafik } from "@/lib/tampilan/warna-pilihan";
import { ambilPantone } from "@/lib/tampilan/warna-pantone-queries";

/**
 * Warna grafik beranda — pilihan PRIBADI, seperti warna tema: setiap orang hanya membaca dan
 * menulis miliknya sendiri, jadi tidak ada izin lain yang diperiksa selain sesi.
 */

export async function bacaWarnaGrafikSayaAction(): Promise<WarnaGrafik> {
  const sesi = await auth();
  if (!sesi?.user?.id) return {};
  const row = await prisma.user.findUnique({ where: { id: sesi.user.id }, select: { chartColors: true } });
  return bacaWarnaGrafik(row?.chartColors);
}

export type HasilSimpanWarnaGrafik = { ok: true; warna: WarnaGrafik } | { ok: false; kode: "TANPA_SESI" | "GAGAL" };

/** `input` = {slot: kode Pantone TCX}; slot yang tidak dikirim kembali ke bawaan. */
export async function simpanWarnaGrafikAction(input: unknown): Promise<HasilSimpanWarnaGrafik> {
  const sesi = await auth();
  if (!sesi?.user?.id) return { ok: false, kode: "TANPA_SESI" };
  try {
    // Layar mengirim {slot: kode Pantone}; hex dan nama diambil dari katalog, kode yang tidak ada dilewati.
    const minta = bacaPermintaanWarnaGrafik(input);
    const katalog = await ambilPantone(Object.values(minta));
    const warna: WarnaGrafik = {};
    for (const [slot, tcx] of Object.entries(minta) as [keyof WarnaGrafik, string][]) {
      const w = katalog.get(tcx);
      if (w) warna[slot] = w;
    }
    const nilai = tulisWarnaGrafik(warna);
    await prisma.user.update({ where: { id: sesi.user.id }, data: { chartColors: nilai } });
    revalidatePath("/backoffice/dashboard");
    revalidatePath("/backoffice/settings");
    return { ok: true, warna: bacaWarnaGrafik(nilai) };
  } catch (e) {
    console.error("[warna grafik] gagal menyimpan:", e);
    return { ok: false, kode: "GAGAL" };
  }
}
