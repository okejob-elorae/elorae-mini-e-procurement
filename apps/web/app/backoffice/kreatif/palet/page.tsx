import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPalet, daftarPantoneTcx } from "@/lib/creative/palet/queries";
import { ambilTintaDasar } from "@/lib/creative/sablon/queries";
import { PaletClient } from "./PaletClient";

export const dynamic = "force-dynamic";

/**
 * Palet warna tim kreatif — palet bebas maupun palet sablon di atas kain.
 * Rodanya boleh dipakai siapa pun yang bisa membuka modul ini; menyimpan
 * palet dan tinta dasar butuh `creative:manage`, dan aksinya memeriksa ulang
 * izin itu sendiri.
 */
export default async function PaletPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE);
  const [palet, tcx, tintaDasar] = await Promise.all([daftarPalet(), daftarPantoneTcx(), ambilTintaDasar()]);
  return <PaletClient palet={palet} tcx={tcx} tintaDasar={tintaDasar} bolehMengelola={kelola} />;
}
