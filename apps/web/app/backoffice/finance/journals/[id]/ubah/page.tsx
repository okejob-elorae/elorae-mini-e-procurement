import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { getPostableAccounts } from "@/lib/finance/coa/queries";
import { ManualJournalForm } from "../../new/ManualJournalForm";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * Pembuat mengubah draf jurnal manualnya sebelum disetujui. Hanya pembuatnya
 * (`postedById`), hanya draf, dan bukan draf pembalik (barisnya cermin jurnal
 * asli). Penulisnya memeriksa ulang semua syarat ini.
 */
export default async function UbahDrafJurnalPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) redirect(`/backoffice/finance/journals/${id}`);
  const j = await prisma.journal.findUnique({
    where: { id },
    select: {
      id: true,
      date: true,
      description: true,
      status: true,
      isManual: true,
      postedById: true,
      reversalOfId: true,
      lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true } },
    },
  });
  if (!j) notFound();
  if (!j.isManual || j.status !== "DRAFT" || j.postedById !== session.user.id || j.reversalOfId) redirect(`/backoffice/finance/journals/${id}`);
  const accounts = await getPostableAccounts();
  return (
    <ManualJournalForm
      accounts={accounts}
      draft={{
        id: j.id,
        date: formatDateOnlyJakarta(j.date),
        description: j.description,
        lines: j.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: Number(l.debit), credit: Number(l.credit), memo: l.memo, channel: l.channel })),
      }}
    />
  );
}
