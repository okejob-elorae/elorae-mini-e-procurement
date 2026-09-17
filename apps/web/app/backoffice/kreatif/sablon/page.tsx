import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPantoneTcx } from "@/lib/creative/palet/queries";
import { ambilTintaDasar } from "@/lib/creative/sablon/queries";
import { SablonClient } from "./SablonClient";

export const dynamic = "force-dynamic";

/**
 * Warna sablon untuk sebuah kain: saran tinta, porsinya di desain, dan resep
 * campur dari tinta dasar tim. Semua hitungan berjalan di peramban; server
 * hanya memberi katalog TCX dan daftar tinta dasar.
 */
export default async function SablonPage() {
  const session = await auth();
  const kelola = hasPermission(session?.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE);
  const [tcx, tintaDasar] = await Promise.all([daftarPantoneTcx(), ambilTintaDasar()]);
  return <SablonClient tcx={tcx} tintaDasar={tintaDasar} bolehMengelola={kelola} />;
}
