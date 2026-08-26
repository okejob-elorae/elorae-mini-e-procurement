import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { returTertahan } from "@/lib/receivables/rules";
import { PelunasanClient, type BarisKlaim } from "./PelunasanClient";

export const dynamic = "force-dynamic";

export default async function PelunasanPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const rows = await prisma.paymentClaim.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      docNo: true,
      claimedTransferAt: true,
      invoiceAmount: true,
      deductionTotal: true,
      receivedAmount: true,
      status: true,
      verifyNote: true,
      store: { select: { name: true } },
      salesman: { select: { name: true } },
      deductions: { select: { amount: true, storeReturnId: true } },
    },
  });

  const baris: BarisKlaim[] = rows.map((r) => ({
    id: r.id,
    docNo: r.docNo,
    storeName: r.store.name,
    salesmanName: r.salesman?.name ?? null,
    claimedTransferAt: r.claimedTransferAt.toISOString(),
    invoiceAmount: Number(r.invoiceAmount),
    deductionTotal: Number(r.deductionTotal),
    receivedAmount: Number(r.receivedAmount),
    deductionCount: r.deductions.length,
    status: r.status,
    verifyNote: r.verifyNote,
    // Dihitung dengan aturan yang sama dengan halaman piutang, bukan ditaksir
    // ulang di sini — supaya dua layar tidak pernah menyebut angka berbeda.
    nilaiTertahan: returTertahan(
      r.deductions
        .filter((d) => d.storeReturnId !== null)
        .map((d) => ({ nilaiKlaim: Number(d.amount), nilaiFisik: null, bebanTerbuka: true })),
    ),
  }));

  return (
    <PelunasanClient
      baris={baris}
      bolehMemutuskan={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.JOURNALS_MANAGE,
      )}
    />
  );
}
