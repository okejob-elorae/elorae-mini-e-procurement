import type { Prisma } from "@elorae/db";
import { awalBulanBerikutWib, dariSen, desimal, JEJAK_HILANG, keSen, REF_SIKLUS_KONSI } from "./hilang";
import { jejakHilang, lepasDeduksi, potonganUntukRefSen, segarkanStatusHilang } from "./hilang-db";

/**
 * Beban barang hilang yang ditetapkan ke TOKO konsinyasi ikut ditagihkan di
 * siklus bulan itu. Dipanggil DI DALAM transaksi kunci siklus
 * (`kunciAngka`): mengembalikan jumlah yang dibekukan di
 * `ConsignmentCycle.lossChargedToStore` dan menandai bagian-bagian itu
 * sudah ditagihkan di siklus ini. `lepasBebanHilangSiklus` membalikkannya saat
 * kunci dibuka.
 *
 * Yang ditagihkan: setiap bagian TOKO yang belum lunas, dari catatan
 * DITETAPKAN milik toko ini yang DIBUKA sebelum awal bulan sesudah siklus
 * (WIB) — termasuk yang dari bulan-bulan sebelumnya yang belum sempat
 * ditagihkan. Setiap bagian dilunasi penuh (`settledAmount = amount`) dengan
 * satu `StockLossDeduction` (`refType` "ConsignmentCycle", `refId` siklus).
 *
 * Idempoten di dalam satu kunci: nilai yang dikembalikan adalah SELURUH
 * tagihan yang tercatat untuk siklus ini, bukan hanya yang baru ditandai.
 */
export async function bebanHilangUntukSiklus(
  tx: Prisma.TransactionClient,
  input: { cycleId: string; noKonsi: string; storeId: string; periodYear: number; periodMonth: number; userId: string },
): Promise<number> {
  if (!input.cycleId || !input.storeId) return 0;
  const sekarang = new Date();
  const batas = awalBulanBerikutWib(input.periodYear, input.periodMonth);

  const shares = await tx.stockLossShare.findMany({
    where: {
      bearer: "TOKO",
      settledAt: null,
      loss: { storeId: input.storeId, status: "DITETAPKAN", createdAt: { lt: batas } },
    },
    orderBy: [{ loss: { createdAt: "asc" } }, { id: "asc" }],
    select: { id: true, lossId: true, amount: true, settledAmount: true },
  });

  const note = `Ditagihkan di siklus ${input.noKonsi}`;
  for (const s of shares) {
    const jumlahSen = keSen(Number(s.amount));
    const sebelumSen = keSen(Number(s.settledAmount));
    const tagihSen = jumlahSen - sebelumSen;
    if (tagihSen <= 0) continue;
    await tx.stockLossDeduction.create({
      data: { shareId: s.id, amount: desimal(tagihSen), refType: REF_SIKLUS_KONSI, refId: input.cycleId, note, createdById: input.userId, createdAt: sekarang },
    });
    await tx.stockLossShare.update({
      where: { id: s.id },
      data: { settledAmount: desimal(jumlahSen), settledAt: sekarang, settledById: input.userId, settleNote: note },
    });
    await jejakHilang(tx, {
      userId: input.userId,
      action: JEJAK_HILANG.LUNAS,
      lossId: s.lossId,
      changes: { before: { shareId: s.id, settledAmount: dariSen(sebelumSen) }, after: { shareId: s.id, settledAmount: dariSen(jumlahSen) } },
      metadata: { bearer: "TOKO", cara: "SIKLUS_KONSINYASI", cycleId: input.cycleId, noKonsi: input.noKonsi },
    });
  }
  await segarkanStatusHilang(tx, shares.map((s) => s.lossId));
  return dariSen(await potonganUntukRefSen(tx, REF_SIKLUS_KONSI, input.cycleId));
}

/**
 * Kunci siklus dibuka: semua tagihan barang hilang yang dibekukan di siklus
 * ini dilepas — bagiannya kembali belum lunas dan akan ditagihkan lagi saat
 * siklus dikunci ulang.
 */
export async function lepasBebanHilangSiklus(tx: Prisma.TransactionClient, input: { cycleId: string; noKonsi: string; userId: string }): Promise<void> {
  await lepasDeduksi(tx, {
    refType: REF_SIKLUS_KONSI,
    refId: input.cycleId,
    userId: input.userId,
    alasan: `Kunci siklus ${input.noKonsi} dibuka`,
  });
}
