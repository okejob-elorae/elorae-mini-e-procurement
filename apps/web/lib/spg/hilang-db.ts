import { prisma, type Prisma } from "@elorae/db";
import { bacaBarangHilang, KUNCI_BARANG_HILANG, type AturanBarangHilang, type DasarNilaiHilang } from "./pengaturan";
import {
  alokasiPotong,
  desimal,
  ENTITAS_HILANG,
  hargaBersihKirim,
  hargaTerimaKonsi,
  JEJAK_HILANG,
  keSen,
  nilaiSatuanSen,
  pilihHargaTerima,
  statusSesudahLunas,
  type BarisKurang,
  type KandidatHargaTerima,
  type Penanggung,
} from "./hilang";

/**
 * Bantuan basis data bersama untuk barang hilang — dipakai penulis keputusan,
 * kait sumber, kait tagihan siklus, dan kait potongan gaji/komisi.
 *
 * Semua fungsi yang menerima `tx` dipanggil DI DALAM transaksi pemanggilnya
 * dan tidak membuka transaksi sendiri. Yang menyentuh pelunasan bagian (potong,
 * lepas) WAJIB dipanggil di dalam `runSerializable`: Prisma `updateMany` bukan
 * bandingkan-lalu-tukar, jadi dua pembayaran bersamaan hanya bisa dicegah
 * memotong bagian yang sama dua kali oleh isolasi serializable.
 */

type Tx = Prisma.TransactionClient;
type Klien = Tx | typeof prisma;

const angka = (v: unknown): number => Number(v ?? 0);

export async function bacaAturanHilang(klien: Klien): Promise<AturanBarangHilang> {
  const s = await klien.systemSetting.findUnique({ where: { key: KUNCI_BARANG_HILANG }, select: { value: true } });
  return bacaBarangHilang(s?.value);
}

/** Satu baris jejak barang hilang, di transaksi yang sama dengan perubahannya. */
export async function jejakHilang(
  tx: Tx,
  isi: {
    userId: string;
    action: (typeof JEJAK_HILANG)[keyof typeof JEJAK_HILANG];
    lossId: string;
    changes?: { before?: unknown; after?: unknown };
    metadata?: Record<string, unknown>;
    reason?: string | null;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: ENTITAS_HILANG,
      entityId: isi.lossId,
      changes: (isi.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (isi.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: isi.reason?.trim() || null,
    },
  });
}

/**
 * `sumberHarga` hanya untuk dasar HARGA_TERIMA: `KIRIMAN` = harga dari kiriman
 * terakhir ke toko itu, `HARGA_ELORAE` = cadangan karena toko belum pernah
 * menerimanya (atau catatan tanpa toko). Null untuk dasar lain dan untuk baris
 * tanpa barang katalog.
 */
export type BarisDinilai = BarisKurang & { unitSen: number; amountSen: number; sumberHarga: "KIRIMAN" | "HARGA_ELORAE" | null };

export type TokoPenilai = { id: string; termsType: "PUTUS" | "KONSI"; markupPercent: unknown; priceDiscountPercent: unknown };

/**
 * Harga saat toko ini terakhir menerima setiap barang (`KandidatHargaTerima`):
 * - Toko PUTUS: baris nota kiriman (`FieldSalesDeliveryLine`) pesanan toko
 *   itu, harga bersih dari potongan baris; baris bonus dan tanpa harga dilewati.
 * - Toko KONSI: baris kiriman konsinyasi (`ConsignmentShipmentItem`, tanpa
 *   varian) dan baris pesanan konsi salesman yang sudah disetujui
 *   (`FieldSalesOrderLine`, per varian) ke toko itu yang berharga. Keduanya
 *   membawa harga jual DI TOKO, jadi diubah ke yang Elorae terima dengan
 *   markup toko sekarang (`hargaTerimaKonsi`): 120.000 markup 20% → 100.000.
 * Terbaru dulu, id sebagai penentu urutan berwaktu sama.
 */
