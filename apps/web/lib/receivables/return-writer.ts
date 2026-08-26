import { Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { denganNomorUnik } from './nomor';
import { generateDocNumber } from '@/lib/docNumber';
import { hitungUlangPiutang } from './writer';
import { catatJejak, JEJAK } from './jejak';

/**
 * Penulis retur toko — dua dokumen, dua tangan.
 *
 * NRT adalah klaim toko: "kami kembalikan barang senilai sekian". Nomornya
 * **nomor toko**, bukan nomor kita — itulah yang dicari pemilik di arsip.
 * NRI adalah hitungan gudang: "yang sampai senilai sekian". Nomornya milik kita.
 *
 * Keduanya tabel terpisah karena keduanya bisa hidup sendiri: barang bisa datang
 * lewat ekspedisi mendahului notanya, dan penerimaan itu harus bisa dicatat
 * sebelum ada yang tahu ia milik nota yang mana.
 *
 * Aturannya: **retur diakui sebesar fisik, bukan sebesar klaim.** Selama gudang
 * belum menutup hitungan, seluruh klaim ditahan; setelah ditutup, yang ditahan
 * tinggal selisihnya sampai ada yang ditetapkan menanggungnya.
 *
 * Tidak ada satu pun jalur di sini yang menulis `outstanding` sendiri. Setiap
 * perubahan memicu perhitungan ulang piutang yang tersentuh.
 */

type Klien = Prisma.TransactionClient;

const angka = (v: unknown): number => Number(v ?? 0);
const D = (n: number) => new Prisma.Decimal(n);

export type BarisBarang = {
  itemId?: string | null;
  itemName: string;
  qty: number;
  price: number;
};

export type AlasanGagalRetur =
  | 'TIDAK_DITEMUKAN'
  | 'NILAI_TIDAK_VALID'
  | 'NOMOR_WAJIB'
  | 'NOMOR_SUDAH_DIPAKAI'
  | 'SUDAH_DIBATALKAN'
  | 'SUDAH_DIHITUNG'
  | 'SUDAH_DIJODOHKAN'
  | 'BUKAN_YATIM'
  | 'BEDA_TOKO'
  | 'TIDAK_ADA_SELISIH'
  | 'SUDAH_DIPUTUSKAN'
  | 'BEBAN_SUDAH_DIPUTUSKAN'
  | 'BELUM_DIPUTUSKAN'
  | 'SUDAH_LUNAS'
  | 'ALASAN_WAJIB'
  | 'NOMOR_BENTROK';

type Gagal = { ok: false; alasan: AlasanGagalRetur };
type Berhasil = { ok: true; piutangDihitungUlang: number };

/** Nomor NRI berikutnya: `NRI/26/08/0001`, direset tiap bulan. */
async function nomorNri(tx: Klien, saat: Date): Promise<string> {
  const yy = String(saat.getFullYear()).slice(-2);
  const mm = String(saat.getMonth() + 1).padStart(2, '0');
  const depan = `NRI/${yy}/${mm}/`;
  const terakhir = await tx.warehouseReturn.findFirst({
    where: { noNri: { startsWith: depan } },
    orderBy: { noNri: 'desc' },
    select: { noNri: true },
  });
  const urutan = terakhir ? Number(terakhir.noNri.slice(depan.length)) + 1 : 1;
  return `${depan}${String(urutan).padStart(4, '0')}`;
}

/**
 * Hitung ulang setiap piutang yang tersentuh sebuah nota retur toko.
 *
 * Jalurnya panjang dan itu memang bentuk datanya: NRT → potongan yang
 * menunjuknya → klaim pembayaran → piutang yang dilunasi klaim itu.
 */
async function hitungUlangTersentuh(tx: Klien, storeReturnId: string | null): Promise<number> {
  if (!storeReturnId) return 0;
  const potongan = await tx.paymentClaimDeduction.findMany({
    where: { storeReturnId },
    select: { paymentClaimId: true },
  });
  if (potongan.length === 0) return 0;

  const links = await tx.paymentClaimReceivable.findMany({
    where: { paymentClaimId: { in: [...new Set(potongan.map((p) => p.paymentClaimId))] } },
    select: { receivableId: true },
  });
  const ids = [...new Set(links.map((l) => l.receivableId))];
  for (const id of ids) await hitungUlangPiutang(tx, id);
  return ids.length;
}

/**
 * Masukkan barang retur ke stok.
 *
 * NRI **MENAMBAH** stok, tidak mengurangi — barangnya kembali ke gudang. Ini
 * pernah salah arah dan dikoreksi pemilik, jadi tandanya sengaja ditulis
 * eksplisit di sini dan di jenis penyesuaiannya (`POSITIVE`).
 *
 * Hanya baris yang menunjuk barang katalog (`itemId`) yang menggerakkan stok.
 * Baris yang cuma diketik namanya tidak punya tempat di buku stok — dan
 * memaksanya masuk akan menciptakan barang hantu tiap kali ada salah ketik.
 *
 * Harga rata-ratanya TIDAK digeser: barang kembali dicatat sebesar biaya
 * bukunya sendiri. Retur bukan pembelian, jadi ia tidak membawa harga baru
 * yang boleh mengubah rata-rata.
 */
async function masukkanKeStok(
  tx: Klien,
  input: {
    items: { itemId?: string | null; itemName: string; qty: number }[];
    noNri: string;
    olehUserId: string;
  },
): Promise<number> {
  let jumlahBarisStok = 0;

  for (const b of input.items) {
    if (!b.itemId || !(b.qty > 0)) continue;

    // Baris tanpa varian memakai `variantSku: null` di sebagian data dan `""`
    // di sebagian lain. Pencarian yang toleran mencegah baris hantu kedua.
    const stok = await tx.inventoryValue.findFirst({
      where: { itemId: b.itemId, OR: [{ variantSku: null }, { variantSku: '' }] },
      select: { id: true, qtyOnHand: true, avgCost: true },
    });

    const qtyLama = stok ? Number(stok.qtyOnHand) : 0;
    const hargaRata = stok ? Number(stok.avgCost) : 0;
    const qtyBaru = qtyLama + b.qty;

    if (stok) {
      await tx.inventoryValue.update({
        where: { id: stok.id },
        data: {
          qtyOnHand: qtyBaru,
          totalValue: qtyBaru * hargaRata,
          lastUpdated: new Date(),
        },
      });
    } else {
      await tx.inventoryValue.create({
        data: {
          itemId: b.itemId,
          variantSku: '',
          qtyOnHand: qtyBaru,
          reservedQty: 0,
          avgCost: hargaRata,
          totalValue: qtyBaru * hargaRata,
        },
      });
    }

    await tx.stockAdjustment.create({
      data: {
        docNumber: await generateDocNumber('ADJ', tx),
        itemId: b.itemId,
        type: 'POSITIVE',
        qtyChange: b.qty,
        reason: `Retur toko ${input.noNri} — ${b.itemName}`,
        prevQty: qtyLama,
        newQty: qtyBaru,
        prevAvgCost: hargaRata,
        newAvgCost: hargaRata,
        createdById: input.olehUserId,
        source: 'STORE_RETURN_RECEIVE',
      },
    });
    jumlahBarisStok += 1;
  }

  return jumlahBarisStok;
}

/**
 * Selaraskan keadaan NRT dengan hitungan gudang, dan buka beban kalau kurang.
 *
 * Beban dibuat dengan status `TERBUKA` — tercatat ada selisihnya, tapi belum ada
 * yang menanggung. Itu keadaan yang menahan faktur, dan yang membuatnya muncul
 * di daftar kerja sebagai giliran admin keuangan.
 */
async function selaraskanSetelahHitung(tx: Klien, storeReturnId: string): Promise<void> {
  const nrt = await tx.storeReturn.findUnique({
    where: { id: storeReturnId },
    select: {
      id: true,
      storeId: true,
      claimedAmount: true,
      status: true,
      warehouseReturn: { select: { id: true, physicalAmount: true, status: true } },
      charges: { select: { id: true, status: true } },
    },
  });
  if (!nrt || nrt.status === 'BATAL') return;

  const nri = nrt.warehouseReturn;
  if (!nri || nri.status !== 'FINAL') {
    await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: 'MENUNGGU' } });
    return;
  }

  const selisih = angka(nrt.claimedAmount) - angka(nri.physicalAmount);
  if (selisih <= 0) {
    // Gudang menerima sama banyak atau lebih. Tidak ada yang perlu dibebankan,
    // dan beban terbuka yang tersisa dari pasangan sebelumnya dihapus.
    await tx.returnCharge.deleteMany({ where: { storeReturnId: nrt.id, status: 'TERBUKA' } });
    await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: 'COCOK' } });
    return;
  }

  const terbuka = nrt.charges.find((c) => c.status === 'TERBUKA');
  if (terbuka) {
    await tx.returnCharge.update({
      where: { id: terbuka.id },
      data: { amount: D(selisih), warehouseReturnId: nri.id, storeId: nrt.storeId },
    });
  } else if (!nrt.charges.some((c) => c.status !== 'TERBUKA')) {
    await tx.returnCharge.create({
      data: {
        storeReturnId: nrt.id,
        warehouseReturnId: nri.id,
        storeId: nrt.storeId,
        amount: D(selisih),
        status: 'TERBUKA',
      },
    });
  }
  await tx.storeReturn.update({ where: { id: nrt.id }, data: { status: 'SELISIH' } });
}

