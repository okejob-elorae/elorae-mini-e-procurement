import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { bagiKomisi } from './aturan';

/**
 * Penulis siklus konsinyasi.
 *
 * Yang dijaga paling ketat: ANGKA RESMI. Setelah dikunci, ia dipakai menagih
 * toko, membayar komisi, dan mengurangi stok titipan — tiga hal yang tidak bisa
 * ditarik kembali begitu saja.
 */

type Klien = Prisma.TransactionClient;
const angka = (v: unknown): number => Number(v ?? 0);
const D = (n: number) => new Prisma.Decimal(n);

export type BarisKirim = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type BarisLaporan = { itemId?: string | null; itemName: string; qty: number };

export type BarisResmi = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type AlasanGagalKonsi =
  | 'TIDAK_DITEMUKAN'
  | 'TOKO_BUKAN_KONSI'
  | 'SIKLUS_SUDAH_ADA'
  | 'PERIODE_TIDAK_VALID'
  | 'SUDAH_DIKUNCI'
  | 'BELUM_DIKUNCI'
  | 'LAPORAN_BELUM_LENGKAP'
  | 'ADA_GAJI_SUDAH_DIBAYAR'
  | 'TANPA_BARIS'
  | 'NILAI_TIDAK_VALID'
  | 'NOMOR_WAJIB'
  | 'SUDAH_DIBAYAR'
  | 'NOMOR_BENTROK';

type Gagal = { ok: false; alasan: AlasanGagalKonsi };

/** `KONSI/26/07/0002` — dinomori menurut periode siklusnya, bukan hari dibuat. */
async function nomorKonsi(tx: Klien, tahun: number, bulan: number): Promise<string> {
  const depan = `KONSI/${String(tahun).slice(-2)}/${String(bulan).padStart(2, '0')}/`;
  const terakhir = await tx.consignmentCycle.findFirst({
    where: { noKonsi: { startsWith: depan } },
    orderBy: { noKonsi: 'desc' },
    select: { noKonsi: true },
  });
  const urutan = terakhir ? Number(terakhir.noKonsi.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/** Buka siklus untuk satu toko konsinyasi pada satu bulan. */
export async function bukaSiklus(input: {
  storeId: string;
  periodYear: number;
  periodMonth: number;
  spgDueDate?: Date | null;
}): Promise<{ ok: true; id: string; noKonsi: string } | Gagal> {
  if (input.periodMonth < 1 || input.periodMonth > 12 || input.periodYear < 2000) {
    return { ok: false, alasan: 'PERIODE_TIDAK_VALID' };
  }

  try {
    return await runSerializable(async (tx) => {
      const toko = await tx.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, termsType: true },
      });
      if (!toko) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
      // Siklus konsinyasi hanya berarti untuk toko konsinyasi. Membukanya untuk
      // toko putus akan menghitung "stok titipan" atas barang yang sudah dijual.
      if (toko.termsType !== 'KONSI') {
        return { ok: false as const, alasan: 'TOKO_BUKAN_KONSI' as const };
      }

      const siklus = await tx.consignmentCycle.create({
        data: {
          noKonsi: await nomorKonsi(tx, input.periodYear, input.periodMonth),
          storeId: input.storeId,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
          spgDueDate: input.spgDueDate ?? null,
        },
        select: { id: true, noKonsi: true },
      });
      return { ok: true as const, id: siklus.id, noKonsi: siklus.noKonsi };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Kunci uniknya (toko, tahun, bulan): dua siklus untuk bulan yang sama
      // akan memecah angka terjual dan setiap total di bawahnya diam-diam separuh.
      return { ok: false, alasan: 'SIKLUS_SUDAH_ADA' };
    }
    throw err;
  }
}

