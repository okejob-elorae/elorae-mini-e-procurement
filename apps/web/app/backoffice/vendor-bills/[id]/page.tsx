import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getVendorBillDetail } from "@/lib/vendor-billing/queries";
import { konteksKoreksi, peranKoreksiBelumDipetakan } from "@/lib/vendor-billing/koreksi-utang-konteks";
import { VendorBillDetailClient } from "./VendorBillDetailClient";

export default async function VendorBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.VENDOR_BILLS_VIEW)) redirect("/backoffice");

  const { id } = await params;
  const bill = await getVendorBillDetail(id);
  if (!bill) notFound();
  // As `voidVendorBill` refuses: a live old vendor payment, or reversing what this bill booked (old CMT,
  // accepted price differences) would leave a receipt paid above its payable. Paid alone does not.
  const canManage = hasPermission(perms, PERMISSIONS.VENDOR_BILLS_MANAGE);
  const canDecide = hasPermission(perms, PERMISSIONS.VENDOR_BILLS_DECIDE_PRICE);
  const hasLiveVendorPayment = bill.allocations.some((a) => !a.payment.voidedAt);
  const voidBlockedReceipts = bill.status !== "VOID" && !hasLiveVendorPayment && canManage ? bill.voidBlockedReceipts : [];
  const canVoid = bill.status !== "VOID" && !hasLiveVendorPayment && bill.voidBlockedReceipts.length === 0 && canManage;
  const canPay = (bill.status === "UNPAID" || bill.status === "PARTIAL") && hasPermission(perms, PERMISSIONS.SUPPLIER_PAYMENTS_CREATE);
  const [konteks, peranBelumDipetakan] = await Promise.all([
    konteksKoreksi(bill.koreksi),
    canDecide && bill.koreksi.some((k) => k.status === "MENUNGGU") ? peranKoreksiBelumDipetakan() : Promise.resolve([] as string[]),
  ]);

  return (
    <VendorBillDetailClient
      bill={bill}
      canVoid={canVoid}
      canPay={canPay}
      canDecide={canDecide}
      voidBlockedReceipts={voidBlockedReceipts}
      konteks={Object.fromEntries(konteks)}
      peranBelumDipetakan={peranBelumDipetakan}
      userId={session.user.id}
    />
  );
}