async function kandidatHargaTerima(tx: Tx, toko: TokoPenilai, itemIds: string[]): Promise<KandidatHargaTerima[]> {
  if (itemIds.length === 0) return [];
  if (toko.termsType === "PUTUS") {
    const rows = await tx.fieldSalesDeliveryLine.findMany({
      where: { itemId: { in: itemIds }, unitPrice: { not: null }, orderLine: { isBonus: false }, delivery: { order: { storeId: toko.id } } },
      orderBy: [{ delivery: { deliveredAt: "desc" } }, { id: "desc" }],
      select: { itemId: true, variantSku: true, qty: true, unitPrice: true, discountAmount: true, delivery: { select: { deliveredAt: true } } },
    });
    return rows.flatMap((r) => {
      const harga = hargaBersihKirim(r.unitPrice === null ? null : angka(r.unitPrice), angka(r.discountAmount), r.qty);
      return harga === null ? [] : [{ itemId: r.itemId, variantSku: r.variantSku, harga, pada: r.delivery.deliveredAt }];
    });
  }
  const markup = toko.markupPercent === null || toko.markupPercent === undefined ? null : angka(toko.markupPercent);
  const [kiriman, pesanan] = await Promise.all([
    tx.consignmentShipmentItem.findMany({
      where: { itemId: { in: itemIds }, price: { gt: 0 }, shipment: { storeId: toko.id } },
      orderBy: [{ shipment: { shippedAt: "desc" } }, { id: "desc" }],
      select: { itemId: true, price: true, shipment: { select: { shippedAt: true } } },
    }),
    tx.fieldSalesOrderLine.findMany({
      where: {
        itemId: { in: itemIds },
        unitPrice: { gt: 0 },
        isBonus: false,
        order: { storeId: toko.id, orderType: "KONSI", status: "APPROVED" },
      },
      orderBy: [{ order: { approvedAt: "desc" } }, { id: "desc" }],
      select: { itemId: true, variantSku: true, unitPrice: true, order: { select: { approvedAt: true, createdAt: true } } },
    }),
  ]);
  return [
    ...kiriman.flatMap((r) => {
      const harga = hargaTerimaKonsi(angka(r.price), markup);
      return r.itemId && harga !== null ? [{ itemId: r.itemId, variantSku: null, harga, pada: r.shipment.shippedAt }] : [];
    }),
    ...pesanan.flatMap((r) => {
      const harga = hargaTerimaKonsi(angka(r.unitPrice), markup);
      return harga === null ? [] : [{ itemId: r.itemId, variantSku: r.variantSku, harga, pada: r.order.approvedAt ?? r.order.createdAt }];
    }),
  ];
}

/**
 * Nilai per potong setiap baris menurut dasar di pengaturan, dibekukan saat
 * catatan dibuka. Baris tanpa barang katalog (kiriman konsinyasi yang hanya
 * diketik namanya) bernilai nol — layar menandainya supaya kantor mengisi total.
 *
 * HPP dibaca toleran: baris persediaan per varian dulu, lalu baris gabungan
 * barang itu (`variantSku` null atau "").
 */
export async function nilaiBarisHilang(
  tx: Tx,
  baris: BarisKurang[],
  toko: TokoPenilai | null,
  dasar: DasarNilaiHilang,
): Promise<BarisDinilai[]> {
  const itemIds = [...new Set(baris.map((b) => b.itemId).filter((x): x is string => Boolean(x)))];
  const items = itemIds.length
    ? await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sellingPrice: true } })
    : [];
  const harga = new Map(items.map((i) => [i.id, i.sellingPrice === null ? null : angka(i.sellingPrice)]));
  const persediaan =
    dasar === "HPP" && itemIds.length
      ? await tx.inventoryValue.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true, avgCost: true } })
      : [];
  const hpp = (itemId: string, sku: string): number | null => {
    const milik = persediaan.filter((p) => p.itemId === itemId);
    const persis = sku ? milik.find((p) => p.variantSku === sku) : undefined;
    const gabungan = milik.find((p) => p.variantSku === null || p.variantSku === "");
    const r = persis ?? gabungan;
    return r ? angka(r.avgCost) : null;
  };
  const kiriman = dasar === "HARGA_TERIMA" && toko ? await kandidatHargaTerima(tx, toko, itemIds) : [];
  const markup = toko?.markupPercent === null || toko?.markupPercent === undefined ? null : angka(toko.markupPercent);
  const diskonHarga =
    toko?.priceDiscountPercent === null || toko?.priceDiscountPercent === undefined ? null : angka(toko.priceDiscountPercent);

  return baris.map((b) => {
    if (!b.itemId) return { ...b, unitSen: 0, amountSen: 0, sumberHarga: null };
    const hargaTerima = dasar === "HARGA_TERIMA" ? pilihHargaTerima(kiriman, b.itemId, b.variantSku) : null;
    const unitSen = nilaiSatuanSen(dasar, {
      sellingPrice: harga.get(b.itemId) ?? null,
      avgCost: dasar === "HPP" ? hpp(b.itemId, b.variantSku) : null,
      termsType: toko?.termsType ?? null,
      markupPercent: markup,
      priceDiscountPercent: diskonHarga,
      hargaTerima,
    });
    const sumberHarga = dasar !== "HARGA_TERIMA" ? null : hargaTerima !== null ? "KIRIMAN" : "HARGA_ELORAE";
    return { ...b, unitSen, amountSen: unitSen * b.qty, sumberHarga };
  });
}

