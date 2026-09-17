import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPalet } from "@/lib/creative/palet/queries";
import { PaletClient } from "./PaletClient";

export const dynamic = "force-dynamic";

/**
 * Roda warna tim kreatif. Rodanya sendiri boleh dipakai siapa pun yang bisa
 * membuka modul ini; menyimpan dan menghapus palet butuh `creative:manage`,
 * dan aksinya memeriksa ulang izin itu sendiri.
 */
export default async function PaletPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE);
  return <PaletClient palet={await daftarPalet()} bolehMengelola={kelola} />;
}
