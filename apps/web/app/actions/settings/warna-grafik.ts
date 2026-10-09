"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { bacaWarnaGrafik, tulisWarnaGrafik, type WarnaGrafik } from "@/lib/tampilan/warna-pilihan";

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

export async function simpanWarnaGrafikAction(input: unknown): Promise<HasilSimpanWarnaGrafik> {
  const sesi = await auth();
  if (!sesi?.user?.id) return { ok: false, kode: "TANPA_SESI" };
  try {
    const nilai = tulisWarnaGrafik(bacaWarnaGrafik(input));
    await prisma.user.update({ where: { id: sesi.user.id }, data: { chartColors: nilai } });
    revalidatePath("/backoffice/dashboard");
    revalidatePath("/backoffice/settings");
    return { ok: true, warna: bacaWarnaGrafik(nilai) };
  } catch (e) {
    console.error("[warna grafik] gagal menyimpan:", e);
    return { ok: false, kode: "GAGAL" };
  }
}
