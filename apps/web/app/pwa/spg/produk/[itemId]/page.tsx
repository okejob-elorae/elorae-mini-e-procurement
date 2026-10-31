import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { infoProdukSpg } from "@/lib/spg/produk-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { InfoProdukClient } from "./InfoProdukClient";

export const dynamic = "force-dynamic";

/**
 * Info satu barang untuk pembeli: foto, harga eceran, promo konter, bahan,
 * cara rawat, tabel ukuran, stok per ukuran di toko ini, keterangan gudang,
 * toko SPG lain yang punya. `?varian=` (hasil pindai kode varian) memilih
 * ukurannya; nilai yang bukan varian barang ini diabaikan.
 */
export default async function SpgInfoProdukPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ varian?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await ambilTokoTetap(session.user.id))) redirect("/pwa");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const [{ itemId }, { varian }] = await Promise.all([params, searchParams]);
  const info = await infoProdukSpg(itemId, toko.id, new Date());
  if (!info) notFound();

  const diminta = (Array.isArray(varian) ? varian[0] : varian)?.trim() ?? "";
  const varianAwal = info.varian.find((v) => v.variantSku && v.variantSku.toLowerCase() === diminta.toLowerCase())?.variantSku ?? null;

  return <InfoProdukClient info={info} namaToko={toko.name} varianAwal={varianAwal} />;
}