/** Kirim barang titipan ke toko. */
export async function kirimTitipan(input: {
  storeId: string;
  cycleId?: string | null;
  shippedAt: Date;
  items: BarisKirim[];
  note?: string | null;
}): Promise<{ ok: true; id: string; noKirim: string } | Gagal> {
  const items = input.items.filter((b) => b.itemName.trim() && b.qty > 0);
  if (items.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };

  try {
    return await runSerializable(async (tx) => {
      const depan = `KKIRIM/${input.shippedAt.getFullYear()}/`;
      const terakhir = await tx.consignmentShipment.findFirst({
        where: { noKirim: { startsWith: depan } },
        orderBy: { noKirim: 'desc' },
        select: { noKirim: true },
      });
      const urutan = terakhir ? Number(terakhir.noKirim.slice(depan.length)) + 1 : 1;

      const kirim = await tx.consignmentShipment.create({
        data: {
          noKirim: `${depan}${String(urutan).padStart(4, '0')}`,
          storeId: input.storeId,
          cycleId: input.cycleId ?? null,
          shippedAt: input.shippedAt,
          note: input.note?.trim() || null,
          items: {
            create: items.map((b) => ({
              itemId: b.itemId ?? null,
              itemName: b.itemName.trim(),
              qty: b.qty,
              price: D(b.price),
              amount: D(b.qty * b.price),
            })),
          },
        },
        select: { id: true, noKirim: true },
      });
      return { ok: true as const, id: kirim.id, noKirim: kirim.noKirim };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

/**
 * Catat salah satu dari dua laporan.
 *
 * Boleh dicatat ulang selama angkanya belum dikunci: laporan yang salah ketik
 * harus bisa dibetulkan, dan sebelum dikunci tidak ada apa pun yang bergantung
 * padanya. Sesudah dikunci, tidak.
 */
export async function catatLaporan(input: {
  cycleId: string;
  source: 'SPG' | 'TOKO';
  reportedAt: Date;
  reportedById?: string | null;
  items: BarisLaporan[];
  note?: string | null;
}): Promise<{ ok: true } | Gagal> {
  const items = input.items.filter((b) => b.itemName.trim() && b.qty >= 0);
  if (items.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };

  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: { id: true, lockedAt: true },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (siklus.lockedAt) return { ok: false as const, alasan: 'SUDAH_DIKUNCI' as const };

    const lama = await tx.consignmentReport.findUnique({
      where: { cycleId_source: { cycleId: siklus.id, source: input.source } },
      select: { id: true },
    });
    if (lama) {
      await tx.consignmentReportItem.deleteMany({ where: { reportId: lama.id } });
      await tx.consignmentReport.update({
        where: { id: lama.id },
        data: {
          reportedAt: input.reportedAt,
          reportedById: input.reportedById ?? null,
          note: input.note?.trim() || null,
          items: {
            create: items.map((b) => ({
              itemId: b.itemId ?? null,
              itemName: b.itemName.trim(),
              qty: b.qty,
            })),
          },
        },
      });
      return { ok: true as const };
    }

    await tx.consignmentReport.create({
      data: {
        cycleId: siklus.id,
        source: input.source,
        reportedAt: input.reportedAt,
        reportedById: input.reportedById ?? null,
        note: input.note?.trim() || null,
        items: {
          create: items.map((b) => ({
            itemId: b.itemId ?? null,
            itemName: b.itemName.trim(),
            qty: b.qty,
          })),
        },
      },
    });
    return { ok: true as const };
  });
}

/**
 * Kunci angka resmi, dan hitung komisi SPG dari angka itu.
 *
 * Inilah titik tidak-bisa-kembali. Dari sini angka resminya yang menagih toko,
 * membayar komisi, dan mengurangi stok titipan — bukan salah satu laporan
 * mentahnya.
 *
 * Menuntut kedua laporan sudah masuk: mengunci dengan satu laporan berarti
 * mengunci angka yang belum pernah dibandingkan dengan apa pun.
 */
export async function kunciAngka(input: {
  cycleId: string;
  olehUserId: string;
  baris: BarisResmi[];
  gajiPokokPerSpg?: number;
}): Promise<{ ok: true; totalKomisi: number; jumlahSpg: number } | Gagal> {
  const baris = input.baris.filter((b) => b.itemName.trim() && b.qty >= 0);
  if (baris.length === 0) return { ok: false, alasan: 'TANPA_BARIS' };
  if (baris.some((b) => b.qty < 0 || b.price < 0)) {
    return { ok: false, alasan: 'NILAI_TIDAK_VALID' };
  }

  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: {
        id: true,
        storeId: true,
        lockedAt: true,
        reports: { select: { source: true } },
      },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (siklus.lockedAt) return { ok: false as const, alasan: 'SUDAH_DIKUNCI' as const };
    const sumber = new Set(siklus.reports.map((r) => r.source));
    if (!sumber.has('SPG') || !sumber.has('TOKO')) {
      return { ok: false as const, alasan: 'LAPORAN_BELUM_LENGKAP' as const };
    }

    // Tarif komisi diambil dari master barang saat mengunci, lalu DISALIN ke
    // baris resmi. Kalau tarifnya diubah bulan depan, komisi bulan ini tidak
    // ikut berubah — yang sudah dibayarkan harus tetap bisa dijelaskan.
    const idBarang = baris.map((b) => b.itemId).filter((x): x is string => Boolean(x));
    const tarif = new Map<string, number>();
    if (idBarang.length > 0) {
      const rows = await tx.item.findMany({
        where: { id: { in: idBarang } },
        select: { id: true, commissionPerPcs: true },
      });
      for (const r of rows) tarif.set(r.id, angka(r.commissionPerPcs));
    }

    await tx.consignmentSold.deleteMany({ where: { cycleId: siklus.id } });
    await tx.consignmentSold.createMany({
      data: baris.map((b) => ({
        cycleId: siklus.id,
        itemId: b.itemId ?? null,
        itemName: b.itemName.trim(),
        qty: b.qty,
        price: D(b.price),
        amount: D(b.qty * b.price),
        commissionPerPcs: D(b.itemId ? (tarif.get(b.itemId) ?? 0) : 0),
      })),
    });

    /*
     * SPG toko ini = pengguna yang toko tugasnya toko ini. `User` di Elorae
     * tidak punya penanda aktif, jadi tidak ada yang bisa disaring lebih jauh —
     * kalau seorang SPG berhenti, tugas tokonya harus dilepas, bukan dibiarkan
     * dan diharapkan disaring di sini.
     */
    const spg = await tx.user.findMany({
      where: { assignedStoreId: siklus.storeId },
      orderBy: { name: 'asc' },
      select: { id: true },
    });

    const { totalKomisi, perSpg } = bagiKomisi(
      baris.map((b) => ({
        qty: b.qty,
        commissionPerPcs: b.itemId ? (tarif.get(b.itemId) ?? 0) : 0,
      })),
      spg.length,
    );

    for (const [i, s] of spg.entries()) {
      const komisi = perSpg[i] ?? 0;
      const pokok = input.gajiPokokPerSpg ?? 0;
      await tx.consignmentCommission.upsert({
        where: { cycleId_spgUserId: { cycleId: siklus.id, spgUserId: s.id } },
        create: {
          cycleId: siklus.id,
          spgUserId: s.id,
          baseSalary: D(pokok),
          commission: D(komisi),
          total: D(pokok + komisi),
        },
        update: {
          baseSalary: D(pokok),
          commission: D(komisi),
          total: D(pokok + komisi),
        },
      });
    }

    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data: { lockedAt: new Date(), lockedById: input.olehUserId },
    });

    return { ok: true as const, totalKomisi, jumlahSpg: spg.length };
  });
}

