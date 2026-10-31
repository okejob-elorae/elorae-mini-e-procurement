import { prisma } from '@elorae/db';
import { tokoLapangan } from '@/lib/receivables/pwa-queries';
import type { BarisJual } from './dasbor';
import type { BarisLakuKonsi } from './penjualan-konsi';
import { lakuKonsiSatuSalesman } from './penjualan-konsi-queries';
import { nilaiTokoMenurun, urutkanTokoMenurun, type PesananToko, type TokoMenurun } from './toko-menurun';
import {
  bacaAturanKelasToko,
  bacaKelas,
  jarakKunjungan,
  KUNCI_KELAS_TOKO,
  type TokoRencanaKelas,
} from '@/lib/stores/kelas-toko';
import { daftarKelasToko } from '@/lib/stores/queries';
import {
  bacaBatasHari,
  bacaTargetBulan,
  bacaTokoTerkunci,
  bulanWib,
  KUNCI_BATAS_HARI,
  KUNCI_TARGET,
  KUNCI_TOKO_TERKUNCI,
} from './pengaturan';

/**
 * Kueri dasbor salesman. SEMUA disaring ke satu salesman — layar HP tidak
 * pernah menampilkan angka salesman lain.
 */

const HARI_MS = 86_400_000;
const angka = (v: unknown) => Number(v ?? 0);

/** Riwayat yang menentukan "toko saya" (keputusan pemilik: otomatis dari riwayat 90 hari). */
export const HARI_TOKO_SAYA = 90;

/**
 * Penjualan salesman per baris, dari `sejak` sampai sekarang, tiga kanal:
 *   putus = pengiriman (tanggal kirim) — sama dengan "terealisasi" beranda;
 *   konsi = barang LAKU di toko konsinyasi yang ia pegang, pada harga Elorae
 *           (`penjualan-konsi.ts`) — transfer konsi yang disetujui BUKAN omzet;
 *   van   = penjualan dari mobil.
 *
 * `opsi.lakuKonsi`: baris laku yang sudah dibaca pemanggil untuk salesman dan
 * `sejak` yang SAMA (beranda HP butuh pcs-nya juga) — supaya bacaan laku yang
 * berat tidak dijalankan dua kali.
 */
export async function penjualanSalesman(
  salesmanId: string,
  sejak: Date,
  opsi: { lakuKonsi?: Promise<BarisLakuKonsi[]> } = {},
): Promise<BarisJual[]> {
  const [kirim, konsi, van] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: { gte: sejak }, order: { salesmanId, orderType: 'PUTUS' } },
      select: { deliveredAt: true, total: true },
    }),
    opsi.lakuKonsi ?? lakuKonsiSatuSalesman(salesmanId, sejak),
    prisma.vanSale.findMany({
      where: { salesmanId, createdAt: { gte: sejak } },
      select: { createdAt: true, total: true },
    }),
  ]);
  return [
    ...kirim.map((d) => ({ tanggal: d.deliveredAt, jenis: 'putus' as const, nilai: angka(d.total) })),
    ...konsi.map((l) => ({ tanggal: l.tanggal, jenis: 'konsi' as const, nilai: l.nilai })),
    ...van.map((v) => ({ tanggal: v.createdAt, jenis: 'van' as const, nilai: angka(v.total) })),
  ];
}

export type PesananSaya = { menunggu: number; siapKirim: number; terkirimBulanIni: number; ditolak7Hari: number };

export async function pesananSaya(salesmanId: string, hariIni: Date): Promise<PesananSaya> {
  const awalBulan = new Date(`${bulanWib(hariIni)}-01T00:00:00+07:00`);
  const tujuhHari = new Date(hariIni.getTime() - 7 * HARI_MS);
  const [menunggu, siapKirim, terkirimBulanIni, ditolak7Hari] = await Promise.all([
    prisma.fieldSalesOrder.count({ where: { salesmanId, status: 'PENDING_APPROVAL' } }),
    prisma.fieldSalesOrder.count({
      where: { salesmanId, status: 'APPROVED', orderType: 'PUTUS', deliveryStatus: { in: ['PENDING', 'PARTIAL'] } },
    }),
    prisma.fieldSalesDelivery.count({ where: { deliveredAt: { gte: awalBulan }, order: { salesmanId } } }),
    // Ditolak KANTOR saja — pesanan yang dibatalkan salesman sendiri (cancelledById) bukan penolakan.
    prisma.fieldSalesOrder.count({ where: { salesmanId, status: 'REJECTED', cancelledById: null, rejectedAt: { gte: tujuhHari } } }),
  ]);
  return { menunggu, siapKirim, terkirimBulanIni, ditolak7Hari };
}

