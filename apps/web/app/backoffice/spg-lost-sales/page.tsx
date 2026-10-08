import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { daftarBarangDicari } from "@/lib/spg/kantor-queries";
import { BarangDicariClient } from "./BarangDicariClient";
import { batasPeriodeDicari, bacaPeriodeDicari } from "./periode";

export const dynamic = "force-dynamic";

/** Batas baris `daftarBarangDicari` — ringkasan hanya menghitung sebanyak ini. */
const BATAS_KUERI = 500;

/**
 * Barang yang dicari pembeli tapi kosong di toko. Periode = rentang hari
 * kalender WIB (`?dari=&sampai=`, pemilih yang sama dengan Penjualan SPG;
 * bawaan 30 hari terakhir termasuk hari ini) — "7 hari" berarti tujuh tanggal
 * yang sama dengan yang dilihat orang toko, bukan 168 jam mundur dari detik ini.
 */
export default async function BarangDicariPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; hari?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const periode = bacaPeriodeDicari(sp, kunciHariWib(new Date()));
  const { baris, ringkas } = await daftarBarangDicari(batasPeriodeDicari(periode));

  return (
    <BarangDicariClient
      periode={periode}
      ringkas={ringkas}
      baris={baris.map((b) => ({
        id: b.id,
        waktu: formatDisplayDateTime(b.waktu),
        toko: b.toko,
        oleh: b.oleh,
        keterangan: b.keterangan,
        qty: b.qty,
      }))}
      terpotong={baris.length >= BATAS_KUERI}
    />
  );
}