/**
 * Setel ulang status catatan yang sudah DITETAPKAN/SELESAI dari keadaan lunas
 * bagian-bagiannya. Catatan TERBUKA dan DIBATALKAN tidak disentuh.
 */
export async function segarkanStatusHilang(tx: Tx, lossIds: string[]): Promise<void> {
  for (const lossId of [...new Set(lossIds)]) {
    const loss = await tx.stockLoss.findUnique({
      where: { id: lossId },
      select: { status: true, shares: { select: { amount: true, settledAmount: true } } },
    });
    if (!loss || (loss.status !== "DITETAPKAN" && loss.status !== "SELESAI")) continue;
    const baru = statusSesudahLunas(loss.shares.map((s) => ({ amount: angka(s.amount), settledAmount: angka(s.settledAmount) })));
    if (baru !== loss.status) await tx.stockLoss.update({ where: { id: lossId }, data: { status: baru } });
  }
}

/** Sisa bagian orang ini (SPG/SALES) yang belum lunas, dalam sen. */
export async function sisaBebanOrangSen(klien: Klien, userId: string, bearers: Penanggung[] = ["SPG", "SALES"]): Promise<number> {
  if (!userId) return 0;
  const rows = await klien.stockLossShare.findMany({
    where: { bearerUserId: userId, bearer: { in: bearers }, settledAt: null, loss: { status: "DITETAPKAN" } },
    select: { amount: true, settledAmount: true },
  });
  return rows.reduce((n, r) => n + Math.max(0, keSen(angka(r.amount)) - keSen(angka(r.settledAmount))), 0);
}

/**
 * Sisa beban barang hilang (bagian SPG/SALES, belum lunas) untuk banyak orang
 * sekaligus, dalam RUPIAH — dipakai layar kantor untuk mengingatkan sebelum
 * komisi ditetapkan atau siklus dikunci. Orang tanpa beban tidak ada di peta.
 */
export async function sisaBebanHilangPerOrang(klien: Klien, userIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await klien.stockLossShare.findMany({
    where: { bearerUserId: { in: ids }, bearer: { in: ["SPG", "SALES"] }, settledAt: null, loss: { status: "DITETAPKAN" } },
    select: { bearerUserId: true, amount: true, settledAmount: true },
  });
  const sen = new Map<string, number>();
  for (const r of rows) {
    if (!r.bearerUserId) continue;
    sen.set(r.bearerUserId, (sen.get(r.bearerUserId) ?? 0) + Math.max(0, keSen(angka(r.amount)) - keSen(angka(r.settledAmount))));
  }
  return new Map([...sen].filter(([, n]) => n > 0).map(([id, n]) => [id, n / 100]));
}

/** Jumlah potongan (sen) yang sudah tercatat untuk satu dokumen pembayaran. */
export async function potonganUntukRefSen(klien: Klien, refType: string, refId: string): Promise<number> {
  if (!refType || !refId) return 0;
  const rows = await klien.stockLossDeduction.findMany({ where: { refType, refId }, select: { amount: true } });
  return rows.reduce((n, r) => n + keSen(angka(r.amount)), 0);
}

/**
 * Potong bagian beban milik `userId` sampai `batasSen`, yang TERLAMA dulu
 * (menurut waktu diputuskan), mencicil bagian terakhir yang tersentuh.
 *
 * Idempoten per dokumen pembayaran: kalau `refType`/`refId` ini sudah punya
 * potongan, jumlahnya dikembalikan tanpa memotong lagi — pemanggil yang ingin
 * menghitung ulang memanggil `lepasDeduksi` dulu.
 *
 * Setiap potongan = satu `StockLossDeduction`; `settledAmount` naik; bagian
 * yang habis diberi `settledAt`; catatan yang semua bagiannya lunas → SELESAI.
 */
