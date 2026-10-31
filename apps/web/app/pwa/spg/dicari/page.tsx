import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { barangDicariSpg } from "@/lib/spg/dicari-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { mintaDariPembeli } from "../stok/minta/dari-pembeli";
import { CatatDicariClient, type CatatanDicari } from "./CatatDicariClient";
import { barangDicariUntukMinta } from "./minta-queries";

export const dynamic = "force-dynamic";

/**
 * Barang yang dicari pembeli tapi tidak ada. Tidak butuh check-in: pembeli
 * bisa bertanya saat SPG baru datang atau sedang istirahat, dan catatannya
 * tetap berharga — aksinya pun tidak mensyaratkan kunjungan aktif.
 */
export default async function SpgDicariPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/dicari");
  const userId = session.user.id;

  const toko = await tokoSpg(userId);
  if (!toko) redirect("/pwa");

  const [katalog, terakhir] = await Promise.all([getSellableCatalogForSpg(), barangDicariSpg(userId, { batas: 20 })]);
  // Ukuran yang dicatat, untuk "Minta ke salesman" per baris (alasan DICARI_PEMBELI).
  // Hanya catatan di toko ini — catatan dari toko lama tidak diberi tombol.
  const bahan = await barangDicariUntukMinta(
    userId,
    toko.id,
    terakhir.map((c) => c.id),
  );

  // Waktu diformat di server untuk kedua bahasa; klien hanya memilih.
  const catatan: CatatanDicari[] = terakhir.map((c) => {
    const b = bahan.get(c.id);
    return {
      id: c.id,
      keterangan: c.keterangan,
      qty: c.qty,
      sku: c.sku,
      waktu: { id: formatDisplayDateTime(c.waktu, "id"), en: formatDisplayDateTime(c.waktu, "en") },
      // Barang diketik bebas tidak bisa diisikan ke permintaan.
      minta: b?.itemId ? mintaDariPembeli([b], "DICARI_PEMBELI").alamat : null,
      ditulisBebas: b !== undefined && !b.itemId,
    };
  });

  return <CatatDicariClient katalog={katalog} terakhir={catatan} />;
}
