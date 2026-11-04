import { prisma, type Prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { batasPotongSen, dariSen, desimal, JEJAK_HILANG, keSen } from "./hilang";
import { bacaAturanHilang, jejakHilang, lepasDeduksi, potongBagianOrang, potonganUntukRefSen, segarkanStatusHilang, sisaBebanOrangSen } from "./hilang-db";

/**
 * Potongan beban barang hilang dari gaji/komisi SPG (dan sales).
 *
 * Model yang dipakai pemanggil (komisi SPG putus, komisi/gaji konsinyasi):
 * potongan DIBEKUKAN saat komisinya DITETAPKAN/DIKUNCI, dengan dokumen
 * komisinya sebagai `refType`/`refId`. Kalau komisi ditetapkan ulang atau
 * kunci siklus dibuka, pemanggil memanggil `lepasPotonganHilang` dulu, lalu
 * `potongBebanHilang` lagi — angkanya sama selama bebannya tidak berubah.
 *
 * Semua fungsi yang menerima `tx` dipanggil DI DALAM transaksi serializable
 * pemanggilnya (`runSerializable`) dan tidak pernah membuka transaksi sendiri.
 */

type Tx = Prisma.TransactionClient;

/**
 * Potong beban barang hilang dari SATU pembayaran gaji/komisi orang ini — kini hanya jalur SALES
 * (`maksPotongPersen` berlaku untuk potongan beban SALES saja); SPG dipotong penuh lewat
 * `potongBebanHilangPenuh` (P11a).
 * Dipanggil DI DALAM transaksi pembayaran: mengambil bagian beban (SPG/SALES)
 * milik `userId` yang belum lunas, terlama dulu, sampai batas
 * `spg.barangHilang.maksPotongPersen` × `bruto`; menulis `StockLossDeduction`
 * per potongan dengan dokumen pembayarannya (`refType`/`refId`), menaikkan
 * `settledAmount`, dan menandai lunas bagian yang habis. Mengembalikan jumlah
 * yang dipotong (disimpan di kolom `deduction` pembayarannya).
 *
 * Idempoten per `refType`/`refId`: dokumen yang sudah punya potongan
 * mengembalikan jumlah itu tanpa memotong lagi.
 */
export async function potongBebanHilang(
  tx: Prisma.TransactionClient,
  input: { userId: string; bruto: number; refType: string; refId: string; createdById: string; note?: string | null },
): Promise<number> {
  const aturan = await bacaAturanHilang(tx);
  const batasSen = batasPotongSen(Number(input.bruto), aturan.maksPotongPersen);
  const sen = await potongBagianOrang(tx, {
    userId: input.userId,
    bearers: ["SPG", "SALES"],
    batasSen,
    refType: input.refType,
    refId: input.refId,
    createdById: input.createdById,
    note: input.note ?? null,
  });
  return dariSen(sen);
}

/**
 * Lepas semua potongan beban barang hilang yang tercatat untuk satu dokumen
 * komisi/gaji (`refType`/`refId`) — dipakai saat komisi ditetapkan ulang atau
 * kunci siklus dibuka. `settledAmount` dikembalikan, bagian yang belum lunas
 * lagi kehilangan `settledAt`, catatan SELESAI kembali DITETAPKAN; jejak
 * `STOCK_LOSS_DEDUCTION_RELEASED` per catatan. `userId` = yang melakukan
 * (pencatat jejak). Mengembalikan jumlah yang dilepas; idempoten (kedua kali 0).
 */
export async function lepasPotonganHilang(tx: Tx, input: { refType: string; refId: string; userId: string }): Promise<number> {
  return dariSen(await lepasDeduksi(tx, { refType: input.refType, refId: input.refId, userId: input.userId }));
}

/** Sisa beban barang hilang (bagian SPG/SALES) orang ini yang belum lunas — pratinjau sebelum menetapkan. */
export async function bebanTerbukaUntukPotong(klien: Tx | typeof prisma, userId: string): Promise<number> {
  return dariSen(await sisaBebanOrangSen(klien, userId));
}

export type BagianTerbukaOrang = {
  shareId: string;
  lossId: string;
  toko: string | null;
  /** Tanggal diputuskan, sudah diformat WIB. */
  tanggal: string;
  nilai: number;
  dipotong: number;
  sisa: number;
};

/**
 * Beban barang hilang orang ini yang belum lunas, untuk ditampilkan di layar
 * gaji/komisi kantor: total sisa, batas potong satu pembayaran (persen dari
 * pengaturan), dan rinciannya (terlama dulu — urutan potongnya).
 */
export async function bebanTerbukaOrang(userId: string): Promise<{ sisa: number; maksPotongPersen: number; bagian: BagianTerbukaOrang[] }> {
  if (!userId) return { sisa: 0, maksPotongPersen: 0, bagian: [] };
  const [aturan, rows] = await Promise.all([
    bacaAturanHilang(prisma),
    prisma.stockLossShare.findMany({
      where: { bearerUserId: userId, bearer: { in: ["SPG", "SALES"] }, settledAt: null, loss: { status: "DITETAPKAN" } },
      orderBy: [{ loss: { decidedAt: "asc" } }, { loss: { createdAt: "asc" } }, { id: "asc" }],
      select: { id: true, amount: true, settledAmount: true, loss: { select: { id: true, storeId: true, decidedAt: true, createdAt: true } } },
    }),
  ]);
  const tokoIds = [...new Set(rows.map((r) => r.loss.storeId).filter((x): x is string => Boolean(x)))];
  const toko = tokoIds.length ? await prisma.store.findMany({ where: { id: { in: tokoIds } }, select: { id: true, name: true } }) : [];
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));
  const bagian = rows.map((r) => {
    const nilaiSen = keSen(Number(r.amount));
    const dipotongSen = keSen(Number(r.settledAmount));
    return {
      shareId: r.id,
      lossId: r.loss.id,
      toko: r.loss.storeId ? (namaToko.get(r.loss.storeId) ?? null) : null,
      tanggal: formatDisplayDate(r.loss.decidedAt ?? r.loss.createdAt),
      nilai: dariSen(nilaiSen),
      dipotong: dariSen(dipotongSen),
      sisa: dariSen(Math.max(0, nilaiSen - dipotongSen)),
    };
  });
  return { sisa: dariSen(bagian.reduce((n, b) => n + keSen(b.sisa), 0)), maksPotongPersen: aturan.maksPotongPersen, bagian };
}

