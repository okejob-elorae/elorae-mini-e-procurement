import { prisma } from "@elorae/db";
import { bacaIdKomisiSpg, bacaSumberOperasional, SUMBER_OPERASIONAL, type SumberOperasional } from "./aturan";

/*
 * Nomor dokumen sumber jurnal operasional (dan induknya, untuk dokumen tanpa
 * halaman sendiri) — KHUSUS SERVER. Dipakai `cariInfoDokumen` (halaman Jurnal,
 * Integritas, tab Tertunda): jurnal yang dokumennya tidak ditemukan di sini
 * dilaporkan yatim oleh Integritas buku besar.
 */

export type InfoDokumenOperasional = {
  nomor: string | null;
  cycleId?: string | null;
  storeReturnId?: string | null;
  periode?: string | null;
};

type Pasangan = { jenis: string; id: string };

async function aman<T>(nama: string, ids: string[], kueri: () => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  try {
    return await kueri();
  } catch (e) {
    console.error(`[info-dokumen-operasional] gagal membaca ${nama}`, e);
    return [];
  }
}

export async function infoDokumenOperasional(pasangan: readonly Pasangan[]): Promise<Array<{ jenis: SumberOperasional; id: string; info: InfoDokumenOperasional }>> {
  const per = new Map<SumberOperasional, Set<string>>();
  for (const p of pasangan) {
    const s = bacaSumberOperasional(p.jenis);
    if (!s || !p.id) continue;
    const ids = per.get(s) ?? new Set<string>();
    ids.add(p.id);
    per.set(s, ids);
  }
  const ids = (s: SumberOperasional) => [...(per.get(s) ?? [])];
  const hasil: Array<{ jenis: SumberOperasional; id: string; info: InfoDokumenOperasional }> = [];
  const isi = (jenis: SumberOperasional, id: string, info: InfoDokumenOperasional) => hasil.push({ jenis, id, info });
  const S = SUMBER_OPERASIONAL;

  const [kirim, pesanan, nri, siklus, gaji, bayar, bayarSpg, hilang, potong, rusak, stok, retur] = await Promise.all([
    aman("ConsignmentShipment", ids(S.KIRIM_KONSI), () =>
      prisma.consignmentShipment.findMany({ where: { id: { in: ids(S.KIRIM_KONSI) } }, select: { id: true, noKirim: true, cycleId: true } }),
    ),
    aman("FieldSalesOrder", ids(S.PESANAN_KONSI), () =>
      prisma.fieldSalesOrder.findMany({ where: { id: { in: ids(S.PESANAN_KONSI) } }, select: { id: true, orderNo: true } }),
    ),
    aman("WarehouseReturn", ids(S.RETUR_KONSI), () =>
      prisma.warehouseReturn.findMany({ where: { id: { in: ids(S.RETUR_KONSI) } }, select: { id: true, noNri: true, storeReturnId: true } }),
    ),
    aman("ConsignmentCycle", [...ids(S.SIKLUS_KONSI), ...ids(S.KOMISI_KONSI)], () =>
      prisma.consignmentCycle.findMany({ where: { id: { in: [...ids(S.SIKLUS_KONSI), ...ids(S.KOMISI_KONSI)] } }, select: { id: true, noKonsi: true } }),
    ),
    aman("ConsignmentCommission", ids(S.BAYAR_GAJI_KONSI), () =>
      prisma.consignmentCommission.findMany({
        where: { id: { in: ids(S.BAYAR_GAJI_KONSI) } },
        select: { id: true, cycleId: true, cycle: { select: { noKonsi: true } }, spgUser: { select: { name: true } } },
      }),
    ),
    aman("ConsignmentPayment", ids(S.BAYAR_TOKO_KONSI), () =>
      prisma.consignmentPayment.findMany({ where: { id: { in: ids(S.BAYAR_TOKO_KONSI) } }, select: { id: true, cycleId: true, cycle: { select: { noKonsi: true } } } }),
    ),
    aman("SpgCommission", ids(S.BAYAR_KOMISI_SPG), () =>
      prisma.spgCommission.findMany({ where: { id: { in: ids(S.BAYAR_KOMISI_SPG) } }, select: { id: true, period: true, storeId: true } }),
    ),
    aman("StockLoss", ids(S.BARANG_HILANG), () =>
      prisma.stockLoss.findMany({ where: { id: { in: ids(S.BARANG_HILANG) } }, select: { id: true, sourceDocNo: true, storeId: true } }),
    ),
    aman("StockLossDeduction", ids(S.POTONG_SALES), () =>
      prisma.stockLossDeduction.findMany({ where: { id: { in: ids(S.POTONG_SALES) } }, select: { id: true, refId: true } }),
    ),
    aman("DamagedStockMovement", ids(S.GUDANG_RUSAK), () =>
      prisma.damagedStockMovement.findMany({ where: { id: { in: ids(S.GUDANG_RUSAK) } }, select: { id: true, productName: true } }),
    ),
    aman("StockAdjustment", ids(S.STOK_MANUAL), () =>
      prisma.stockAdjustment.findMany({ where: { id: { in: ids(S.STOK_MANUAL) } }, select: { id: true, docNumber: true } }),
    ),
    aman("VendorReturn", ids(S.RETUR_PEMASOK), () =>
      prisma.vendorReturn.findMany({ where: { id: { in: ids(S.RETUR_PEMASOK) } }, select: { id: true, docNumber: true } }),
    ),
  ]);

  for (const r of kirim) isi(S.KIRIM_KONSI, r.id, { nomor: r.noKirim, cycleId: r.cycleId });
  for (const r of pesanan) isi(S.PESANAN_KONSI, r.id, { nomor: r.orderNo });
  for (const r of nri) isi(S.RETUR_KONSI, r.id, { nomor: r.noNri, storeReturnId: r.storeReturnId });
  const idSiklus = new Set(ids(S.SIKLUS_KONSI));
  const idKomisi = new Set(ids(S.KOMISI_KONSI));
  for (const r of siklus) {
    if (idSiklus.has(r.id)) isi(S.SIKLUS_KONSI, r.id, { nomor: r.noKonsi, cycleId: r.id });
    if (idKomisi.has(r.id)) isi(S.KOMISI_KONSI, r.id, { nomor: r.noKonsi, cycleId: r.id });
  }
  for (const r of gaji) isi(S.BAYAR_GAJI_KONSI, r.id, { nomor: `${r.cycle.noKonsi} · ${r.spgUser.name ?? "SPG"}`, cycleId: r.cycleId });
  for (const r of bayar) isi(S.BAYAR_TOKO_KONSI, r.id, { nomor: r.cycle.noKonsi, cycleId: r.cycleId });

  // Nama toko untuk komisi SPG (per toko × bulan) dan barang hilang.
  const komisiSpg = ids(S.KOMISI_SPG).flatMap((id) => {
    const k = bacaIdKomisiSpg(id);
    return k ? [{ id, ...k }] : [];
  });
  const tokoIds = [...new Set([...komisiSpg.map((k) => k.storeId), ...bayarSpg.map((r) => r.storeId), ...hilang.flatMap((r) => (r.storeId ? [r.storeId] : []))])];
  const toko = new Map(
    (await aman("Store", tokoIds, () => prisma.store.findMany({ where: { id: { in: tokoIds } }, select: { id: true, name: true } }))).map((t) => [t.id, t.name]),
  );
  for (const k of komisiSpg) {
    if (toko.has(k.storeId)) isi(S.KOMISI_SPG, k.id, { nomor: `${toko.get(k.storeId)} ${k.periode}`, periode: k.periode });
  }
  for (const r of bayarSpg) isi(S.BAYAR_KOMISI_SPG, r.id, { nomor: `${toko.get(r.storeId) ?? "Toko"} ${r.period}`, periode: r.period });
  for (const r of hilang) isi(S.BARANG_HILANG, r.id, { nomor: [r.storeId ? toko.get(r.storeId) : null, r.sourceDocNo].filter(Boolean).join(" · ") || "Barang hilang" });
  for (const r of potong) isi(S.POTONG_SALES, r.id, { nomor: `Potongan komisi ${r.refId.split(":")[1] ?? ""}`.trim() });
  for (const r of rusak) isi(S.GUDANG_RUSAK, r.id, { nomor: r.productName });
  for (const r of stok) isi(S.STOK_MANUAL, r.id, { nomor: r.docNumber });
  for (const r of retur) isi(S.RETUR_PEMASOK, r.id, { nomor: r.docNumber });

  const klaimIds = [...new Set([...ids(S.BIAYA_PERJALANAN), ...ids(S.BAYAR_BIAYA_PERJALANAN)])];
  const klaim = await aman("ExpenseClaim", klaimIds, () =>
    prisma.expenseClaim.findMany({ where: { id: { in: klaimIds } }, select: { id: true, userId: true, category: true } }),
  );
  const orangIds = [...new Set(klaim.map((k) => k.userId))];
  const orang = new Map(
    (await aman("User", orangIds, () => prisma.user.findMany({ where: { id: { in: orangIds } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]),
  );
  const idBiaya = new Set(ids(S.BIAYA_PERJALANAN));
  const idBayarBiaya = new Set(ids(S.BAYAR_BIAYA_PERJALANAN));
  for (const k of klaim) {
    const nomor = `${orang.get(k.userId) ?? "Salesman"} · ${k.category.toLowerCase()}`;
    if (idBiaya.has(k.id)) isi(S.BIAYA_PERJALANAN, k.id, { nomor });
    if (idBayarBiaya.has(k.id)) isi(S.BAYAR_BIAYA_PERJALANAN, k.id, { nomor });
  }
  return hasil;
}