export type TokoTagih = { storeId: string; nama: string; sisa: number; telepon: string | null; kontak: string | null };

/** Apakah kunci "hanya toko sendiri" sedang menyala (bawaan: mati). */
export async function tokoTerkunci(): Promise<boolean> {
  const baris = await prisma.systemSetting.findUnique({ where: { key: KUNCI_TOKO_TERKUNCI }, select: { value: true } });
  return bacaTokoTerkunci(baris?.value);
}

/**
 * Toko saya, lengkap untuk rencana kunjungan, plus daftar yang perlu ditagih.
 *
 * "Toko saya" = toko yang ia PEGANG (`Store.salesmanId`). Selama kunci "hanya
 * toko sendiri" mati, ditambah toko dari riwayatnya (90 hari) dan toko yang
 * piutangnya ia tagih — supaya sebelum admin selesai membagi toko, beranda
 * tetap berisi. Saat kunci menyala, hanya yang ia pegang.
 *
 * "Perlu ditagih" = keadaan `lewat` (janji bayar kontrabon sudah terlewati) —
 * persis keadaan yang di layar piutang berbunyi "tagih ulang dan minta tanggal
 * baru". Keadaan lain punya alasan untuk TIDAK ditagih dulu (klaim menunggu
 * verifikasi, retur tertahan), dan layar piutang yang menjelaskannya.
 */
export async function tokoSaya(salesmanId: string, hariIni: Date): Promise<{ rencana: TokoRencanaKelas[]; tagih: TokoTagih[] }> {
  const sejak = new Date(hariIni.getTime() - HARI_TOKO_SAYA * HARI_MS);
  const [kunjungan, pesanan, van, piutang, dipegang, terkunci] = await Promise.all([
    prisma.storeVisit.groupBy({ by: ['storeId'], where: { userId: salesmanId }, _max: { checkinAt: true } }),
    prisma.fieldSalesOrder.findMany({
      where: { salesmanId, createdAt: { gte: sejak } },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
    prisma.vanSale.findMany({
      where: { salesmanId, createdAt: { gte: sejak }, storeId: { not: null } },
      select: { storeId: true },
      distinct: ['storeId'],
    }),
    tokoLapangan(salesmanId),
    prisma.store.findMany({ where: { salesmanId, isActive: true }, select: { id: true } }),
    tokoTerkunci(),
  ]);

  const kunjunganTerakhir = new Map(kunjungan.map((k) => [k.storeId, k._max.checkinAt]));
  const lewat = new Map(piutang.filter((p) => p.keadaan === 'lewat').map((p) => [p.storeId, p.sisa]));

  const id = new Set<string>([
    // Toko yang ia pegang, walau belum pernah didatangi — justru yang belum
    // pernah itulah yang paling perlu masuk rencana.
    ...dipegang.map((t) => t.id),
    ...(terkunci
      ? []
      : [
          ...kunjungan.filter((k) => k._max.checkinAt && k._max.checkinAt >= sejak).map((k) => k.storeId),
          ...pesanan.map((p) => p.storeId),
          ...van.map((v) => v.storeId as string),
          // Piutang yang masih terbuka ikut "toko saya" berapa pun umurnya —
          // tagihan lama justru yang paling perlu didatangi.
          ...piutang.filter((p) => p.sisa > 0).map((p) => p.storeId),
        ]),
  ]);
  if (id.size === 0) return { rencana: [], tagih: [] };

  const [toko, setelan] = await Promise.all([
    prisma.store.findMany({
      where: { id: { in: [...id] }, isActive: true },
      select: { id: true, name: true, lat: true, lng: true, phone: true, contactName: true, storeClass: true },
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: [KUNCI_BATAS_HARI, KUNCI_KELAS_TOKO] } },
      select: { key: true, value: true },
    }),
  ]);

  // Jarak kunjungan per toko: jarak kelasnya, atau batas hari umum bila tanpa
  // kelas. Kelas otomatis (bila dinyalakan pemilik) hanya mengisi toko yang
  // belum diberi kelas oleh admin — pilihan admin selalu menang.
  const nilaiSetelan = (k: string) => setelan.find((b) => b.key === k)?.value ?? null;
  const batasUmum = bacaBatasHari(nilaiSetelan(KUNCI_BATAS_HARI)).hari;
  const aturanKelas = bacaAturanKelasToko(nilaiSetelan(KUNCI_KELAS_TOKO));
  const usulan =
    aturanKelas.otomatis.aktif && toko.some((t) => !bacaKelas(t.storeClass))
      ? new Map((await daftarKelasToko(aturanKelas, hariIni)).map((b) => [b.storeId, b.usulan]))
      : null;

  const rencana: TokoRencanaKelas[] = toko.map((t) => {
    const kelasAdmin = bacaKelas(t.storeClass);
    const kelas = kelasAdmin ?? usulan?.get(t.id) ?? null;
    return {
      storeId: t.id,
      nama: t.name,
      kunjunganTerakhir: kunjunganTerakhir.get(t.id) ?? null,
      tagih: lewat.has(t.id),
      sisaTagihan: lewat.get(t.id) ?? 0,
      lat: t.lat === null ? null : angka(t.lat),
      lng: t.lng === null ? null : angka(t.lng),
      kelas,
      kelasOtomatis: kelasAdmin === null && kelas !== null,
      jarakHari: jarakKunjungan({ storeClass: kelas }, aturanKelas, batasUmum),
    };
  });
  const tagih: TokoTagih[] = toko
    .filter((t) => lewat.has(t.id))
    .map((t) => ({ storeId: t.id, nama: t.name, sisa: lewat.get(t.id) ?? 0, telepon: t.phone, kontak: t.contactName }))
    .sort((a, b) => b.sisa - a.sisa);
  return { rencana, tagih };
}