/**
 * Potongan beban barang hilang SPG yang SUDAH DIRENCANAKAN (P11a: dipotong seluruhnya, tanpa batas
 * persen) — persis per bagian yang direncanakan pembayarnya, di DALAM transaksi pembayaran (atau
 * pengalihan ke utang SPG, `refType` `SpgDebt`). Setiap potongan: satu `StockLossDeduction`,
 * `settledAmount` naik, bagian yang habis ditandai lunas, jejak `STOCK_LOSS_DEDUCTED` per catatan,
 * status catatan disegarkan. Hanya bagian bearer SPG milik `userId` yang belum lunas; potongan tidak
 * pernah melebihi sisanya. Idempoten per `refType`/`refId`: dokumen yang sudah punya potongan
 * mengembalikan jumlah itu tanpa memotong lagi. Mengembalikan jumlah yang dipotong (rupiah).
 */
export async function potongBebanHilangPenuh(
  tx: Tx,
  input: {
    userId: string;
    potong: ReadonlyArray<{ shareId: string; sen: number }>;
    refType: string;
    refId: string;
    createdById: string;
    note?: string | null;
    sekarang?: Date;
  },
): Promise<number> {
  if (!input.userId || !input.refType || !input.refId) return 0;
  const sudah = await potonganUntukRefSen(tx, input.refType, input.refId);
  if (sudah > 0) return dariSen(sudah);
  const sekarang = input.sekarang ?? new Date();
  const catatan = input.note?.trim() || null;
  const perLoss = new Map<string, { shareId: string; sebelum: number; sesudah: number; lunas: boolean }[]>();
  let total = 0;
  for (const p of input.potong) {
    if (!Number.isInteger(p.sen) || p.sen <= 0) continue;
    const s = await tx.stockLossShare.findFirst({
      where: { id: p.shareId, bearer: "SPG", bearerUserId: input.userId, settledAt: null, loss: { status: "DITETAPKAN" } },
      select: { id: true, lossId: true, amount: true, settledAmount: true },
    });
    if (!s) continue;
    const sebelumSen = keSen(Number(s.settledAmount));
    const potongSen = Math.min(p.sen, Math.max(0, keSen(Number(s.amount)) - sebelumSen));
    if (potongSen <= 0) continue;
    const sesudahSen = sebelumSen + potongSen;
    const lunas = sesudahSen >= keSen(Number(s.amount));
    await tx.stockLossDeduction.create({
      data: {
        shareId: s.id,
        amount: desimal(potongSen),
        refType: input.refType,
        refId: input.refId,
        note: catatan,
        createdById: input.createdById,
        createdAt: sekarang,
      },
    });
    await tx.stockLossShare.update({
      where: { id: s.id },
      data: {
        settledAmount: desimal(sesudahSen),
        ...(lunas ? { settledAt: sekarang, settledById: input.createdById, settleNote: catatan ?? `Dipotong (${input.refType})` } : {}),
      },
    });
    total += potongSen;
    const daftar = perLoss.get(s.lossId) ?? [];
    daftar.push({ shareId: s.id, sebelum: sebelumSen / 100, sesudah: sesudahSen / 100, lunas });
    perLoss.set(s.lossId, daftar);
  }
  for (const [lossId, bagian] of perLoss) {
    await jejakHilang(tx, {
      userId: input.createdById,
      action: JEJAK_HILANG.DIPOTONG,
      lossId,
      changes: {
        before: { bagian: bagian.map((b) => ({ shareId: b.shareId, settledAmount: b.sebelum })) },
        after: { bagian: bagian.map((b) => ({ shareId: b.shareId, settledAmount: b.sesudah, lunas: b.lunas })) },
      },
      metadata: { refType: input.refType, refId: input.refId, bearerUserId: input.userId, penuh: true },
      reason: catatan,
    });
  }
  await segarkanStatusHilang(tx, [...perLoss.keys()]);
  return dariSen(total);
}
