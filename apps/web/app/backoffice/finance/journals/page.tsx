import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaUkuranHalaman } from "./_daftar/ukuran-halaman";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { listJournals } from "@/lib/finance/journals/queries";
import { hitungJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { JournalsPageClient } from "./JournalsPageClient";
import { bacaStatusJurnal } from "./_tertunda/sebab";
import { muatJurnalTertunda, type BarisJurnalTertunda } from "./_tertunda/muat";
import { saringanSumber } from "./_sumber/tautan";
import { aksesSpanduk, bacaKesiapanBukuBesar } from "../_kesiapan/baca";
import { hitungDrafJurnal } from "@/lib/finance/jurnal-manual/queries";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    page?: string;
    from?: string;
    to?: string;
    source?: string;
    q?: string;
    status?: string;
    per?: string;
  }>;
};

/** Jumlah draf menunggu persetujuan untuk lencana tab; kegagalan membaca tidak menggagalkan halaman. */
async function hitungDrafAman(): Promise<number> {
  try {
    return await hitungDrafJurnal();
  } catch (e) {
    console.error("[journals] gagal menghitung draf jurnal", e);
    return 0;
  }
}

/** Jumlah tertunda untuk lencana tab; kegagalan membaca tidak menggagalkan halaman. */
async function hitungAman(): Promise<number> {
  try {
    return await hitungJurnalTertunda();
  } catch (e) {
    console.error("[journals] gagal menghitung jurnal tertunda", e);
    return 0;
  }
}

export default async function JournalsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const permissions = session.user.permissions ?? [];
  if (!hasPermission(permissions, PERMISSIONS.JOURNALS_VIEW)) {
    redirect("/backoffice");
  }

  const sp = await searchParams;
  const status = bacaStatusJurnal(sp.status);
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = bacaUkuranHalaman(sp.per);
  const search = sp.q?.trim() || undefined;

  let tertunda: BarisJurnalTertunda[] | null = null;
  let items: Awaited<ReturnType<typeof listJournals>>["items"] = [];
  let totalCount = 0;
  let jumlahTertunda = 0;
  const jumlahDrafP = hitungDrafAman();

  if (status === "tertunda") {
    tertunda = await muatJurnalTertunda();
    jumlahTertunda = tertunda.length;
  } else {
    // Tab draf/ditolak: jurnal manual menurut statusnya (maker-checker); tab terposting: buku besar.
    const statusJurnal = status === "draf" ? "DRAFT" : status === "ditolak" ? "REJECTED" : undefined;
    const [daftar, jumlah] = await Promise.all([
      listJournals(
        {
          from: parseDateOnly(sp.from ?? ""),
          to: parseDateOnlyEnd(sp.to ?? ""),
          ...(statusJurnal ? { status: statusJurnal, manualOnly: true } : saringanSumber(sp.source)),
          search,
        },
        { page, pageSize },
      ),
      hitungAman(),
    ]);
    items = daftar.items;
    totalCount = daftar.totalCount;
    jumlahTertunda = jumlah;
  }
  const jumlahDraf = await jumlahDrafP;

  const kesiapan = await bacaKesiapanBukuBesar({ jurnalTertunda: jumlahTertunda });
  const canManage = hasPermission(permissions, PERMISSIONS.JOURNALS_MANAGE);

  return (
    <JournalsPageClient
      status={status}
      items={items}
      totalCount={totalCount}
      page={page}
      pageSize={pageSize}
      canManage={canManage}
      tertunda={tertunda}
      jumlahTertunda={jumlahTertunda}
      jumlahDraf={jumlahDraf}
      kesiapan={kesiapan}
      akses={aksesSpanduk(permissions)}
      filters={{
        from: sp.from ?? "",
        to: sp.to ?? "",
        source: sp.source ?? "",
        q: sp.q ?? "",
      }}
    />
  );
}
