import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bolehMembukaKomisiSpg, bolehMembukaKonsi, bolehMemverifikasi } from "@/lib/receivables/izin";
import { daftarBulanTerakhir } from "@/lib/salesman/komisi";
import { bacaBulanBayar } from "@/lib/spg/komisi";
import { daftarKomisiKantor } from "@/lib/spg/komisi-queries";
import { antreanJadwalBulanKantor } from "@/lib/spg/jadwal-bulan-queries";
import { daftarUtangSpgKantor } from "@/lib/spg/utang-queries";
import { KomisiSpgClient, type KonsiTampil, type LaporanPutusTampil, type TunggakanTampil } from "./KomisiSpgClient";

export const dynamic = "force-dynamic";

/** Bulan pembayaran yang bisa dipilih: satu tahun ke belakang. */
const JUMLAH_BULAN = 12;

/**
 * SPG → Komisi SPG: komisi SPG per BULAN PEMBAYARAN — bulan laporan penjualannya dicek kantor —
 * untuk toko putus dan konsinyasi, semuanya dari satu hitungan (tarif per kategori bulan penjualan
 * × potong yang dijual masing-masing SPG, `lib/spg-commission/payout.ts`). Semua pemegang
 * `spg_sales:view` bisa melihat. Setiap tombol memakai izin yang SAMA dengan aksinya
 * (app/actions/spg-komisi.ts): menandai laporan dicek, membatalkannya, dan menetapkan =
 * `receivables:manage`; menandai dibayar = `spg_commission:pay` — juga baris gaji & komisi toko
 * konsinyasi (aksi dan izin yang sama dengan di siklusnya, supaya pemegang izin bayar tanpa
 * `consignment:view` tetap bisa membayar). Setiap baris yang belum dibayar memperlihatkan yang AKAN
 * dibayarkan — gaji pokok, komisi per SPG sekarang, pengurang, dan koreksi yang ikut
 * (`lib/spg/koreksi.ts`), atau sebab tahannya (P60).
 *
 * Gerbang halaman (P28 + Q9): `spg_sales:view` ATAU `spg_commission:pay` — halaman memagari dirinya
 * sendiri, bukan lewat ROUTE_PERMISSIONS. Pemegang `payments:verify` saja hanya melihat #utang
 * (memeriksa penerimaan utang SPG, keputusan 11).
 */
