import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { susunRencanaPerKelas } from "@/lib/stores/kelas-toko";
import type { AlasanMenurun } from "./toko-menurun";
import { jadwalHariIniSales } from "./jadwal-queries";
import { pengaturanSalesman, tokoSaya } from "./queries";
import { tokoMenurunHp } from "./toko-menurun-queries";

/**
 * Bahan layar "Rute hari ini". Urutannya dihitung di HP (`rute.ts`), karena
 * titik awalnya posisi HP; server hanya menyiapkan tokonya.
 *
 * Rencana = PERSIS rencana kunjungan beranda: "toko saya" (`tokoSaya`), toko
 * yang mulai jarang pesan (`tokoMenurunHp`), dinilai per kelas toko
 * (`susunRencanaPerKelas`) dengan batas hari yang sama (`pengaturanSalesman`).
 * Aturannya tidak ditulis ulang di sini — kalau beranda berubah, rute ikut.
 *
 * Toko menurun SELALU versi HP: versi kantor (`tokoMenurun`) memuat total
 * pesanan KONSI, dan urutan rencana dihitung dari rasionya — posisi toko
 * konsi di antara toko lain membuka seberapa tajam total konsinya turun.
 *
 * Salesman boleh menambah toko sendiri; pilihannya hanya dari "toko saya",
 * jadi semua toko itu ikut dikirim (dengan tanda apakah masuk rencana).
 *
 * Toko yang DIJADWALKAN KANTOR untuk hari ini selalu masuk rencana, paling
 * depan — juga yang bukan "toko saya" (kantor boleh menjadwalkan toko mana
 * pun selama kunci "hanya toko sendiri" mati). Yang sudah didatangi tetap
 * dikirim dalam rencana: HP memindahkannya ke kartu "Sudah dikunjungi".
 */

export type AlasanRute = {
  /** Sisa tagihan yang lewat janji bayar; null = bukan alasan. */
  tagih: number | null;
  menurun: AlasanMenurun | null;
  /** Sudah waktunya dikunjungi menurut jarak kunjungan kelasnya. */
  lama: boolean;
  /** Hari sejak kunjungan terakhir salesman ini; null = belum pernah. */
  hariSejak: number | null;
};

export type TokoRute = {
  id: string;
  nama: string;
  alamat: string | null;
  lat: number | null;
  lng: number | null;
  /** Salesman ini sudah check-in di toko ini hari ini (WIB). */
  dikunjungiHariIni: boolean;
  /** Alasan masuk rencana hari ini; null = tidak ada di rencana otomatis. */
  alasan: AlasanRute | null;
  /** Dijadwalkan kantor untuk hari ini (dengan catatan kantornya); null = tidak terjadwal. */
  jadwal: { catatan: string | null } | null;
};

export type DataRute = {
  /** Hari WIB `YYYY-MM-DD` — pilihan rute di HP berlaku untuk hari ini saja. */
  tanggal: string;
  /** Id toko rencana: jadwal kantor dulu, lalu urutan kepentingan beranda (tagihan dulu). */
  rencana: string[];
  /** Semua "toko saya" ditambah toko terjadwal hari ini, urut nama — bahan pilihan "Tambah toko". */
  toko: TokoRute[];
};

export async function ruteHariIni(salesmanId: string, sekarang: Date): Promise<DataRute> {
  const tanggal = kunciHariWib(sekarang);
  const [{ rencana: tokoRencana }, atur, jadwal] = await Promise.all([
    tokoSaya(salesmanId, sekarang),
    pengaturanSalesman(salesmanId, sekarang),
    jadwalHariIniSales(salesmanId, sekarang),
  ]);
  if (tokoRencana.length === 0 && jadwal.length === 0) return { tanggal, rencana: [], toko: [] };

  const milik = new Set(tokoRencana.map((t) => t.storeId));
  const ids = [...milik, ...jadwal.map((j) => j.storeId).filter((id) => !milik.has(id))];
  const awalHari = new Date(`${tanggal}T00:00:00+07:00`);
  const [menurun, alamat, kunjungan] = await Promise.all([
    tokoMenurunHp(
      tokoRencana.map((t) => ({ storeId: t.storeId, nama: t.nama })),
      sekarang,
    ),
    prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, address: true } }),
    // Kunjungan yang sedang berlangsung juga dihitung: tokonya sudah didatangi.
    prisma.storeVisit.findMany({
      where: { userId: salesmanId, storeId: { in: ids }, checkinAt: { gte: awalHari } },
      select: { storeId: true },
      distinct: ["storeId"],
    }),
  ]);

  const baris = susunRencanaPerKelas(tokoRencana, menurun, { batasHari: atur.batas.hari, hariIni: sekarang });
  const alasan = new Map<string, AlasanRute>(
    baris.map((b) => [
      b.storeId,
      {
        tagih: b.alasan.includes("tagih") ? b.sisaTagihan : null,
        menurun: b.menurun?.alasan ?? null,
        lama: b.alasan.includes("lama"),
        hariSejak: b.hariSejak,
      },
    ]),
  );
  const alamatToko = new Map(alamat.map((a) => [a.id, a.address]));
  const sudah = new Set(kunjungan.map((k) => k.storeId));
  const terjadwal = new Map(jadwal.map((j) => [j.storeId, { catatan: j.catatan }]));
  const idJadwal = jadwal.map((j) => j.storeId);

  return {
    tanggal,
    rencana: [...idJadwal, ...baris.map((b) => b.storeId).filter((id) => !terjadwal.has(id))],
    toko: [
      ...tokoRencana.map((t) => ({
        id: t.storeId,
        nama: t.nama,
        alamat: alamatToko.get(t.storeId)?.trim() || null,
        lat: t.lat,
        lng: t.lng,
        dikunjungiHariIni: sudah.has(t.storeId),
        alasan: alasan.get(t.storeId) ?? null,
        jadwal: terjadwal.get(t.storeId) ?? null,
      })),
      ...jadwal
        .filter((j) => !milik.has(j.storeId))
        .map((j) => ({
          id: j.storeId,
          nama: j.nama,
          alamat: j.alamat,
          lat: j.lat,
          lng: j.lng,
          dikunjungiHariIni: sudah.has(j.storeId),
          alasan: null,
          jadwal: { catatan: j.catatan },
        })),
    ].sort((a, b) => a.nama.localeCompare(b.nama, "id")),
  };
}
