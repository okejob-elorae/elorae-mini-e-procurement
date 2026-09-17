import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPalet, daftarPantoneTcx } from "@/lib/production-colors/palet/queries";
import { ambilTintaDasar } from "@/lib/production-colors/sablon/queries";
import { PaletClient } from "./PaletClient";

export const dynamic = "force-dynamic";

/**
 * Palet warna produksi — palet bebas maupun palet sablon di atas kain.
 * Membuka halaman cukup `production_colors:view` (dijaga proxy lewat
 * ROUTE_PERMISSIONS); menyimpan palet dan tinta dasar butuh
 * `production_colors:manage`, dan aksinya memeriksa ulang izin itu sendiri.
 */
export default async function PaletPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.PRODUCTION_COLORS_MANAGE);
  const [palet, tcx, tintaDasar] = await Promise.all([daftarPalet(), daftarPantoneTcx(), ambilTintaDasar()]);
  return <PaletClient palet={palet} tcx={tcx} tintaDasar={tintaDasar} bolehMengelola={kelola} />;
}
