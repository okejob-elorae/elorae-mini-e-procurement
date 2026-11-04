import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaKunciBulan, kunciBulan } from "@/lib/finance/periode/periode";
import {
  dokumenTanpaJurnal,
  jurnalSesudahDitutup,
  jurnalTakSeimbang,
  jurnalYatim,
  saldoBertandaTerbalik,
  type HasilJurnalYatim,
  type HasilTanpaJurnal,
  type JurnalSesudahTutup,
  type JurnalTakSeimbang,
  type SaldoTerbalikBaris,
} from "@/lib/finance/integritas/queries";
import { IntegritasClient } from "./IntegritasClient";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ bulan?: string | string[]; tanpaJurnal?: string | string[] }> };

const satu = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Satu bagian yang gagal dibaca tampil sebagai "gagal dibaca", bukan menjatuhkan halaman. */
async function aman<T>(nama: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    console.error(`[integritas] ${nama} gagal`, e);
    return null;
  }
}

/**
 * Keuangan → Integritas buku besar: dokumen tanpa jurnal per sumber, jurnal
 * tidak seimbang, jurnal yang dokumennya hilang, saldo bertanda terbalik, dan
 * jurnal yang masuk bulan tertutup sesudah ditutup. Melihat `journals:view`;
 * tombol "Sapu sekarang" `journals:manage`.
 */
export default async function IntegritasPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const bulan = bacaKunciBulan(satu(sp.bulan));
  const hanyaDiam = satu(sp.tanpaJurnal) === "diam";

  const [tanpaJurnal, takSeimbang, yatim, terbalik, sesudahTutup] = await Promise.all([
    aman<HasilTanpaJurnal>("dokumen tanpa jurnal", dokumenTanpaJurnal({ bulan, hanyaDiam })),
    aman<JurnalTakSeimbang[]>("jurnal tak seimbang", jurnalTakSeimbang()),
    aman<HasilJurnalYatim>("jurnal yatim", jurnalYatim()),
    aman<SaldoTerbalikBaris[]>("saldo terbalik", saldoBertandaTerbalik()),
    aman<JurnalSesudahTutup[]>("jurnal sesudah tutup", jurnalSesudahDitutup()),
  ]);

  return (
    <IntegritasClient
      saring={{ bulan: bulan ? kunciBulan(bulan) : null, hanyaDiam }}
      tanpaJurnal={tanpaJurnal}
      takSeimbang={takSeimbang}
      yatim={yatim}
      terbalik={terbalik}
      sesudahTutup={sesudahTutup}
      bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
    />
  );
}
