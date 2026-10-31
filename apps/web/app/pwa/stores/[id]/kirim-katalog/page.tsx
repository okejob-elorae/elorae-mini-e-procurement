import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getStore } from "@/lib/stores/queries";
import { listCatalogForPwa } from "@/lib/catalog/queries";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { saranTawarToko } from "@/lib/salesman/saran-tawar-queries";
import { pilihAwal, ukuranTersedia } from "@/lib/salesman/katalog-wa";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { BukanTokoSaya } from "../BukanTokoSaya";
import { KirimKatalogShell, type ProdukKirim } from "./KirimKatalogShell";

export const dynamic = "force-dynamic";

export default async function KirimKatalogPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  // Menawarkan katalog ke toko adalah pekerjaan salesman keliling; SPG kembali
  // ke halaman tokonya. Kunci "hanya toko sendiri" berlaku seperti di halaman toko.
  const [terkunci, tokoTetap] = await Promise.all([tokoTerkunci(), ambilTokoTetap(session.user.id)]);
  if (tokoTetap) redirect(`/pwa/stores/${store.id}`);
  if (!bolehPegangToko({ terkunci, penanggungJawabId: store.salesmanId, userId: session.user.id })) {
    return <BukanTokoSaya nama={store.name} />;
  }

  const [katalog, saran] = await Promise.all([
    listCatalogForPwa(store.id),
    saranTawarToko(store.id, new Date()).catch((e: unknown) => {
      // Tanpa saran halaman tetap bisa dipakai: salesman mencari produknya sendiri.
      console.error("saranTawarToko", e);
      return null;
    }),
  ]);
  if (!katalog) notFound();

  /*
   * Hanya barang yang ada stoknya — mengirim gambar barang yang tidak bisa
   * dikirim hanya membuat toko memesan sesuatu yang lalu ditolak gudang.
   * Harga dari katalog HP: sudah harga toko ini untuk PUTUS, dan sudah null di
   * server untuk toko konsinyasi; dikosongkan sekali lagi di sini supaya harga
   * konsinyasi tidak pernah sampai ke HP sekalipun katalognya berubah.
   */
  const produk: ProdukKirim[] = katalog.items
    .filter((it) => it.available > 0)
    .map((it) => ({
      itemId: it.itemId,
      sku: it.sku,
      nama: it.nameId,
      gambarUrl: it.primaryImageUrl,
      tersedia: it.available,
      harga: store.termsType === "PUTUS" ? it.price : null,
      ukuran: ukuranTersedia(it.variants),
    }));
  const diKatalog = new Set(produk.map((p) => p.itemId));
  const saranIds = (saran?.saran ?? []).map((s) => s.itemId).filter((x) => diKatalog.has(x));
  const baruIds = (saran?.baru ?? []).map((b) => b.itemId).filter((x) => diKatalog.has(x));

  return (
    <KirimKatalogShell
      store={{
        id: store.id,
        name: store.name,
        contactName: store.contactName,
        phone: store.phone,
        termsType: store.termsType,
      }}
      produk={produk}
      awal={pilihAwal(saranIds, baruIds, diKatalog)}
      saranIds={saranIds}
      baruIds={baruIds}
    />
  );
}
