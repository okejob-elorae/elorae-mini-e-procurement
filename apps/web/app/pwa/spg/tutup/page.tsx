import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bacaTutupHari, KUNCI_TUTUP_HARI } from "@/lib/spg/pengaturan";
import { hariTutupYangBoleh, labelHariTutup, pesanTutupHariWa, ringkasanUntukHp } from "@/lib/spg/tutup-hari";
import { laporanTutupHari, ringkasanTutupHari } from "@/lib/spg/tutup-hari-queries";
import { pengunjungToko } from "@/lib/spg/pengunjung-queries";
import { TutupHariClient, type LaporanHp } from "./TutupHariClient";

export const dynamic = "force-dynamic";

/**
 * Laporan tutup hari SPG. Angka penjualan dihitung sistem dari nota SEMUA SPG
 * toko ini; SPG menambah pengunjung, total kasir toko untuk merek kita,
 * catatan kendala, dan foto (sesuai Pengaturan → SPG). Hari ini atau kemarin
 * (`?hari=kemarin`) — yang lupa menutup semalam masih bisa melapor pagi ini.
 *
 * Hanya SPG; toko SELALU toko tetapnya dari sesi, tidak pernah dari alamat.
 * Rupiah rekan tidak pernah sampai ke HP (`ringkasanUntukHp`).
 */
export default async function SpgTutupHariPage({ searchParams }: { searchParams: Promise<{ hari?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const storeId = await ambilTokoTetap(userId);
  if (!storeId) redirect("/pwa");

  const { hari } = await searchParams;
  const pilihan = hari === "kemarin" ? "kemarin" : "hariIni";
  const boleh = hariTutupYangBoleh(new Date());
  const day = pilihan === "kemarin" ? boleh.kemarin : boleh.hariIni;

  const [ringkasan, laporan, setelan, terhitung] = await Promise.all([
    ringkasanTutupHari(storeId, day),
    laporanTutupHari(storeId, day),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_TUTUP_HARI }, select: { value: true } }),
    // Jumlah dari penghitung pengunjung semua SPG toko ini hari itu (null = belum ada yang menghitung).
    pengunjungToko(storeId, day).catch(() => null),
  ]);
  if (!ringkasan) redirect("/pwa");

  const laporanHp: LaporanHp | null = laporan
    ? {
        oleh: laporan.closedByName,
        olehSaya: laporan.closedById === userId,
        // Diformat di server (WIB): format di klien bisa berbeda antara Node dan Safari.
        jam: formatDisplayDateTime(laporan.updatedAt),
        pengunjung: laporan.visitorCount,
        totalKasir: laporan.cashierTotal,
        catatan: laporan.note,
        foto: laporan.photoUrls,
        teksWa: pesanTutupHariWa({
          namaToko: ringkasan.namaToko,
          day,
          nota: laporan.notaCount,
          potong: laporan.pcs,
          potongKembali: laporan.returnPcs,
          nilaiBersih: laporan.netTotal,
          potongan: laporan.discountTotal,
          terlaris: ringkasan.terlaris,
          pengunjung: laporan.visitorCount,
          totalKasir: laporan.cashierTotal,
          catatan: laporan.note,
        }),
      }
    : null;

  return (
    <TutupHariClient
      // Ganti hari = formulir baru: isian hari lain tidak terbawa.
      key={day}
      day={day}
      pilihan={pilihan}
      labelHari={labelHariTutup(day)}
      data={ringkasanUntukHp(ringkasan, userId)}
      laporan={laporanHp}
      aturan={bacaTutupHari(setelan?.value)}
      pengunjungTerhitung={terhitung}
    />
  );
}