/** Riwayat yang dipakai menilai kebiasaan pesan toko. Setahun: cukup untuk toko yang pesan sebulan sekali. */
export const HARI_RIWAYAT_MENURUN = 365;

/**
 * Toko saya yang mulai jarang pesan (aturannya di `toko-menurun.ts`), yang
 * paling terlambat dulu. `toko` = "toko saya" seperti yang disusun `tokoSaya`.
 *
 * Kebiasaan pesan milik TOKO — siapa pun salesman yang mencatatnya — sama
 * dengan saran pesanan: toko yang baru dipindahkan ke salesman lain tidak
 * boleh kehilangan riwayatnya. Satu pesanan = satu peristiwa:
 *   putus terkirim  = tanggal kiriman PERTAMA, nilai seluruh kirimannya —
 *                     pesanan yang dikirim bertahap bukan beberapa pesanan,
 *                     kalau dihitung per kiriman jarak biasanya menyusut dan
 *                     toko jadi terlalu cepat ditandai;
 *   putus belum terkirim (menunggu persetujuan / pengiriman) = tanggal pesan,
 *                     nilai belum diketahui — tokonya SUDAH pesan, jangan
 *                     ditandai jarang hanya karena gudang belum mengirim;
 *   konsi disetujui = tanggal disetujui, nilainya; konsi menunggu = tanggal
 *                     pesan, nilai belum diketahui;
 *   penjualan van ke toko terdaftar = tanggal jual, nilainya — toko yang
 *                     beralih membeli dari mobil tetap membeli.
 * Pesanan yang ditolak bukan kebiasaan, tidak dihitung.
 */
