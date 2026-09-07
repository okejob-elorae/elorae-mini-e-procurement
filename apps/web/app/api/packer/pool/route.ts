import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { listPackerPoolOrders } from "@/lib/packer/queries";

export const dynamic = "force-dynamic";

/** Packer pool: sales orders that already have a trackingNumber (resi). */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PACKER_MENU)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await listPackerPoolOrders();
  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      salesorderNo: r.salesorderNo,
      channelOrderNo: r.channelOrderNo,
      customerName: r.customerName,
      trackingNumber: r.trackingNumber,
      courier: r.courier,
      transactionDate: r.transactionDate.toISOString(),
      channel: r.channel,
    })),
  });
}
