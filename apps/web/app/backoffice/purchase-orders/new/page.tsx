import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { isiPoDariTahap, type IsiPoDariTahap } from "@/lib/purchase-orders/isi-dari-tahap";
import { bacaPilihanBahan } from "@/lib/purchase-orders/tahap";
import { PoBaruClient } from "./PoBaruClient";

export const dynamic = "force-dynamic";

/**
 * PO baru. `?planStageId=` datang dari ruang kerja tahap produksi: tahapnya
 * diperiksa di server (ada, dan pembuka boleh membuat PO) lalu dibawa formulir
 * sebagai chip "Untuk tahap" yang bisa dilepas, bersama kebutuhan bahan tahap
 * untuk panel "Kebutuhan vs tahap". `&isi=kurang` (tombol "Buat PO" di kartu
 * Kebutuhan bahan) mengisi baris dengan kekurangan tiap bahan — semua, atau
 * hanya `&bahan=a,b` — dan catatan "Produksi <tahap> · <jenis>".
 */
export default async function NewPOPage({
  searchParams,
}: {
  searchParams: Promise<{ planStageId?: string; isi?: string; bahan?: string | string[] }>;
}) {
  const { planStageId, isi, bahan } = await searchParams;
  const id = typeof planStageId === "string" ? planStageId.trim() : "";

  let dariTahap: IsiPoDariTahap | null = null;
  let tahapHilang = false;
  if (id) {
    const session = await auth();
    if (hasPermission(session?.user?.permissions ?? [], PERMISSIONS.PURCHASE_ORDERS_CREATE)) {
      dariTahap = await isiPoDariTahap(id, { isiKurang: isi === "kurang", bahan: bacaPilihanBahan(bahan) });
      tahapHilang = dariTahap == null;
    }
  }

  return <PoBaruClient dariTahap={dariTahap} tahapHilang={tahapHilang} />;
}