export async function tokoMenurun(
  toko: readonly { storeId: string; nama: string }[],
  hariIni: Date,
): Promise<TokoMenurun[]> {
  if (toko.length === 0) return [];
  const ids = toko.map((t) => t.storeId);
  const sejak = new Date(hariIni.getTime() - HARI_RIWAYAT_MENURUN * HARI_MS);

  const [kirim, putusBelum, konsi, van] = await Promise.all([
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: { gte: sejak }, order: { storeId: { in: ids }, orderType: 'PUTUS', status: 'APPROVED' } },
      select: { orderId: true, deliveredAt: true, total: true, order: { select: { storeId: true } } },
    }),
    prisma.fieldSalesOrder.findMany({
      where: {
        storeId: { in: ids },
        orderType: 'PUTUS',
        status: { not: 'REJECTED' },
        createdAt: { gte: sejak },
        deliveries: { none: {} },
      },
      select: { storeId: true, createdAt: true },
    }),
    prisma.fieldSalesOrder.findMany({
      where: {
        storeId: { in: ids },
        orderType: 'KONSI',
        OR: [
          { status: 'APPROVED', approvedAt: { gte: sejak } },
          { status: 'PENDING_APPROVAL', createdAt: { gte: sejak } },
        ],
      },
      select: { storeId: true, status: true, createdAt: true, approvedAt: true, total: true },
    }),
    prisma.vanSale.findMany({
      where: { storeId: { in: ids }, createdAt: { gte: sejak } },
      select: { storeId: true, createdAt: true, total: true },
    }),
  ]);

  const perToko = new Map<string, PesananToko[]>();
  const tambah = (storeId: string, p: PesananToko) => {
    const daftar = perToko.get(storeId);
    if (daftar) daftar.push(p);
    else perToko.set(storeId, [p]);
  };

  const perPesanan = new Map<string, { storeId: string; tanggal: Date; nilai: number }>();
  for (const d of kirim) {
    const p = perPesanan.get(d.orderId);
    if (!p) perPesanan.set(d.orderId, { storeId: d.order.storeId, tanggal: d.deliveredAt, nilai: angka(d.total) });
    else {
      p.nilai += angka(d.total);
      if (d.deliveredAt < p.tanggal) p.tanggal = d.deliveredAt;
    }
  }
  for (const p of perPesanan.values()) tambah(p.storeId, { tanggal: p.tanggal, nilai: p.nilai });
  for (const o of putusBelum) tambah(o.storeId, { tanggal: o.createdAt, nilai: null });
  for (const o of konsi) {
    if (o.status === 'APPROVED') tambah(o.storeId, { tanggal: o.approvedAt ?? o.createdAt, nilai: angka(o.total) });
    else tambah(o.storeId, { tanggal: o.createdAt, nilai: null });
  }
  for (const v of van) tambah(v.storeId as string, { tanggal: v.createdAt, nilai: angka(v.total) });

  const hasil: TokoMenurun[] = [];
  for (const t of toko) {
    const h = nilaiTokoMenurun(perToko.get(t.storeId) ?? [], hariIni);
    if (h) hasil.push({ ...h, storeId: t.storeId, nama: t.nama });
  }
  return urutkanTokoMenurun(hasil);
}

export type KunjunganSaya = { visitId: string; storeId: string; toko: string; checkinAt: Date };

/**
 * Kunjungan terakhir salesman ini, untuk memberi nama pada foto kunjungan yang
 * masih tertahan di HP (antreannya hanya menyimpan id kunjungan dan id toko).
 * Foto tertahan hampir selalu dari kunjungan beberapa hari terakhir; 100
 * kunjungan lebih dari cukup.
 */
export async function kunjunganTerakhirSaya(userId: string, jumlah = 100): Promise<KunjunganSaya[]> {
  const rows = await prisma.storeVisit.findMany({
    where: { userId },
    orderBy: { checkinAt: 'desc' },
    take: jumlah,
    select: { id: true, storeId: true, checkinAt: true, store: { select: { name: true } } },
  });
  return rows.map((v) => ({ visitId: v.id, storeId: v.storeId, toko: v.store.name, checkinAt: v.checkinAt }));
}

export async function pengaturanSalesman(salesmanId: string, hariIni: Date) {
  const baris = await prisma.systemSetting.findMany({
    where: { key: { in: [KUNCI_BATAS_HARI, KUNCI_TARGET] } },
    select: { key: true, value: true },
  });
  const nilai = (k: string) => baris.find((b) => b.key === k)?.value ?? null;
  return {
    batas: bacaBatasHari(nilai(KUNCI_BATAS_HARI)),
    target: bacaTargetBulan(nilai(KUNCI_TARGET), salesmanId, bulanWib(hariIni)),
  };
}

export type SaranPesanan = {
  tanggalPesanan: Date[];
  terakhir: {
    id: string;
    orderNo: string;
    tanggal: Date;
    baris: { itemId: string; variantSku: string; productName: string; qty: number }[];
  } | null;
  promo: { id: string; name: string; type: string; value: number | null }[];
};

