import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBulanTerakhir } from "@/lib/salesman/komisi";
import { bacaBulanBayar } from "@/lib/spg/komisi";
import { daftarKomisiKantor } from "@/lib/spg/komisi-queries";
import { KomisiSpgClient, type KonsiTampil, type LaporanPutusTampil } from "./KomisiSpgClient";

export const dynamic = "force-dynamic";

/** Bulan pembayaran yang bisa dipilih: satu tahun ke belakang. */
const JUMLAH_BULAN = 12;

/**
 * SPG → Komisi SPG: komisi SPG per BULAN PEMBAYARAN — bulan laporan penjualannya dicek kantor —
 * untuk toko putus dan konsinyasi, semuanya dari satu hitungan (tarif per kategori bulan penjualan
 * × potong yang dijual masing-masing SPG, `lib/spg-commission/payout.ts`). Semua pemegang
 * `spg_sales:view` bisa melihat. Setiap tombol memakai izin yang SAMA dengan aksinya
 * (app/actions/spg-komisi.ts): menandai laporan dicek, membatalkannya, dan menetapkan =
 * `receivables:manage`; menandai dibayar = `spg_commission:pay`. Toko konsinyasi dicek dan
 * dibayar di siklusnya; di sini tampil angkanya.
 */
export default async function KomisiSpgPage({ searchParams }: { searchParams: Promise<{ bulan?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice/dashboard");

  const sekarang = new Date();
  const pilihan = daftarBulanTerakhir(sekarang, JUMLAH_BULAN);
  const bulan = bacaBulanBayar((await searchParams).bulan, pilihan);
  const data = await daftarKomisiKantor(bulan, sekarang);

  // Tanggal diformat DI SERVER (WIB) — komponen klien menerima teks jadi.
  const putus: LaporanPutusTampil[] = data.putus.map((l) => ({
    storeId: l.storeId,
    nama: l.nama,
    kode: l.kode,
    aktif: l.aktif,
    bulanJual: l.bulanJual,
    dicek: l.dicek ? { label: formatDisplayDate(l.dicek.pada), oleh: l.dicek.oleh } : null,
    potongToko: l.potongToko,
    totalToko: l.totalToko,
    potongTanpaTarif: l.potongTanpaTarif,
    adaResmi: l.adaResmi,
    adaDibayar: l.adaDibayar,
    semuaDibayar: l.semuaDibayar,
    berbeda: l.berbeda,
    aturanLama: l.aturanLama,
    baris: l.baris.map((b) => ({
      userId: b.userId,
      nama: b.nama,
      ditugaskan: b.ditugaskan,
      penerima: b.penerima,
      potong: b.potong,
      komisi: b.komisi,
      potongTanpaTarif: b.potongTanpaTarif,
      status: b.status,
      resmi: b.resmi
        ? {
            id: b.resmi.id,
            commission: b.resmi.commission,
            deduction: b.resmi.deduction,
            unitsSold: b.resmi.unitsSold,
            aturanLama: b.resmi.aturanLama,
            ditetapkanLabel: formatDisplayDate(b.resmi.lockedAt),
            dibayarLabel: b.resmi.paidAt ? formatDisplayDate(b.resmi.paidAt) : null,
            note: b.resmi.note,
          }
        : null,
      bebanHilangSisa: b.bebanHilangSisa,
    })),
  }));
  const konsi: KonsiTampil[] = data.konsi.map((k) => ({
    cycleId: k.cycleId,
    noKonsi: k.noKonsi,
    nama: k.nama,
    kode: k.kode,
    bulanJual: k.bulanJual,
    dikunciLabel: formatDisplayDate(k.dikunciPada),
    totalHitung: k.totalHitung,
    totalTersimpan: k.totalTersimpan,
    potongTanpaTarif: k.potongTanpaTarif,
    berbeda: k.berbeda,
    adaDibayar: k.adaDibayar,
    semuaDibayar: k.semuaDibayar,
    baris: k.baris.map((b) => ({
      id: b.id,
      nama: b.nama,
      bergaji: b.bergaji,
      gajiPokok: b.gajiPokok,
      komisi: b.komisi,
      komisiHitung: b.komisiHitung,
      total: b.total,
      potonganHilang: b.potonganHilang,
      dibayarLabel: b.dibayarPada ? formatDisplayDate(b.dibayarPada) : null,
    })),
  }));

  return (
    <KomisiSpgClient
      bulan={data.bulan}
      bulanIni={data.bulanIni}
      pilihan={pilihan}
      bolehKelola={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)}
      bolehBayar={hasPermission(izin, PERMISSIONS.SPG_COMMISSION_PAY)}
      bolehAturTarif={hasPermission(izin, PERMISSIONS.SPG_COMMISSION_MANAGE)}
      putus={putus}
      konsi={konsi}
      menungguCek={data.menungguCek}
      konsiMenungguKunci={data.konsiMenungguKunci}
      ringkas={data.ringkas}
    />
  );
}