/**
 * Buka kunci untuk membetulkan angka.
 *
 * DITOLAK kalau ada gaji yang sudah dibayar. Membuka kunci setelah itu berarti
 * komisi bisa dihitung ulang lebih kecil dari yang sudah masuk kantong orang —
 * dan tidak ada jalan menariknya kembali.
 */
export async function bukaKunci(input: { cycleId: string }): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: {
        id: true,
        lockedAt: true,
        commissions: { select: { paidAt: true } },
      },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (!siklus.lockedAt) return { ok: false as const, alasan: 'BELUM_DIKUNCI' as const };
    if (siklus.commissions.some((k) => k.paidAt !== null)) {
      return { ok: false as const, alasan: 'ADA_GAJI_SUDAH_DIBAYAR' as const };
    }

    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data: { lockedAt: null, lockedById: null },
    });
    return { ok: true as const };
  });
}

/** Tandai gaji + komisi satu SPG sudah dibayar. */
export async function bayarKomisi(input: {
  commissionId: string;
  olehUserId: string;
  catatan?: string | null;
}): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const k = await tx.consignmentCommission.findUnique({
      where: { id: input.commissionId },
      select: { id: true, paidAt: true },
    });
    if (!k) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (k.paidAt) return { ok: false as const, alasan: 'SUDAH_DIBAYAR' as const };

    await tx.consignmentCommission.update({
      where: { id: k.id },
      data: { paidAt: new Date(), paidById: input.olehUserId, note: input.catatan?.trim() || null },
    });
    return { ok: true as const };
  });
}

/**
 * Catat nomor nota (admin penjualan) atau nomor faktur pajak (admin pajak).
 *
 * Keduanya nomor MILIK ORANG LAIN — bukan yang kita hasilkan — dan boleh sama
 * sekali berbeda dari nomor konsi kita. Disimpan berdampingan justru supaya
 * admin pajak tidak lagi bertanya "nomor notanya yang mana".
 */
export async function catatNomorDokumen(input: {
  cycleId: string;
  jenis: 'NOTA' | 'PAJAK';
  nomor: string;
}): Promise<{ ok: true } | Gagal> {
  const nomor = input.nomor?.trim();
  if (!nomor) return { ok: false, alasan: 'NOMOR_WAJIB' };

  return runSerializable(async (tx) => {
    const siklus = await tx.consignmentCycle.findUnique({
      where: { id: input.cycleId },
      select: { id: true, lockedAt: true },
    });
    if (!siklus) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    // Nomor nota dan faktur pajak menyatakan nilai yang ditagihkan; sebelum
    // angkanya dikunci, nilai itu belum ada.
    if (!siklus.lockedAt) return { ok: false as const, alasan: 'BELUM_DIKUNCI' as const };

    await tx.consignmentCycle.update({
      where: { id: siklus.id },
      data:
        input.jenis === 'NOTA'
          ? { noNota: nomor, notaAt: new Date() }
          : { noFakturPajak: nomor, fakturPajakAt: new Date() },
    });
    return { ok: true as const };
  });
}