/**
 * Bahan "Saran pesanan" di detail toko. Pola pesanannya milik TOKO — siapa pun
 * salesman yang mencatatnya — karena yang ingin diketahui adalah kebiasaan toko
 * itu memesan. Pesanan yang ditolak tidak dihitung: itu bukan kebiasaan.
 */
export async function saranPesananToko(storeId: string, hariIni: Date): Promise<SaranPesanan> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { termsType: true } });
  if (!toko) return { tanggalPesanan: [], terakhir: null, promo: [] };

  const [pesanan, terakhir, promo] = await Promise.all([
    prisma.fieldSalesOrder.findMany({
      where: { storeId, status: { not: 'REJECTED' }, orderType: toko.termsType },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 24,
    }),
    prisma.fieldSalesOrder.findFirst({
      where: { storeId, status: { not: 'REJECTED' }, orderType: toko.termsType },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNo: true,
        createdAt: true,
        lines: { select: { itemId: true, variantSku: true, productName: true, qty: true }, orderBy: { productName: 'asc' } },
      },
    }),
    prisma.promo.findMany({
      where: {
        isActive: true,
        termsType: toko.termsType,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: hariIni } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: hariIni } }] },
          { OR: [{ allStores: true }, { stores: { some: { storeId } } }] },
        ],
      },
      select: { id: true, name: true, type: true, value: true },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      take: 5,
    }),
  ]);

  return {
    tanggalPesanan: pesanan.map((p) => p.createdAt),
    terakhir: terakhir
      ? { id: terakhir.id, orderNo: terakhir.orderNo, tanggal: terakhir.createdAt, baris: terakhir.lines }
      : null,
    promo: promo.map((p) => ({ id: p.id, name: p.name, type: p.type, value: p.value === null ? null : angka(p.value) })),
  };
}

/**
 * Baris pesanan yang mau DIULANG di katalog. Hanya pesanan toko itu sendiri
 * yang tidak ditolak — alamat katalog yang disunting tangan tidak bisa menarik
 * pesanan toko lain ke keranjang.
 */
export async function barisPesananUntukUlang(
  orderId: string,
  storeId: string,
): Promise<{ itemId: string; variantSku: string; qty: number }[] | null> {
  const o = await prisma.fieldSalesOrder.findFirst({
    where: { id: orderId, storeId, status: { not: 'REJECTED' } },
    // Baris bonus (promo "beli X gratis Y") bukan pesanan toko: mengulangnya akan
    // memasukkan barang gratis sebagai barang berbayar.
    select: { lines: { where: { isBonus: false }, select: { itemId: true, variantSku: true, qty: true } } },
  });
  return o ? o.lines : null;
}

/**
 * Pengguna yang dihitung "salesman": perannya membuka aplikasi HP
 * (`pwa:access`), bukan peran sistem (admin), dan tidak terikat satu toko
 * (itu SPG). Satu definisi untuk semua pemilih sales di backoffice.
 */
export async function daftarSalesman(): Promise<{ id: string; nama: string }[]> {
  const rows = await prisma.user.findMany({
    where: {
      assignedStoreId: null,
      roleDefinition: { isSystem: false, permissions: { some: { permission: { code: 'pwa:access' } } } },
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
  });
  return rows.map((u) => ({ id: u.id, nama: u.name ?? u.email }));
}

/**
 * SPG: pengguna yang ditugaskan tetap di satu toko (`User.assignedStoreId`).
 * Pasangan `daftarSalesman` — keduanya tidak pernah beririsan, jadi SPG tidak
 * ikut pembagian toko sales. `tokoNama` null bila tokonya sudah tidak ada
 * (`assignedStoreId` bukan relasi, tidak dijaga foreign key).
 */
export async function daftarSpg(): Promise<{ id: string; nama: string; tokoNama: string | null }[]> {
  const rows = await prisma.user.findMany({
    where: { assignedStoreId: { not: null } },
    select: { id: true, name: true, email: true, assignedStoreId: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });
  if (rows.length === 0) return [];
  const toko = await prisma.store.findMany({
    where: { id: { in: [...new Set(rows.map((u) => u.assignedStoreId as string))] } },
    select: { id: true, name: true },
  });
  const namaToko = new Map(toko.map((s) => [s.id, s.name]));
  return rows.map((u) => ({
    id: u.id,
    nama: u.name ?? u.email,
    tokoNama: namaToko.get(u.assignedStoreId as string) ?? null,
  }));
}