export default async function KomisiSpgPage({ searchParams }: { searchParams: Promise<{ bulan?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  const bukaPenuh = bolehMembukaKomisiSpg(izin);
  const verifikasi = bolehMemverifikasi(izin);
  if (!bukaPenuh && !verifikasi) redirect("/backoffice/dashboard");

  const sekarang = new Date();
  const pilihan = daftarBulanTerakhir(sekarang, JUMLAH_BULAN);
  const bulan = bacaBulanBayar((await searchParams).bulan, pilihan);
  const tanggalHari = (hari: readonly string[]) => hari.map((h) => formatDisplayDate(new Date(`${h}T00:00:00+07:00`)));

  if (!bukaPenuh) {
    // Pemeriksa pembayaran saja: hanya #utang (P68). Tanpa data komisi apa pun.
    const utang = await daftarUtangSpgKantor(sekarang);
    return (
      <KomisiSpgClient
        bulan={bulan}
        bulanIni={bulan}
        pilihan={pilihan}
        bolehKelola={false}
        bolehBayar={false}
        bolehAturTarif={false}
        bolehSetujuiJadwal={false}
        bolehVerifikasi
        bolehCatatHadir={false}
        bolehBukaKonsi={false}
        hanyaUtang
        jadwal={[]}
        utang={utang}
        putus={[]}
        konsi={[]}
        menungguCek={[]}
        konsiMenungguKunci={[]}
        tunggakan={[]}
        tunggakanDitahan={[]}
        koreksiMenunggu={[]}
        ringkas={{ totalDitetapkan: 0, totalDibayar: 0, totalKoreksi: 0, belumDitetapkan: 0, menungguCek: 0, ditahan: 0 }}
      />
    );
  }

  const [data, jadwal, utang] = await Promise.all([
    daftarKomisiKantor(bulan, sekarang),
    antreanJadwalBulanKantor({ sekarang }),
    daftarUtangSpgKantor(sekarang),
  ]);

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
    jumlahIkut: l.jumlahIkut,
    adaResmi: l.adaResmi,
    adaDibayar: l.adaDibayar,
    semuaDibayar: l.semuaDibayar,
    berbeda: l.berbeda,
    returMenunggu: l.returMenunggu,
    baris: l.baris.map((b) => ({
      userId: b.userId,
      nama: b.nama,
      ditugaskan: b.ditugaskan,
      penerima: b.penerima,
      peserta: b.peserta,
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
            baseSalary: b.resmi.baseSalary,
            ditetapkanLabel: formatDisplayDate(b.resmi.lockedAt),
            dibayarLabel: b.resmi.paidAt ? formatDisplayDate(b.resmi.paidAt) : null,
            note: b.resmi.note,
          }
        : null,
      gaji: b.gaji,
      tahan: b.tahan ? { alasan: b.tahan.alasan, hariLabel: tanggalHari(b.tahan.hari) } : null,
      luarRadius: tanggalHari(b.luarRadius),
      bebanHilangSisa: b.bebanHilangSisa,
      bayar: b.bayar,
      koreksiDiterapkan: b.koreksiDiterapkan,
      dibayarkan: b.dibayarkan,
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
    returMenunggu: k.returMenunggu,
    baris: k.baris.map((b) => ({
      id: b.id,
      nama: b.nama,
      gajiPokok: b.gajiPokok,
      gaji: b.gaji,
      tahan: b.tahan ? { alasan: b.tahan.alasan, hariLabel: tanggalHari(b.tahan.hari) } : null,
      luarRadius: tanggalHari(b.luarRadius),
      komisi: b.komisi,
      komisiHitung: b.komisiHitung,
      total: b.total,
      potonganHilang: b.potonganHilang,
      dibayarLabel: b.dibayarPada ? formatDisplayDate(b.dibayarPada) : null,
      bayar: b.bayar,
      koreksiDiterapkan: b.koreksiDiterapkan,
      dibayarkan: b.dibayarkan,
    })),
  }));
  const tunggakan = (daftar: typeof data.tunggakan): TunggakanTampil[] =>
    daftar.map((t) => ({
      refType: t.refType,
      refId: t.refId,
      jenis: t.jenis,
      nama: t.nama,
      namaToko: t.namaToko,
      bulanJual: t.bulanJual,
      bulanBayar: t.bulanBayar,
      cycleId: t.cycleId,
      noKonsi: t.noKonsi,
      bayar: t.bayar,
      returMenunggu: t.returMenunggu,
      ditahan: t.ditahan,
      hariTahanLabel: tanggalHari(t.hariTahan),
    }));

  return (
    <KomisiSpgClient
      bulan={data.bulan}
      bulanIni={data.bulanIni}
      pilihan={pilihan}
      bolehKelola={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)}
      bolehBayar={hasPermission(izin, PERMISSIONS.SPG_COMMISSION_PAY)}
      bolehAturTarif={hasPermission(izin, PERMISSIONS.SPG_COMMISSION_MANAGE)}
      bolehSetujuiJadwal={hasPermission(izin, PERMISSIONS.SPG_SCHEDULES_APPROVE)}
      bolehVerifikasi={verifikasi}
      bolehCatatHadir={hasPermission(izin, PERMISSIONS.SPG_ATTENDANCE_RECORD) || hasPermission(izin, PERMISSIONS.SPG_ATTENDANCE_VERIFY)}
      bolehBukaKonsi={bolehMembukaKonsi(izin)}
      hanyaUtang={false}
      jadwal={jadwal}
      utang={utang}
      putus={putus}
      konsi={konsi}
      menungguCek={data.menungguCek}
      konsiMenungguKunci={data.konsiMenungguKunci}
      tunggakan={tunggakan(data.tunggakan)}
      tunggakanDitahan={tunggakan(data.tunggakanDitahan)}
      koreksiMenunggu={data.koreksiMenunggu}
      ringkas={data.ringkas}
    />
  );
}
