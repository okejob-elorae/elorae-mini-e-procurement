import { prisma } from "@elorae/db";
import { bacaWarnaPerusahaan, KUNCI_WARNA_PERUSAHAAN } from "@/lib/theme/warna-efektif";
import { LoginClient } from "./LoginClient";

/* Warna perusahaan bisa diganti kapan saja dari Pengaturan — dibaca tiap buka. */
export const dynamic = "force-dynamic";

/**
 * Halaman masuk memakai warna PERUSAHAAN, bukan warna orang terakhir yang
 * masuk di perangkat ini — lihat `LoginClient`. Warnanya dibaca di server supaya
 * bingkai pertama sudah benar.
 */
export default async function LoginPage() {
  let warnaPerusahaan: string | null = null;
  try {
    const baris = await prisma.systemSetting.findUnique({
      where: { key: KUNCI_WARNA_PERUSAHAAN },
      select: { value: true },
    });
    warnaPerusahaan = bacaWarnaPerusahaan(baris?.value)?.hex ?? null;
  } catch {
    // Basis data tidak terjangkau: pintu depan tetap harus terbuka, dengan
    // warna bawaan. Kesalahannya sendiri akan terlihat begitu orang masuk.
  }
  return <LoginClient warnaPerusahaan={warnaPerusahaan} />;
}
