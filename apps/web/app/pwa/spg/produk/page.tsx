import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { daftarProdukSpg } from "@/lib/spg/produk-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { DaftarProdukClient } from "./DaftarProdukClient";

export const dynamic = "force-dynamic";

/**
 * Info produk untuk pembeli — cari nama/SKU atau pindai barcode, lalu buka
 * barangnya. Hanya SPG (toko tetap dari sesi, tidak pernah dari alamat);
 * yang lain dikembalikan ke beranda.
 */
export default async function SpgProdukPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await ambilTokoTetap(session.user.id))) redirect("/pwa");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const daftar = await daftarProdukSpg(toko.id);
  return <DaftarProdukClient namaToko={toko.name} daftar={daftar} />;
}
