import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaMasa } from "@/lib/creative/termin-param";
import { daftarPphDipotong, type BarisPph } from "@/lib/creative/termin-queries";
import { PphDipotongClient } from "./PphDipotongClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ masa?: string | string[] }> };

/**
 * Keuangan → PPh dipotong: termin fee KOL yang sudah dibayar dan ber-PPh, per
 * masa (bulan WIB tanggal bayar). Bahan bukti potong dan setoran di Coretax —
 * Elorae TIDAK melapor ke Coretax. Melihat `journals:view`; mencatat nomor
 * bukti potong dan setoran `journals:manage`. Identitas selalu tersamar di
 * layar.
 */
export default async function PphDipotongPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const masa = bacaMasa(Array.isArray(sp.masa) ? sp.masa[0] : sp.masa) ?? hariIniWib().slice(0, 7);

  let baris: BarisPph[] = [];
  let gagal = false;
  try {
    baris = await daftarPphDipotong(masa);
  } catch (err) {
    console.error("[pph-dipotong] kueri gagal", err);
    gagal = true;
  }

  return <PphDipotongClient masa={masa} baris={baris} gagal={gagal} hariIni={hariIniWib()} bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)} />;
}