/**
 * Catat klaim retur dari toko (NRT).
 *
 * Nomornya diketik, bukan dihasilkan: ia nomor milik toko. Unik per toko, bukan
 * global — dua toko boleh memakai nomor yang sama, dan memaksa unik global akan
 * menolak nota yang sah.
 */
export async function catatReturToko(input: {
  noNrt: string;
  storeId: string;
  /** Yang mencatat. Wajib — sebuah nota tanpa pencatat tak bisa ditanyakan. */
  olehUserId: string;
  salesmanId?: string | null;
  claimDate: Date;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  claimedAmount?: number;
  items?: BarisBarang[];
  photoUrl?: string | null;
  note?: string | null;
}): Promise<{ ok: true; id: string; noNrt: string } | Gagal> {
  const nomor = input.noNrt?.trim();
  if (!nomor) return { ok: false, alasan: 'NOMOR_WAJIB' };

  const items = (input.items ?? []).filter((b) => b.itemName.trim() && b.qty > 0);
  // Kalau rinciannya ada, totalnya DIHITUNG dari rincian — bukan diketik di
  // samping rincian yang tidak menjumlah ke sana.
  const total = items.length > 0
    ? items.reduce((s, b) => s + b.qty * b.price, 0)
    : (input.claimedAmount ?? 0);
  if (!(total > 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  try {
    return await denganNomorUnik(() =>
      runSerializable(async (tx) => {
        const nota = await tx.storeReturn.create({
          data: {
            noNrt: nomor,
            storeId: input.storeId,
            salesmanId: input.salesmanId ?? null,
            claimDate: input.claimDate,
            deliveryMethod: input.deliveryMethod,
            claimedAmount: D(total),
            photoUrl: input.photoUrl?.trim() || null,
            note: input.note?.trim() || null,
            status: 'MENUNGGU',
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
          select: { id: true, noNrt: true },
        });

        await catatJejak(tx, {
          userId: input.olehUserId,
          action: JEJAK.RETUR_DICATAT,
          entityType: 'StoreReturn',
          entityId: nota.id,
          changes: { after: { noNrt: nota.noNrt, claimedAmount: total, storeId: input.storeId } },
          metadata: { deliveryMethod: input.deliveryMethod, jumlahBaris: items.length },
        });

        return { ok: true as const, id: nota.id, noNrt: nota.noNrt };
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_SUDAH_DIPAKAI' };
    }
    throw err;
  }
}

/**
 * Catat hitungan fisik gudang (NRI).
 *
 * `storeReturnId` boleh kosong: barang datang lewat ekspedisi mendahului
 * notanya, dan penerimaan itu harus bisa dicatat sebelum ada yang tahu ia milik
 * nota yang mana. Yang begitu masuk daftar kerja sebagai "belum dijodohkan".
 *
 * Dicatat langsung `FINAL`. Keadaan `DRAFT` ada di skema untuk hitungan yang
 * disimpan setengah jalan, tapi belum ada layarnya — dan pembacanya sudah
 * memperlakukan DRAFT sebagai belum dihitung, jadi arah amannya sudah benar.
 */
export async function catatHitunganGudang(input: {
  storeReturnId?: string | null;
  storeId?: string | null;
  warehouseUserId: string;
  receivedAt: Date;
  deliveryMethod: 'SALES' | 'TOKO' | 'EKSPEDISI';
  physicalAmount?: number;
  items?: BarisBarang[];
  note?: string | null;
}): Promise<
  | { ok: true; id: string; noNri: string; barisStok: number; piutangDihitungUlang: number }
  | Gagal
> {
  const items = (input.items ?? []).filter((b) => b.itemName.trim() && b.qty >= 0);
  // Nol sah — artinya tidak ada barang yang sampai. Itu berbeda dari belum
  // dihitung, dan menolaknya akan memaksa gudang berbohong.
  const total = items.length > 0
    ? items.reduce((s, b) => s + b.qty * b.price, 0)
    : (input.physicalAmount ?? 0);
  if (!(total >= 0)) return { ok: false, alasan: 'NILAI_TIDAK_VALID' };

  try {
    return await denganNomorUnik(() =>
      runSerializable(async (tx) => {
        let storeId = input.storeId ?? null;
        let klaim = 0;
        let qtyKlaimPerBarang = new Map<string, number>();

        if (input.storeReturnId) {
          const nrt = await tx.storeReturn.findUnique({
            where: { id: input.storeReturnId },
            select: {
              id: true,
              storeId: true,
              status: true,
              claimedAmount: true,
              warehouseReturn: { select: { id: true } },
              items: { select: { itemName: true, qty: true } },
            },
          });
          if (!nrt) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
          if (nrt.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
          // Menimpa hitungan berarti mengubah angka yang mungkin sudah dipakai
          // memutuskan siapa menanggung selisihnya. Yang salah dilepas dulu.
          if (nrt.warehouseReturn) return { ok: false as const, alasan: 'SUDAH_DIHITUNG' as const };
          storeId = nrt.storeId;
          klaim = angka(nrt.claimedAmount);
          qtyKlaimPerBarang = new Map(nrt.items.map((i) => [i.itemName, i.qty]));
        }

        const nri = await tx.warehouseReturn.create({
          data: {
            noNri: await nomorNri(tx, input.receivedAt),
            storeId,
            storeReturnId: input.storeReturnId ?? null,
            warehouseUserId: input.warehouseUserId,
            receivedAt: input.receivedAt,
            deliveryMethod: input.deliveryMethod,
            physicalAmount: D(total),
            claimedAmount: D(klaim),
            note: input.note?.trim() || null,
            status: 'FINAL',
            finalisedAt: new Date(),
            items: {
              create: items.map((b) => ({
                itemId: b.itemId ?? null,
                itemName: b.itemName.trim(),
                // Qty klaim disalin dari NRT per nama barang supaya selisihnya
                // terbaca per baris, bukan cuma sebagai total.
                qtyClaim: qtyKlaimPerBarang.get(b.itemName.trim()) ?? 0,
                qty: b.qty,
                price: D(b.price),
                amount: D(b.qty * b.price),
              })),
            },
          },
          select: { id: true, noNri: true },
        });

        const barisStok = await masukkanKeStok(tx, {
          items,
          noNri: nri.noNri,
          olehUserId: input.warehouseUserId,
        });

        await catatJejak(tx, {
          userId: input.warehouseUserId,
          action: JEJAK.RETUR_DIHITUNG,
          entityType: 'WarehouseReturn',
          entityId: nri.id,
          // Hitungan ini hanya bisa dicatat sekali dan menentukan berapa yang
          // ditahan dari piutang. Angkanya harus bisa ditelusuri ke orangnya.
          changes: { after: { noNri: nri.noNri, physicalAmount: total, claimedAmount: klaim } },
          metadata: { storeReturnId: input.storeReturnId ?? null, barisStok },
        });

        if (input.storeReturnId) await selaraskanSetelahHitung(tx, input.storeReturnId);

        return {
          ok: true as const,
          id: nri.id,
          noNri: nri.noNri,
          barisStok,
          piutangDihitungUlang: await hitungUlangTersentuh(tx, input.storeReturnId ?? null),
        };
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { ok: false, alasan: 'NOMOR_BENTROK' };
    }
    throw err;
  }
}

/** Jodohkan penerimaan gudang yatim dengan nota toko yang baru ditemukan. */
export async function jodohkanRetur(input: {
  warehouseReturnId: string;
  storeReturnId: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  return runSerializable(async (tx) => {
    const nri = await tx.warehouseReturn.findUnique({
      where: { id: input.warehouseReturnId },
      select: { id: true, storeReturnId: true, storeId: true, physicalAmount: true },
    });
    if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nri.storeReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };

    const nrt = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: {
        id: true,
        storeId: true,
        status: true,
        claimedAmount: true,
        warehouseReturn: { select: { id: true } },
      },
    });
    if (!nrt) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nrt.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };
    if (nrt.warehouseReturn) return { ok: false as const, alasan: 'SUDAH_DIHITUNG' as const };
    // Penerimaan yang sudah tahu tokonya tidak boleh dijodohkan ke toko lain —
    // itu memindahkan barang satu toko ke tagihan toko lain.
    if (nri.storeId && nri.storeId !== nrt.storeId) {
      return { ok: false as const, alasan: 'BEDA_TOKO' as const };
    }

    await tx.warehouseReturn.update({
      where: { id: nri.id },
      data: {
        storeReturnId: nrt.id,
        storeId: nrt.storeId,
        claimedAmount: nrt.claimedAmount,
      },
    });
    await selaraskanSetelahHitung(tx, nrt.id);

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DIJODOHKAN,
      entityType: 'WarehouseReturn',
      entityId: nri.id,
      changes: { before: { storeReturnId: null }, after: { storeReturnId: nrt.id } },
      metadata: { storeId: nrt.storeId },
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nrt.id) };
  });
}

/**
 * Lepas pasangan NRT–NRI.
 *
 * Ditolak kalau bebannya sudah diputuskan: seseorang sudah ditetapkan
 * menanggung selisih pasangan ini, dan melepasnya meninggalkan beban yang
 * menunjuk perbandingan yang tidak ada lagi.
 */
export async function lepasPasangan(input: {
  warehouseReturnId: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  return runSerializable(async (tx) => {
    const nri = await tx.warehouseReturn.findUnique({
      where: { id: input.warehouseReturnId },
      select: { id: true, storeReturnId: true },
    });
    if (!nri) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (!nri.storeReturnId) return { ok: false as const, alasan: 'BUKAN_YATIM' as const };

    const diputuskan = await tx.returnCharge.count({
      where: { storeReturnId: nri.storeReturnId, status: { not: 'TERBUKA' } },
    });
    if (diputuskan > 0) return { ok: false as const, alasan: 'BEBAN_SUDAH_DIPUTUSKAN' as const };

    const storeReturnId = nri.storeReturnId;
    await tx.returnCharge.deleteMany({ where: { storeReturnId, status: 'TERBUKA' } });
    await tx.warehouseReturn.update({
      where: { id: nri.id },
      data: { storeReturnId: null, claimedAmount: D(0) },
    });
    await tx.storeReturn.update({ where: { id: storeReturnId }, data: { status: 'MENUNGGU' } });

    // Pembalikan. Tanpa jejak, sebuah pasangan bisa dilepas dan dijodohkan ulang
    // ke nota lain tanpa ada yang bisa menunjukkan bahwa itu pernah terjadi.
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DILEPAS,
      entityType: 'WarehouseReturn',
      entityId: nri.id,
      changes: { before: { storeReturnId }, after: { storeReturnId: null } },
    });

    return {
      ok: true as const,
      piutangDihitungUlang: await hitungUlangTersentuh(tx, storeReturnId),
    };
  });
}

/**
 * Tetapkan siapa menanggung selisih. Inilah yang melepas faktur.
 *
 * Sebelum ada yang menanggung, selisihnya menggantung di piutang dan tidak ada
 * seorang pun yang bertanggung jawab — keadaan yang bisa bertahan berbulan-bulan
 * justru karena tidak ada yang merasa ditagih.
 */
export async function putuskanBeban(input: {
  chargeId: string;
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';
  bearerUserId?: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: { id: true, status: true, amount: true, storeReturnId: true, bearer: true },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status !== 'TERBUKA') return { ok: false as const, alasan: 'SUDAH_DIPUTUSKAN' as const };
    if (!(angka(beban.amount) > 0)) return { ok: false as const, alasan: 'TIDAK_ADA_SELISIH' as const };

    await tx.returnCharge.update({
      where: { id: beban.id },
      data: {
        bearer: input.bearer,
        // Beban ke sales melekat pada orang, bukan pada peran — itulah yang
        // membuatnya bisa dipotong dari komisinya nanti.
        bearerUserId: input.bearer === 'SALES' ? input.bearerUserId ?? null : null,
        status: 'DITETAPKAN',
        note: input.alasan.trim(),
        decidedById: input.olehUserId,
        decidedAt: new Date(),
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_DIPUTUSKAN,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      // Keputusan ini menetapkan siapa menanggung kerugian. Alasannya wajib di
      // penulis; di sini ia ikut tersimpan bersama nilainya.
      changes: {
        before: { status: beban.status, bearer: beban.bearer },
        after: { status: 'DITETAPKAN', bearer: input.bearer },
      },
      metadata: { amount: angka(beban.amount), bearerUserId: input.bearerUserId ?? null },
      reason: input.alasan,
    });

    return {
      ok: true as const,
      piutangDihitungUlang: await hitungUlangTersentuh(tx, beban.storeReturnId),
    };
  });
}

/**
 * Tandai beban sudah diganti.
 *
 * Tidak mengubah piutang sedikit pun — faktur sudah dilepas saat bebannya
 * ditetapkan. Ini penagihan pengganti yang berjalan sendiri, dan tanpa keadaan
 * ini tidak ada tempat mencatat bahwa sales sudah membayar balik.
 */
export async function tandaiBebanLunas(input: {
  chargeId: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: { id: true, status: true },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status === 'TERBUKA') return { ok: false as const, alasan: 'BELUM_DIPUTUSKAN' as const };
    if (beban.status === 'LUNAS') return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };

    await tx.returnCharge.update({
      where: { id: beban.id },
      data: { status: 'LUNAS', settledAt: new Date() },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_LUNAS,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      changes: { before: { status: beban.status }, after: { status: 'LUNAS' } },
    });

    return { ok: true as const };
  });
}

