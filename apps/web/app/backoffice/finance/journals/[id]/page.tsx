import { redirect, notFound } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getJournalById } from "@/lib/finance/journals/queries";
import { JournalDetailClient, type SumberJurnalTampil } from "./JournalDetailClient";
import { cariInfoDokumen } from "../_sumber/info-dokumen";
import { idDokumenDariSumber, kunciDokumen, rentangBulanWib, tautanDokumenSumber } from "../_sumber/tautan";
import { infoPersetujuanJurnal, type InfoPersetujuanJurnal } from "@/lib/finance/jurnal-manual/queries";
import { hariIniWib } from "@/lib/tanggal-isian";
import { PanelPersetujuanJurnal } from "./PanelPersetujuanJurnal";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** Dokumen sumber jurnal otomatis: nomor + tautannya. Kegagalan membaca hanya menghilangkan tautan. */
async function sumberJurnal(journalId: string): Promise<SumberJurnalTampil | null> {
  try {
    const row = await prisma.journal.findUnique({
      where: { id: journalId },
      select: { sourceType: true, sourceId: true, isManual: true },
    });
    if (!row || row.isManual || !row.sourceType) return null;
    const id = idDokumenDariSumber(row.sourceType, row.sourceId);
    if (!id) return null;
    const info = (await cariInfoDokumen([{ jenis: row.sourceType, id }])).get(kunciDokumen(row.sourceType, id));
    const href = tautanDokumenSumber(row.sourceType, id, info ?? {});
    return href ? { href, nomor: info?.nomor ?? null } : null;
  } catch (e) {
    console.error("[journal-detail] gagal membaca dokumen sumber", e);
    return null;
  }
}

/** Persetujuan (maker-checker) dan pembalikan; kegagalan membaca hanya menghilangkan panelnya. */
async function infoPersetujuanAman(journalId: string): Promise<InfoPersetujuanJurnal | null> {
  try {
    return await infoPersetujuanJurnal(journalId);
  } catch (e) {
    console.error("[journal-detail] gagal membaca persetujuan", e);
    return null;
  }
}

/** Id akun per kode — kode akun unik — untuk tautan ke buku besar akunnya. */
async function idAkunPerKode(codes: string[]): Promise<Record<string, string>> {
  if (codes.length === 0) return {};
  try {
    const akun = await prisma.chartAccount.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    return Object.fromEntries(akun.map((a) => [a.code, a.id]));
  } catch (e) {
    console.error("[journal-detail] gagal membaca id akun", e);
    return {};
  }
}

export default async function JournalDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)) {
    redirect("/backoffice");
  }

  const { id } = await params;
  const journal = await getJournalById(id);
  if (!journal) notFound();

  const [sumber, akunIds, persetujuan] = await Promise.all([
    sumberJurnal(id),
    idAkunPerKode([...new Set(journal.lines.map((l) => l.accountCode))]),
    infoPersetujuanAman(id),
  ]);

  return (
    <div className="space-y-6">
      <JournalDetailClient
        journal={journal}
        sumber={sumber}
        akunIds={akunIds}
        rentangBukuBesar={rentangBulanWib(journal.date)}
      />
      {persetujuan ? (
        <PanelPersetujuanJurnal
          info={persetujuan}
          penggunaId={session.user.id}
          bolehMengelola={hasPermission(permissions, PERMISSIONS.JOURNALS_MANAGE)}
          hariIni={hariIniWib()}
        />
      ) : null}
    </div>
  );
}
