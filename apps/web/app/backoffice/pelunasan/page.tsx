import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { returTertahan } from "@/lib/receivables/rules";
import { PILIH_POTONGAN, potonganRetur } from "@/lib/receivables/deductions";
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
      deductions: { select: PILIH_POTONGAN },
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
    /*
     * Lewat penerjemah yang sama dengan halaman piutang dan halaman rinci.
     * Sebelumnya baris ini menghitung sendiri dengan asumsi "gudang belum
     * pernah menghitung" — benar saat tabel returnya belum ada, dan diam-diam
     * salah begitu ia ada: daftar ini akan menyebut angka tertahan yang berbeda
     * dari yang disebut halaman piutang untuk faktur yang sama.
     */
    nilaiTertahan: returTertahan(potonganRetur(r.deductions)),
  }));

  return (
    <PelunasanClient
      baris={baris}
      bolehMemutuskan={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.JOURNALS_MANAGE,
      )}
      bolehMengelola={hasPermission(
        session.user.permissions ?? [],
        PERMISSIONS.RECEIVABLES_MANAGE,
      )}
    />
  );
}