/**
 * Batalkan nota retur toko.
 *
 * Potongan yang menunjuk nota ini TIDAK ikut terhapus — kalau toko sudah
 * memotong pembayarannya, uang itu tetap kurang dan tetap harus ditagih.
 * Pembacanya memperlakukan nota batal sebagai fisik nol, jadi potongannya
 * ditahan penuh dan muncul di layar piutang sampai ada yang membetulkannya.
 */
export async function batalkanRetur(input: {
  storeReturnId: string;
  alasan: string;
  olehUserId: string;
}): Promise<Berhasil | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const nota = await tx.storeReturn.findUnique({
      where: { id: input.storeReturnId },
      select: { id: true, noNrt: true, status: true, note: true },
    });
    if (!nota) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (nota.status === 'BATAL') return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };

    const diputuskan = await tx.returnCharge.count({
      where: { storeReturnId: nota.id, status: { not: 'TERBUKA' } },
    });
    if (diputuskan > 0) return { ok: false as const, alasan: 'BEBAN_SUDAH_DIPUTUSKAN' as const };

    await tx.returnCharge.deleteMany({ where: { storeReturnId: nota.id, status: 'TERBUKA' } });
    await tx.storeReturn.update({
      where: { id: nota.id },
      data: { status: 'BATAL', note: [nota.note, input.alasan.trim()].filter(Boolean).join('\n') },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.RETUR_DIBATALKAN,
      entityType: 'StoreReturn',
      entityId: nota.id,
      // Membatalkan TIDAK menghapus potongan yang menunjuknya — ia berubah jadi
      // tertahan penuh. Alasannya harus tercatat, karena angka piutang naik.
      changes: { before: { status: nota.status }, after: { status: 'BATAL' } },
      metadata: { noNrt: nota.noNrt },
      reason: input.alasan,
    });

    return { ok: true as const, piutangDihitungUlang: await hitungUlangTersentuh(tx, nota.id) };
  });
}

