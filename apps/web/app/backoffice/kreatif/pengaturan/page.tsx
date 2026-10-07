import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaPengaturanKreatif } from "@/lib/creative/pengaturan";
import { PengaturanKreatifClient } from "./PengaturanKreatifClient";

export const dynamic = "force-dynamic";

/**
 * Pengaturan Ruang KOL: ambang hari, identitas pesan, dan template WhatsApp.
 * Pembaca memakai bawaan di kode bila barisnya kosong, jadi layar selalu
 * menampilkan angka yang sedang BERLAKU. Pengelola (`creative:manage`)
 * mengubah; yang lain hanya melihat.
 */
export default async function PengaturanKreatifPage() {
  const session = await auth();
  const izin = session?.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const pengaturan = await bacaPengaturanKreatif();
  return <PengaturanKreatifClient awal={pengaturan} bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)} />;
}
