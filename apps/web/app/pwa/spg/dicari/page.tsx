import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { barangDicariSpg } from "@/lib/spg/dicari-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { getSellableCatalogForSpg } from "@/lib/spg/sale-queries";
import { CatatDicariClient, type CatatanDicari } from "./CatatDicariClient";

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

  // Waktu diformat di server untuk kedua bahasa; klien hanya memilih.
  const catatan: CatatanDicari[] = terakhir.map((c) => ({
    id: c.id,
    keterangan: c.keterangan,
    qty: c.qty,
    sku: c.sku,
    waktu: { id: formatDisplayDateTime(c.waktu, "id"), en: formatDisplayDateTime(c.waktu, "en") },
  }));

  return <CatatDicariClient katalog={katalog} terakhir={catatan} />;
}