export async function potongBagianOrang(
  tx: Tx,
  input: {
    userId: string;
    bearers: Penanggung[];
    batasSen: number;
    refType: string;
    refId: string;
    createdById: string;
    note?: string | null;
    sekarang?: Date;
  },
): Promise<number> {
  if (!input.userId || !input.refType || !input.refId) return 0;
  const sudah = await potonganUntukRefSen(tx, input.refType, input.refId);
  if (sudah > 0) return sudah;
  if (input.batasSen <= 0) return 0;
  const sekarang = input.sekarang ?? new Date();

  const terbuka = await tx.stockLossShare.findMany({
    where: { bearerUserId: input.userId, bearer: { in: input.bearers }, settledAt: null, loss: { status: "DITETAPKAN" } },
    orderBy: [{ loss: { decidedAt: "asc" } }, { loss: { createdAt: "asc" } }, { id: "asc" }],
    select: { id: true, lossId: true, amount: true, settledAmount: true },
  });
  const byId = new Map(terbuka.map((s) => [s.id, s]));
  const alokasi = alokasiPotong(
    terbuka.map((s) => ({ id: s.id, sisaSen: keSen(angka(s.amount)) - keSen(angka(s.settledAmount)) })),
    input.batasSen,
  );

  const perLoss = new Map<string, { shareId: string; sebelum: number; sesudah: number; lunas: boolean }[]>();
  let total = 0;
  for (const a of alokasi) {
    const s = byId.get(a.id);
    if (!s) continue;
    const sebelumSen = keSen(angka(s.settledAmount));
    const sesudahSen = sebelumSen + a.potongSen;
    const lunas = sesudahSen >= keSen(angka(s.amount));
    await tx.stockLossDeduction.create({
      data: {
        shareId: s.id,
        amount: desimal(a.potongSen),
        refType: input.refType,
        refId: input.refId,
        note: input.note?.trim() || null,
        createdById: input.createdById,
        createdAt: sekarang,
      },
    });
    await tx.stockLossShare.update({
      where: { id: s.id },
      data: {
        settledAmount: desimal(sesudahSen),
        ...(lunas
          ? { settledAt: sekarang, settledById: input.createdById, settleNote: input.note?.trim() || `Dipotong (${input.refType})` }
          : {}),
      },
    });
    total += a.potongSen;
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
      metadata: { refType: input.refType, refId: input.refId, bearerUserId: input.userId },
      reason: input.note ?? null,
    });
  }
  await segarkanStatusHilang(tx, [...perLoss.keys()]);
  return total;
}

/**
 * Lepas semua potongan/tagihan yang tercatat untuk satu dokumen (`refType` +
 * `refId`): `settledAmount` setiap bagian dikembalikan, bagian yang belum
 * lunas lagi kehilangan `settledAt`, catatan SELESAI kembali DITETAPKAN.
 * Mengembalikan jumlah yang dilepas (sen). Idempoten — panggilan kedua nol.
 */
export async function lepasDeduksi(
  tx: Tx,
  input: { refType: string; refId: string; userId: string; alasan?: string | null },
): Promise<number> {
  if (!input.refType || !input.refId) return 0;
  const deduksi = await tx.stockLossDeduction.findMany({
    where: { refType: input.refType, refId: input.refId },
    select: { id: true, shareId: true, amount: true },
  });
  if (deduksi.length === 0) return 0;

  const perShare = new Map<string, number>();
  for (const d of deduksi) perShare.set(d.shareId, (perShare.get(d.shareId) ?? 0) + keSen(angka(d.amount)));
  const shares = await tx.stockLossShare.findMany({
    where: { id: { in: [...perShare.keys()] } },
    select: { id: true, lossId: true, amount: true, settledAmount: true, settledAt: true },
  });

  const perLoss = new Map<string, { shareId: string; sebelum: number; sesudah: number }[]>();
  let total = 0;
  for (const s of shares) {
    const lepas = perShare.get(s.id) ?? 0;
    const sebelumSen = keSen(angka(s.settledAmount));
    const sesudahSen = Math.max(0, sebelumSen - lepas);
    const masihLunas = sesudahSen >= keSen(angka(s.amount));
    await tx.stockLossShare.update({
      where: { id: s.id },
      data: {
        settledAmount: desimal(sesudahSen),
        ...(masihLunas ? {} : { settledAt: null, settledById: null, settleNote: null }),
      },
    });
    total += sebelumSen - sesudahSen;
    const daftar = perLoss.get(s.lossId) ?? [];
    daftar.push({ shareId: s.id, sebelum: sebelumSen / 100, sesudah: sesudahSen / 100 });
    perLoss.set(s.lossId, daftar);
  }
  await tx.stockLossDeduction.deleteMany({ where: { id: { in: deduksi.map((d) => d.id) } } });

  for (const [lossId, bagian] of perLoss) {
    await jejakHilang(tx, {
      userId: input.userId,
      action: JEJAK_HILANG.POTONGAN_DILEPAS,
      lossId,
      changes: {
        before: { bagian: bagian.map((b) => ({ shareId: b.shareId, settledAmount: b.sebelum })) },
        after: { bagian: bagian.map((b) => ({ shareId: b.shareId, settledAmount: b.sesudah })) },
      },
      metadata: { refType: input.refType, refId: input.refId },
      reason: input.alasan ?? null,
    });
  }
  await segarkanStatusHilang(tx, [...perLoss.keys()]);
  return total;
}
