import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { daftarBarangDicari } from "@/lib/spg/kantor-queries";
import { BarangDicariClient, type PeriodeHari } from "./BarangDicariClient";

export const dynamic = "force-dynamic";

const PERIODE: PeriodeHari[] = [7, 30, 90];
const HARI_MS = 86_400_000;
/** Batas baris `daftarBarangDicari` — ringkasan hanya menghitung sebanyak ini. */
const BATAS_KUERI = 500;

/**
 * Barang yang dicari pembeli tapi kosong di toko. Periode dihitung dalam hari
 * kalender WIB termasuk hari ini, supaya "7 hari" berarti tujuh tanggal yang
 * sama dengan yang dilihat orang toko — bukan 168 jam mundur dari detik ini.
 */
export default async function BarangDicariPage({
  searchParams,
}: {
  searchParams: Promise<{ hari?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const diminta = Number(sp.hari);
  const hari: PeriodeHari = PERIODE.includes(diminta as PeriodeHari) ? (diminta as PeriodeHari) : 30;

  const awalHariIni = new Date(`${kunciHariWib(new Date())}T00:00:00+07:00`);
  const sejak = new Date(awalHariIni.getTime() - (hari - 1) * HARI_MS);
  const { baris, ringkas } = await daftarBarangDicari({ sejak });

  return (
    <BarangDicariClient
      hari={hari}
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
