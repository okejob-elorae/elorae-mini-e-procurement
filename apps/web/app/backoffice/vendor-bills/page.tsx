import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hitungPenerimaanBelumDiminta } from "@/lib/vendor-billing/belum-ditagih-queries";
import { hitungPermintaanInvoiceTerlambat } from "@/lib/vendor-billing/permintaan-invoice-queries";
import { hitungSelisihHargaMenunggu } from "@/lib/vendor-billing/koreksi-utang-queries";
import { VendorBillsClient } from "./VendorBillsClient";

/** Setiap hitungan peringatan boleh gagal sendiri: yang gagal tidak tampil (P19 — peringatan di web app). */
async function aman(f: () => Promise<number>): Promise<number | null> {
  try {
    return await f();
  } catch (e) {
    console.error("[vendor-bills] peringatan", e);
    return null;
  }
}

export default async function VendorBillsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.VENDOR_BILLS_VIEW)) redirect("/backoffice");

  const [belumDiminta, permintaanTerlambat, selisihMenunggu] = await Promise.all([
    aman(() => hitungPenerimaanBelumDiminta()),
    aman(() => hitungPermintaanInvoiceTerlambat()),
    aman(() => hitungSelisihHargaMenunggu()),
  ]);

  return <VendorBillsClient canManage={hasPermission(perms, PERMISSIONS.VENDOR_BILLS_MANAGE)} peringatan={{ belumDiminta, permintaanTerlambat, selisihMenunggu }} />;
}
