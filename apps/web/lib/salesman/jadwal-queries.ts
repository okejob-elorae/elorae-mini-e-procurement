import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { izinDisetujuiRentang } from "./izin-queries";
import { kunciHariWib } from "@/lib/dashboard/tren";
import {
  geserHari,
  hariSeminggu,
  kepatuhanJadwal,
  ringkasStatus,
  type RingkasJadwal,
  type StatusJadwal,
} from "./jadwal";

/**
 * Kueri jadwal kunjungan dari kantor — untuk layar kantor mingguan, halaman
 * jadwal di HP, beranda (toko terjadwal hari ini), dan rute hari ini.
 *
 * `VisitSchedule` tidak punya relasi (tanpa foreign key), jadi toko digabung
 * di sini dengan satu kueri per pemanggilan, bukan per baris. Status
 * kepatuhan dihitung `kepatuhanJadwal` (murni, dites).
 */

const angka = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const awalHari = (kunci: string) => new Date(`${kunci}T00:00:00+07:00`);

export type BarisJadwalTampil = {
  id: string;
  dayKey: string;
  storeId: string;
  nama: string;
  kode: string;
  alamat: string | null;
  area: string | null;
  /** Toko dinonaktifkan sesudah dijadwalkan — kantor tetap melihatnya, HP tidak. */
  aktif: boolean;
  catatan: string | null;
  status: StatusJadwal;
  lat: number | null;
  lng: number | null;
};

export type HariJadwal = {
  dayKey: string;
  toko: BarisJadwalTampil[];
  ringkas: RingkasJadwal;
};

type InfoToko = {
  name: string;
  code: string;
  address: string;
  isActive: boolean;
  lat: unknown;
  lng: unknown;
  group: { name: string } | null;
};

