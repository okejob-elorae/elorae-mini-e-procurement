import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaInfoTanggalMulai, type InfoTanggalMulai } from "@/lib/finance/periode/tanggal-mulai";
import { hariIniWib } from "@/lib/tanggal-isian";
import { MulaiBukuBesarClient } from "./MulaiBukuBesarClient";

export const dynamic = "force-dynamic";

/**
 * Keuangan → Tanggal mulai buku besar (`finance.glCutoverDate`): lantai semua
 * jurnal otomatis yang disapu. Melihat `journals:view`; mengubah
 * `journals:manage`, hanya selama belum ada bulan yang ditutup.
 */
export default async function MulaiBukuBesarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  let info: InfoTanggalMulai | null = null;
  try {
    info = await bacaInfoTanggalMulai();
  } catch (err) {
    console.error("[mulai-buku-besar] gagal memuat", err);
  }

  return <MulaiBukuBesarClient info={info} hariIni={hariIniWib()} bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}
