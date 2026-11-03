import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { NewVendorBillClient } from "./NewVendorBillClient";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Catat invoice pemasok. `?pemasok=<id>` memilih pemasoknya; `?permintaan=<id>` (permintaan invoice
 * terbuka milik pemasok itu) mencentang penerimaan yang disebutnya pada sisanya. Parameter yang tidak
 * sah diabaikan.
 */
export default async function NewVendorBillPage({ searchParams }: { searchParams: Promise<{ pemasok?: Param; permintaan?: Param }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.VENDOR_BILLS_MANAGE)) redirect("/backoffice/vendor-bills");

  const sp = await searchParams;
  const pemasok = satu(sp.pemasok).slice(0, 64);
  const permintaan = satu(sp.permintaan).slice(0, 64);
  let sumberDiminta: string[] = [];
  if (pemasok && permintaan) {
    const r = await prisma.supplierInvoiceRequest.findFirst({
      where: { id: permintaan, supplierId: pemasok, cancelledAt: null, closedAt: null },
      select: { lines: { select: { sourceType: true, sourceId: true } } },
    });
    sumberDiminta = (r?.lines ?? []).map((l) => `${l.sourceType}|${l.sourceId}`);
  }

  return <NewVendorBillClient userId={session.user.id} pemasokAwal={pemasok || null} sumberDiminta={sumberDiminta} />;
}