async function infoToko(ids: readonly string[]): Promise<Map<string, InfoToko>> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map();
  const rows = await prisma.store.findMany({
    where: { id: { in: unik } },
    select: {
      id: true,
      name: true,
      code: true,
      address: true,
      isActive: true,
      lat: true,
      lng: true,
      group: { select: { name: true } },
    },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Semua baris jadwal satu sales di rentang hari (inklusif), dengan nama toko
 * dan status kepatuhan. Urut hari, lalu nama toko.
 */
export async function jadwalRentang(
  salesmanId: string,
  dari: string,
  sampai: string,
  sekarang: Date,
): Promise<BarisJadwalTampil[]> {
  const rows = await prisma.visitSchedule.findMany({
    where: { salesmanId, dayKey: { gte: dari, lte: sampai } },
    select: { id: true, salesmanId: true, storeId: true, dayKey: true, note: true },
  });
  if (rows.length === 0) return [];
  const idToko = [...new Set(rows.map((r) => r.storeId))];
  const [toko, kunjungan, izin] = await Promise.all([
    infoToko(idToko),
    prisma.storeVisit.findMany({
      where: {
        userId: salesmanId,
        storeId: { in: idToko },
        checkinAt: { gte: awalHari(dari), lt: awalHari(geserHari(sampai, 1)) },
      },
      select: { userId: true, storeId: true, checkinAt: true },
    }),
    // Hari izin/sakit/cuti yang disetujui bukan "terlewat".
    izinDisetujuiRentang([salesmanId], dari, sampai),
  ]);
  const { baris } = kepatuhanJadwal(rows, kunjungan, kunciHariWib(sekarang), izin);
  return baris
    .map((b) => {
      const t = toko.get(b.storeId);
      return {
        id: b.id,
        dayKey: b.dayKey,
        storeId: b.storeId,
        // Toko yang sudah dihapus (tanpa foreign key): barisnya tetap tampil di kantor.
        nama: t?.name ?? b.storeId,
        kode: t?.code ?? "",
        alamat: t?.address?.trim() || null,
        area: t?.group?.name ?? null,
        aktif: t?.isActive ?? false,
        catatan: b.note,
        status: b.status,
        lat: angka(t?.lat),
        lng: angka(t?.lng),
      };
    })
    .sort((a, b) => (a.dayKey === b.dayKey ? a.nama.localeCompare(b.nama, "id") : a.dayKey < b.dayKey ? -1 : 1));
}

/**
 * Satu minggu (Senin–Minggu) jadwal satu sales, per hari. `hanyaAktif`
 * membuang toko yang sudah dinonaktifkan — dipakai HP, karena sales tidak bisa
 * membuka toko nonaktif; kantor tetap melihat semuanya.
 */
export async function jadwalMinggu(
  salesmanId: string,
  senin: string,
  sekarang: Date,
  opsi: { hanyaAktif?: boolean } = {},
): Promise<{ hari: HariJadwal[]; ringkas: RingkasJadwal }> {
  const hari = hariSeminggu(senin);
  const semua = await jadwalRentang(salesmanId, hari[0], hari[6], sekarang);
  const baris = opsi.hanyaAktif ? semua.filter((b) => b.aktif) : semua;
  const perHari = hari.map((dayKey) => {
    const toko = baris.filter((b) => b.dayKey === dayKey);
    return { dayKey, toko, ringkas: ringkasStatus(toko) };
  });
  return { hari: perHari, ringkas: ringkasStatus(baris) };
}

/** Toko terjadwal hari ini untuk beranda dan rute — hanya toko aktif. */
export type JadwalHariIni = {
  storeId: string;
  nama: string;
  alamat: string | null;
  catatan: string | null;
  lat: number | null;
  lng: number | null;
  dikunjungi: boolean;
};

export async function jadwalHariIniSales(salesmanId: string, sekarang: Date): Promise<JadwalHariIni[]> {
  const hariIni = kunciHariWib(sekarang);
  const baris = await jadwalRentang(salesmanId, hariIni, hariIni, sekarang);
  return baris
    .filter((b) => b.aktif)
    .map((b) => ({
      storeId: b.storeId,
      nama: b.nama,
      alamat: b.alamat,
      catatan: b.catatan,
      lat: b.lat,
      lng: b.lng,
      dikunjungi: b.status === "DIKUNJUNGI",
    }));
}

// ─── Layar kantor: memilih toko ──────────────────────────────────────────────

export type TokoPilihanJadwal = {
  id: string;
  kode: string;
  nama: string;
  alamat: string | null;
  area: string | null;
  /** Nama pemegang toko sekarang; null = belum ada pemegang. */
  pemegang: string | null;
  /** Dipegang sales yang sedang dijadwalkan. */
  milikSales: boolean;
};

/** Paling banyak sebanyak ini hasil pencarian — sama dengan batas toko per hari. */
export const BATAS_HASIL_CARI = 60;

/**
 * Toko yang bisa ditambahkan ke jadwal sales: aktif, cocok dengan kata cari
 * (nama/kode/alamat) dan area. Saat kunci "hanya toko sendiri" menyala, hanya
 * toko yang ia pegang. Toko yang ia pegang tampil lebih dulu.
 */
export async function cariTokoUntukJadwal(input: {
  salesmanId: string;
  q?: string;
  groupId?: string | null;
  terkunci: boolean;
}): Promise<TokoPilihanJadwal[]> {
  const q = (input.q ?? "").trim().slice(0, 80);
  const dasar = {
    isActive: true,
    ...(input.groupId ? { groupId: input.groupId } : {}),
  };
  const cocok = q
    ? [
        {
          OR: [
            { name: cariTeks(q) },
            { code: cariTeks(q) },
            { address: cariTeks(q) },
          ],
        },
      ]
    : [];
  const pilih = {
    id: true,
    code: true,
    name: true,
    address: true,
    salesmanId: true,
    group: { select: { name: true } },
    salesman: { select: { name: true, email: true } },
  } as const;
  // Toko yang ia pegang dulu (dua kueri: urutan "milik dia dulu" tidak bisa
  // dinyatakan di orderBy). Saat kunci menyala hanya yang pertama.
  const milik = await prisma.store.findMany({
    where: { ...dasar, salesmanId: input.salesmanId, AND: cocok },
    select: pilih,
    orderBy: { name: "asc" },
    take: BATAS_HASIL_CARI,
  });
  const lain =
    input.terkunci || milik.length >= BATAS_HASIL_CARI
      ? []
      : await prisma.store.findMany({
          // `NOT { salesmanId }` saja ikut membuang toko tanpa pemegang (NULL di SQL).
          where: {
            ...dasar,
            AND: [...cocok, { OR: [{ salesmanId: null }, { salesmanId: { not: input.salesmanId } }] }],
          },
          select: pilih,
          orderBy: { name: "asc" },
          take: BATAS_HASIL_CARI - milik.length,
        });
  return [...milik, ...lain].map((r) => ({
    id: r.id,
    kode: r.code,
    nama: r.name,
    alamat: r.address?.trim() || null,
    area: r.group?.name ?? null,
    pemegang: r.salesman ? (r.salesman.name ?? r.salesman.email) : null,
    milikSales: r.salesmanId === input.salesmanId,
  }));
}

export async function daftarAreaToko(): Promise<{ id: string; kode: string; nama: string }[]> {
  const rows = await prisma.storeGroup.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  });
  return rows.map((g) => ({ id: g.id, kode: g.code, nama: g.name }));
}
