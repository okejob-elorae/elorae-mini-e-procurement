import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { FormTitip, type BarisKatalogTitip } from "./FormTitip";

export const dynamic = "force-dynamic";

/**
 * Titip pesan baru. Bisa dibuka dengan barang terpilih (`?itemId=&variantSku=`,
 * dari layar Info produk) dan/atau pembeli terpilih (`?pelanggan=`, dari
 * rincian pelanggan). Katalog dikirim TANPA harga — pesan titip tidak pernah
 * menyebut harga.
 */
export default async function SpgTitipBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ itemId?: string; variantSku?: string; pelanggan?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/titip/baru");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const sp = await searchParams;
  const [katalogPenuh, pelanggan] = await Promise.all([
    getSellableCatalogForSpg(toko.id),
    sp.pelanggan
      ? prisma.storeCustomer.findFirst({ where: { id: sp.pelanggan, storeId: toko.id }, select: { id: true, name: true, phone: true } })
      : Promise.resolve(null),
  ]);
  const katalog: BarisKatalogTitip[] = katalogPenuh.map((r) => ({
    itemId: r.itemId,
    sku: r.sku,
    productName: r.productName,
    variantSku: r.variantSku,
    variantLabel: r.variantLabel,
    barcode: r.barcode,
    stok: r.stok ?? 0,
  }));
  // Barang dari alamat hanya dipakai kalau ada di katalog; varian yang tidak
  // dikenal barang itu jatuh ke "ukuran mana pun", bukan ke penolakan saat simpan.
  const varianDiminta = sp.variantSku?.trim() || null;
  const awalBarang =
    sp.itemId && katalog.some((r) => r.itemId === sp.itemId)
      ? { itemId: sp.itemId, variantSku: varianDiminta && katalog.some((r) => r.itemId === sp.itemId && r.variantSku === varianDiminta) ? varianDiminta : null }
      : null;

  return (
    <FormTitip
      namaToko={toko.name}
      katalog={katalog}
      awalBarang={awalBarang}
      awalPelanggan={pelanggan ? { jenis: "ada", id: pelanggan.id, nama: pelanggan.name, hp: pelanggan.phone } : null}
    />
  );
}
