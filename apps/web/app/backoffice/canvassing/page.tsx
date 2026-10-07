import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listCanvassers } from "@/lib/canvassing/queries";
import { petaBukanKanvas } from "@/lib/canvassing/kelayakan-kanvas";
import { CanvassingListClient } from "./CanvassingListClient";

export const dynamic = "force-dynamic";

export default async function CanvassingPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.CANVASSING_MANAGE)) redirect("/backoffice");

  const semua = await listCanvassers();
  /*
   * Hanya sales kanvas: SPG (toko tetap) dan admin sistem keluar dari daftar. Yang masih
   * memegang stok mobil tetap tampil dengan tandanya, supaya stoknya bisa dikembalikan.
   */
  const bukan = await petaBukanKanvas(semua.map((c) => c.id));
  const canvassers = semua
    .filter((c) => !bukan.has(c.id) || c.totalQty > 0)
    .map((c) => ({ ...c, bukanKanvas: bukan.get(c.id) ?? null }));

  return <CanvassingListClient canvassers={canvassers} />;
}
