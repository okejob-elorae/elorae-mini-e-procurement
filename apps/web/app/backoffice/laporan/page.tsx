import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  getRawMaterialShortage,
  getSuppliersForReportFilter,
  getWorkOrderCountByStatus,
} from "@/lib/dashboard/queries";
import { getOverduePOs } from "@/lib/purchase-orders/queries";
import { toIso } from "@/lib/dashboard/serialize";
import { LaporanPageClient } from "./LaporanPageClient";

export const dynamic = "force-dynamic";

/**
 * Laporan operasional yang dulu menjadi tab di bawah beranda. Datanya dimuat
 * dengan pemanggil yang sama seperti dulu; laporan yang berat (pengadaan,
 * setoran CMT, inventori) tetap baru dimuat saat tombol "Tampilkan" ditekan.
 */
export default async function LaporanPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [overduePOs, suppliers, rawMaterialShortage, woStatusCounts] = await Promise.all([
    getOverduePOs(),
    getSuppliersForReportFilter(),
    getRawMaterialShortage(),
    getWorkOrderCountByStatus(),
  ]);

  return (
    <Suspense fallback={null}>
      <LaporanPageClient
        initialOverduePOs={overduePOs.map((po) => ({ ...po, etaDate: toIso(po.etaDate) }))}
        initialSuppliers={suppliers}
        initialRawMaterialShortage={rawMaterialShortage}
        initialWoStatusCounts={woStatusCounts}
        izin={session.user.permissions ?? []}
      />
    </Suspense>
  );
}
