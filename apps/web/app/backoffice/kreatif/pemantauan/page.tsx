import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { dataPemantauan } from "@/lib/creative/pantau-queries";
import { PemantauanClient } from "./PemantauanClient";

export const dynamic = "force-dynamic";

/**
 * Kreatif → Pemantauan: ekstensi Chrome yang membaca angka TikTok KOL
 * (uji coba, rancangan `docs/superpowers/specs/2026-10-08-pantau-kol-ekstensi-design.md`).
 * Hitungan hari ini, antrean, perangkat, masalah terbaru, dan pengaturan.
 * Melihat: `creative:view`; menyambungkan, menjeda, mencabut, menyusun
 * antrean, dan mengubah pengaturan: `creative:manage`.
 */
export default async function PemantauanPage() {
  const session = await auth();
  const izin = session?.user.permissions ?? [];
  if (!session?.user?.id || !hasPermission(izin, PERMISSIONS.CREATIVE_VIEW)) redirect("/backoffice");
  const data = await dataPemantauan();
  return <PemantauanClient data={data} bolehMengelola={hasPermission(izin, PERMISSIONS.CREATIVE_MANAGE)} />;
}
