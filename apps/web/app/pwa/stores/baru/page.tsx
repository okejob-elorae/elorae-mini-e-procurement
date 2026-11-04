import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { daftarArea } from "@/lib/stores/areas";
import { TokoBaruClient } from "./TokoBaruClient";

export const dynamic = "force-dynamic";

/** Daftarkan toko baru — salesman mengusulkan calon toko dari lapangan. */
export default async function TokoBaruPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  // Hanya area aktif: area nonaktif ditolak server, jadi tidak ditawarkan.
  const area = (await daftarArea()).filter((a) => a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name }));
  return <TokoBaruClient area={area} />;
}