/**
 * Alihkan beban yang sudah diputuskan ke orang lain — atau lengkapi orangnya.
 *
 * Ada karena beban ke SALES pernah tersimpan tanpa orangnya sama sekali:
 * tuduhan tanpa alamat, yang tidak akan pernah muncul di layar siapa pun. Baris
 * semacam itu tidak bisa dibetulkan lewat jalur mana pun sebelum ini.
 *
 * Beban yang SUDAH LUNAS tidak boleh dialihkan: uangnya sudah diganti orang
 * yang tercatat, dan memindahkannya membuat catatan pembayaran itu berbohong.
 */
export async function alihkanBeban(input: {
  chargeId: string;
  bearer: 'TOKO' | 'SALES' | 'GUDANG' | 'PERUSAHAAN';
  bearerUserId?: string | null;
  alasan: string;
  olehUserId: string;
}): Promise<{ ok: true } | Gagal> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const beban = await tx.returnCharge.findUnique({
      where: { id: input.chargeId },
      select: { id: true, status: true, bearer: true, bearerUserId: true, note: true },
    });
    if (!beban) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (beban.status === 'TERBUKA') return { ok: false as const, alasan: 'BELUM_DIPUTUSKAN' as const };
    if (beban.status === 'LUNAS') return { ok: false as const, alasan: 'SUDAH_LUNAS' as const };

    await tx.returnCharge.update({
      where: { id: beban.id },
      data: {
        bearer: input.bearer,
        bearerUserId: input.bearer === 'SALES' ? (input.bearerUserId ?? null) : null,
        note: input.alasan.trim(),
        decidedById: input.olehUserId,
        decidedAt: new Date(),
      },
    });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BEBAN_DIALIHKAN,
      entityType: 'ReturnCharge',
      entityId: beban.id,
      changes: {
        before: { bearer: beban.bearer, bearerUserId: beban.bearerUserId },
        after: { bearer: input.bearer, bearerUserId: input.bearerUserId ?? null },
      },
      reason: input.alasan,
    });

    return { ok: true as const };
  });
}
