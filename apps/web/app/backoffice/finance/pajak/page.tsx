import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaSaringKalender, cocokSaring } from "@/lib/finance/pajak/kalender";
import { butirKalenderPajak, type KalenderPajak } from "@/lib/finance/pajak/kalender-queries";
import { aksesPajak } from "./_bersama/akses";
import { KalenderPajakClient } from "./KalenderPajakClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ saring?: string | string[] }> };

/**
 * Keuangan → Pajak → Kalender: jatuh tempo setor/lapor per masa dengan status
 * setorannya. `?saring=segera|lewat` = definisi yang sama dengan baris Beranda.
 * Melihat `journals:view`; mencatat setoran `journals:manage`.
 */
export default async function KalenderPajakPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const akses = aksesPajak(session.user.permissions ?? []);
  if (!akses.bacaJurnal) redirect("/backoffice");

  const sp = await searchParams;
  const saring = bacaSaringKalender(Array.isArray(sp.saring) ? sp.saring[0] : sp.saring);
  const hariIni = hariIniWib();
  let data: KalenderPajak = { butir: [], statusPkp: "BELUM_DITETAPKAN", rezimPph: "BELUM_DITETAPKAN" };
  let gagal = false;
  try {
    data = await butirKalenderPajak({ hariIni });
  } catch (e) {
    console.error("[kalender-pajak] gagal", e);
    gagal = true;
  }
  const jumlah = {
    semua: data.butir.length,
    segera: data.butir.filter((b) => cocokSaring(b, "segera")).length,
    lewat: data.butir.filter((b) => cocokSaring(b, "lewat")).length,
  };
  return (
    <KalenderPajakClient
      butir={data.butir.filter((b) => cocokSaring(b, saring))}
      jumlah={jumlah}
      saring={saring}
      hariIni={hariIni}
      statusPkp={data.statusPkp}
      rezimPph={data.rezimPph}
      akses={akses}
      gagal={gagal}
    />
  );
}
