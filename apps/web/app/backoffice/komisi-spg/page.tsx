import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBulanTerakhir } from "@/lib/salesman/komisi";
import { bacaPeriodeKomisi } from "@/lib/spg/komisi";
import { daftarKomisiKantor } from "@/lib/spg/komisi-queries";
import { KomisiSpgClient, type TokoKomisiTampil } from "./KomisiSpgClient";

export const dynamic = "force-dynamic";

/** Bulan yang bisa dipilih: satu tahun ke belakang. */
const JUMLAH_BULAN = 12;

/**
 * SPG → Komisi SPG: komisi SPG toko PUTUS per bulan WIB. Semua pemegang
 * `spg_sales:view` bisa melihat; menetapkan dan menandai dibayar butuh
 * `receivables:manage` (keuangan). Toko konsinyasi tidak dihitung di sini —
 * komisinya bagian dari siklus konsinyasi.
 */
export default async function KomisiSpgPage({ searchParams }: { searchParams: Promise<{ bulan?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice/dashboard");

  const sekarang = new Date();
  const pilihan = daftarBulanTerakhir(sekarang, JUMLAH_BULAN);
  const periode = bacaPeriodeKomisi((await searchParams).bulan, pilihan);
  const data = await daftarKomisiKantor(periode, sekarang);

  // Tanggal diformat DI SERVER (WIB) — komponen klien menerima teks jadi.
  const toko: TokoKomisiTampil[] = data.toko.map((t) => ({
    storeId: t.storeId,
    nama: t.nama,
    kode: t.kode,
    aktif: t.aktif,
    potongToko: t.potongToko,
    totalToko: t.totalToko,
    adaResmi: t.adaResmi,
    adaDibayar: t.adaDibayar,
    semuaDibayar: t.semuaDibayar,
    berbeda: t.berbeda,
    baris: t.baris.map((b) => ({
      userId: b.userId,
      nama: b.nama,
      ditugaskan: b.ditugaskan,
      penerima: b.penerima,
      potong: b.potong,
      komisiKotor: b.komisiKotor,
      potongan: b.potongan,
      komisi: b.komisi,
      status: b.status,
      resmi: b.resmi
        ? {
            id: b.resmi.id,
            commission: b.resmi.commission,
            deduction: b.resmi.deduction,
            unitsSold: b.resmi.unitsSold,
            basis: b.resmi.basis,
            ditetapkanLabel: formatDisplayDate(b.resmi.lockedAt),
            dibayarLabel: b.resmi.paidAt ? formatDisplayDate(b.resmi.paidAt) : null,
            note: b.resmi.note,
          }
        : null,
      bebanHilangSisa: b.bebanHilangSisa,
    })),
  }));

  return (
    <KomisiSpgClient
      periode={data.periode}
      pilihan={pilihan}
      bulanSelesai={data.bulanSelesai}
      aturan={data.aturan}
      bolehKelola={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)}
      toko={toko}
      tokoKonsi={data.tokoKonsi}
      ringkas={data.ringkas}
    />
  );
}
