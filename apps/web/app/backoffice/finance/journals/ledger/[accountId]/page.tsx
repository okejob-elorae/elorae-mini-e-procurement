import { redirect, notFound } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { getAccountLedger, type AccountLedger } from "@/lib/finance/journals/queries";
import { AccountLedgerClient } from "./AccountLedgerClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function AccountLedgerPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)) {
    redirect("/backoffice");
  }

  const { accountId } = await params;
  const sp = await searchParams;

  let ledger: AccountLedger;
  try {
    ledger = await getAccountLedger(accountId, {
      from: parseDateOnly(sp.from ?? ""),
      to: parseDateOnlyEnd(sp.to ?? ""),
    });
  } catch {
    notFound();
  }

  /* Pemilih akun di kepala halaman — pindah akun tanpa kembali ke Bagan Akun (audit G8). */
  const akun = await prisma.chartAccount.findMany({
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, isActive: true },
  });

  return (
    <AccountLedgerClient
      accountId={accountId}
      ledger={ledger}
      filters={{ from: sp.from ?? "", to: sp.to ?? "" }}
      pilihanAkun={akun.map((a) => ({ value: a.id, label: `${a.code} ${a.name}`, nonaktif: !a.isActive }))}
    />
  );
}
