import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { daftarPengumumanHp } from "@/lib/pengumuman/queries";
import { DaftarPengumumanClient } from "./DaftarPengumumanClient";

export const dynamic = "force-dynamic";

/**
 * Pengumuman dari kantor untuk orang ini (salesman atau SPG, menurut perannya):
 * yang aktif saja — tersemat dulu, lalu terbaru; yang belum dibaca tebal.
 */
export default async function PengumumanHpPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  return <DaftarPengumumanClient baris={await daftarPengumumanHp(session.user.id)} />;
}
