import { prisma, Prisma, sqlId } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { generasiSourceId, selisihBaris, type BarisBertanda } from "@/lib/finance/lapangan/aturan";
import { bacaJurnalTerposting } from "@/lib/finance/lapangan/selaras";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { daftarkanSumberSapuan, type DokumenTanpaJurnal, type OpsiCariSapuan } from "@/lib/finance/sapuan/registri";
import { cariTanpaJurnalSql } from "@/lib/finance/sapuan/sql";
import { REF_KOMISI_KONSI, REF_KOMISI_SPG_PUTUS } from "@/lib/spg/hilang";
import { JEJAK_KOMISI_SPG } from "@/lib/spg/komisi";
import {
  akhirBulanWib,
  bacaIdKomisiSpg,
  bacaPeriode,
  idKomisiSpg,
  NAMA_SUMBER_OPERASIONAL,
  SUMBER_OPERASIONAL,
  tanggalPeriode,
  type SumberOperasional,
} from "./aturan";
import { AWALAN_STOK_AWAL_UMKM, sasaranKomisiKonsi, sasaranKomisiSpg } from "./jurnal";
import { postingJurnalOperasionalAman } from "./tertunda";

/*
 * Pencari "dokumen operasional tanpa jurnal" untuk sapuan terjadwal (registri
 * `lib/finance/sapuan/registri.ts`) dan layar Rekonsiliasi persediaan.
 * Syarat "seharusnya berjurnal" setiap pencari meniru penulisnya di
 * `jurnal.ts` (status final, nilai bukan nol); bila penulisnya berubah,
 * ubah pencarinya — kalau tidak, dokumen bernilai nol tampil selamanya
 * sebagai "tanpa jurnal".
 *
 * "Tanpa jurnal" = belum punya jurnal GENERASI PERTAMA (sourceId = id dokumen).
 * Jurnal bergenerasi yang tertinggal dari keadaan dokumennya diselaraskan oleh
 * kait pasca-commit dan tombol "Posting ulang", bukan oleh sapuan ini — kecuali
 * akrual gaji/komisi SPG yang digeser pembayarannya:
 *  - pembayaran yang disapu diposting lewat `postingJurnalOperasionalAman`,
 *    yang menyelaraskan akrual barisnya DULU (pembayaran bisa menghitung ulang
 *    angkanya), sama dengan kaitnya;
 *  - pembayaran yang tidak berjurnal sama sekali (dihitung ulang menjadi neto
 *    nol tanpa koreksi) tidak pernah disapu, jadi akrualnya dicari sendiri
 *    (`akrualTertinggal`) lewat jejak hitung ulangnya.
 */

const d = (kolom: string) => Prisma.sql`d.${sqlId(kolom)}`;

/** Toko dokumen (`kolom` di `d`) berjenis konsinyasi. */
const tokoKonsi = (kolom: Prisma.Sql) =>
  Prisma.sql`EXISTS (SELECT 1 FROM ${sqlId("Store")} s WHERE s.${sqlId("id")} = ${kolom} AND s.${sqlId("termsType")} = 'KONSI')`;

/**
 * Dokumen yang id-nya disusun di JS (bukan satu tabel): disaring dari daftar
 * kandidat. Cakupan (`ids`) diterapkan SEBELUM batas.
 */
async function tanpaJurnalDari(
  sourceType: SumberOperasional,
  semuaKandidat: DokumenTanpaJurnal[],
  opsi: Pick<OpsiCariSapuan, "batas" | "ids">,
): Promise<DokumenTanpaJurnal[]> {
  const batas = opsi.batas;
  const izinkan = opsi.ids ? new Set(opsi.ids) : null;
  const kandidat = izinkan ? semuaKandidat.filter((k) => izinkan.has(k.id)) : semuaKandidat;
  const hasil: DokumenTanpaJurnal[] = [];
  for (let i = 0; i < kandidat.length && hasil.length < batas; i += 200) {
    const potong = kandidat.slice(i, i + 200);
    const ada = new Set(
      (await prisma.journal.findMany({ where: { sourceType, sourceId: { in: potong.map((k) => k.id) } }, select: { sourceId: true } })).map((j) => j.sourceId),
    );
    for (const k of potong) {
      if (ada.has(k.id)) continue;
      hasil.push(k);
      if (hasil.length >= batas) break;
    }
  }
  return hasil;
}

export function cariKirimKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ConsignmentShipment",
    sourceType: SUMBER_OPERASIONAL.KIRIM_KONSI,
    tanggal: d("shippedAt"),
    kolomLabel: "noKirim",
    syarat: Prisma.sql`AND EXISTS (
      SELECT 1 FROM ${sqlId("ConsignmentShipmentItem")} i
      JOIN ${sqlId("StockAdjustment")} a ON a.${sqlId("idempotencyKey")} = CONCAT('konsi-kirim-', i.${sqlId("id")})
      WHERE i.${sqlId("shipmentId")} = d.${sqlId("id")} AND a.${sqlId("prevAvgCost")} > 0
    )`,
    opsi,
  });
}

export function cariPesananKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "FieldSalesOrder",
    sourceType: SUMBER_OPERASIONAL.PESANAN_KONSI,
    tanggal: d("approvedAt"),
    kolomLabel: "orderNo",
    syarat: Prisma.sql`AND d.${sqlId("orderType")} = 'KONSI' AND d.${sqlId("approvedAt")} IS NOT NULL AND EXISTS (
      SELECT 1 FROM ${sqlId("FieldSalesOrderLine")} l
      JOIN ${sqlId("StockAdjustment")} a ON a.${sqlId("idempotencyKey")} = CONCAT('konsi-transfer-line-', l.${sqlId("id")})
      WHERE l.${sqlId("orderId")} = d.${sqlId("id")} AND a.${sqlId("prevAvgCost")} > 0
    )`,
    opsi,
  });
}

/** Satu `KonsiTransfer` per pengiriman selesai; bernilai bila ada baris ber-qty dan berharga (penulisnya membaca yang sama). */
export function cariPindahKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "KonsiTransfer",
    sourceType: SUMBER_OPERASIONAL.PINDAH_KONSI,
    tanggal: d("createdAt"),
    kolomLabel: "docNo",
    syarat: Prisma.sql`AND EXISTS (
      SELECT 1 FROM ${sqlId("KonsiTransferLine")} l
      WHERE l.${sqlId("transferId")} = d.${sqlId("id")} AND l.${sqlId("qty")} > 0 AND l.${sqlId("unitCost")} > 0
    )`,
    opsi,
  });
}

/** Baris kartu stok gudang utama yang dimasukkan retur lapangan `d`. */
const masukGudangRetur = (syarat: Prisma.Sql) => Prisma.sql`EXISTS (
  SELECT 1 FROM ${sqlId("StockLedgerEntry")} e
  WHERE e.${sqlId("refType")} = 'FieldReturn' AND e.${sqlId("refId")} = d.${sqlId("id")} AND e.${sqlId("locationType")} = 'MAIN' ${syarat}
)`;

/** Baris retur lapangan `d` (alias `l`). */
const barisReturLapangan = (syarat: Prisma.Sql) => Prisma.sql`EXISTS (
  SELECT 1 FROM ${sqlId("FieldReturnLine")} l
  WHERE l.${sqlId("returnId")} = d.${sqlId("id")} ${syarat}
)`;

/** Kiriman konsinyasi barang `l` sampai `d.approvedAt` (yang dirata-rata `rataRataKirim`: qty bukan nol). */
const kirimanKonsiBarang = (syarat: Prisma.Sql) => Prisma.sql`EXISTS (
  SELECT 1 FROM ${sqlId("StockAdjustment")} a
  WHERE a.${sqlId("source")} = 'KONSI_TRANSFER' AND a.${sqlId("itemId")} = l.${sqlId("itemId")}
    AND a.${sqlId("createdAt")} <= d.${sqlId("approvedAt")} AND a.${sqlId("qtyChange")} <> 0 ${syarat}
)`;

/**
 * Biaya konsinyasi barang `l` pada `d.approvedAt` di atas nol — cabang yang sama dengan
 * `biayaSatuanKonsi`: rata-rata kirimannya bila ada kiriman (nol kalau semuanya
 * dikirim pada harga nol, tanpa cadangan); kalau tidak ada kiriman sama sekali,
 * cadangannya (harga rata-rata gudang terakhir sebelum saat itu, lalu yang sekarang).
 */
const biayaKonsiBarangPositif = Prisma.sql`(
  ${kirimanKonsiBarang(Prisma.sql`AND a.${sqlId("prevAvgCost")} > 0`)}
  OR (NOT ${kirimanKonsiBarang(Prisma.empty)} AND (
    EXISTS (
      SELECT 1 FROM ${sqlId("StockAdjustment")} c
      WHERE c.${sqlId("itemId")} = l.${sqlId("itemId")} AND c.${sqlId("createdAt")} <= d.${sqlId("approvedAt")} AND c.${sqlId("newAvgCost")} > 0
    )
    OR EXISTS (SELECT 1 FROM ${sqlId("InventoryValue")} v WHERE v.${sqlId("itemId")} = l.${sqlId("itemId")} AND v.${sqlId("avgCost")} > 0)
  ))
)`;

/**
 * Retur lapangan toko konsinyasi yang disetujui yang ditulis
 * `postJurnalReturLapanganKonsi`:
 *  - yang DITOLAKNYA (BIAYA_TIDAK_DIKETAHUI) — masuk gudang utama tanpa nilai
 *    tercatat, atau barang layak tanpa baris kartu stok gudang utama — ikut
 *    ditemukan supaya tidak diam;
 *  - selain itu hanya yang bernilai: masuk gudang utama bukan nol, atau barang
 *    keluar dari toko yang biaya konsinyasinya di atas nol.
 * Retur yang semua angkanya nol (harga rata-rata nol saat dikirim dan saat
 * kembali, atau semua ditolak gudang dan biaya kirimnya tidak diketahui) tidak
 * menghasilkan baris jurnal, jadi tidak dicari.
 */
export function cariReturLapanganKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "FieldReturn",
    sourceType: SUMBER_OPERASIONAL.RETUR_LAPANGAN_KONSI,
    tanggal: d("approvedAt"),
    kolomLabel: "docNo",
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'APPROVED' AND d.${sqlId("approvedAt")} IS NOT NULL AND ${tokoKonsi(d("storeId"))} AND (
      ${masukGudangRetur(Prisma.sql`AND e.${sqlId("totalCost")} IS NULL`)}
      OR (${barisReturLapangan(Prisma.sql`AND l.${sqlId("sellableQty")} > 0`)} AND NOT ${masukGudangRetur(Prisma.empty)})
      OR ${masukGudangRetur(Prisma.sql`AND e.${sqlId("totalCost")} <> 0`)}
      OR ${barisReturLapangan(Prisma.sql`AND l.${sqlId("creditedQty")} > 0 AND ${biayaKonsiBarangPositif}`)}
    )`,
    opsi,
  });
}

export function cariReturKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  const tokoNri = Prisma.sql`COALESCE(d.${sqlId("storeId")}, (SELECT r.${sqlId("storeId")} FROM ${sqlId("StoreReturn")} r WHERE r.${sqlId("id")} = d.${sqlId("storeReturnId")}))`;
  return cariTanpaJurnalSql({
    tabel: "WarehouseReturn",
    sourceType: SUMBER_OPERASIONAL.RETUR_KONSI,
    tanggal: d("finalisedAt"),
    kolomLabel: "noNri",
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'FINAL' AND ${tokoKonsi(tokoNri)} AND EXISTS (
      SELECT 1 FROM ${sqlId("WarehouseReturnItem")} i
      WHERE i.${sqlId("warehouseReturnId")} = d.${sqlId("id")} AND i.${sqlId("itemId")} IS NOT NULL AND i.${sqlId("qty")} > 0
    )`,
    opsi,
  });
}

/** Siklus yang dikunci, bertanggal jurnal (akhir bulan periodenya, paling lambat saat dikunci) di rentang. */
async function siklusTerkunci(opsi: OpsiCariSapuan, syarat: Prisma.ConsignmentCycleWhereInput, sourceType: SumberOperasional) {
  const rows = await prisma.consignmentCycle.findMany({
    where: { lockedAt: { not: null, gte: opsi.sejak }, ...syarat, ...(opsi.ids ? { id: { in: [...opsi.ids] } } : {}) },
    orderBy: [{ lockedAt: "asc" }, { id: "asc" }],
    select: { id: true, noKonsi: true, lockedAt: true, periodYear: true, periodMonth: true },
  });
  const kandidat = rows
    .map((r) => ({ id: r.id, tanggal: tanggalPeriode(r.periodYear, r.periodMonth, r.lockedAt), label: r.noKonsi }))
    .filter((r) => r.tanggal.getTime() >= opsi.sejak.getTime() && r.tanggal.getTime() <= opsi.sampai.getTime());
  return tanpaJurnalDari(sourceType, kandidat, opsi);
}

export function cariSiklusKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return siklusTerkunci(
    opsi,
    { OR: [{ sold: { some: { amount: { not: 0 } } } }, { promoBorneByElorae: { not: 0 } }, { lossChargedToStore: { not: 0 } }] },
    SUMBER_OPERASIONAL.SIKLUS_KONSI,
  );
}

/**
 * Akrual gaji/komisi SPG yang TERTINGGAL dari pembayaran yang menghitung ulang angka
 * barisnya (jejak `SPG_COMMISSION_RECOMPUTED_AT_PAYMENT` bertanggal di rentang). Biasanya
 * `postingJurnalOperasionalAman` atas pembayaran itu menyelaraskannya — lewat kait
 * pasca-commit, atau sapuan pembayaran bila kaitnya mati. Tetapi pembayaran yang dihitung
 * ulang menjadi neto nol tanpa koreksi (bagi rata 22.500 untuk SPG tanpa penjualan di HP,
 * dibayar Rp 0) tidak berjurnal, jadi pencari pembayaran tidak pernah menemukannya: bila
 * kaitnya mati, akrualnya memuat beban komisi yang tidak pernah terutang, tanpa tanda di
 * mana pun. Akrualnya ditemukan di sini.
 *
 * Yang dikembalikan hanya akrual yang SUDAH berjurnal, tanpa jurnal sesudah jejak
 * terakhirnya, dan yang sasarannya sekarang (penyusun yang sama dengan penyelarasnya)
 * berbeda dari yang terposting. Dibandingkan ISINYA, bukan waktunya saja: pembayaran
 * berdasar lama yang angkanya tetap, atau akrual yang sudah diselaraskan, tidak pernah
 * tampil — jadi tidak ada yang "tanpa jurnal" selamanya. Akrual yang belum berjurnal sama
 * sekali dicari jalur generasi pertama (tanggal periodenya), bukan di sini.
 */
async function akrualTertinggal(input: {
  sourceType: typeof SUMBER_OPERASIONAL.KOMISI_SPG | typeof SUMBER_OPERASIONAL.KOMISI_KONSI;
  refType: typeof REF_KOMISI_SPG_PUTUS | typeof REF_KOMISI_KONSI;
  /** id baris yang dibayar → akrualnya (id sumber jurnal + label); baris yang sudah tidak ada dilewati. */
  akrualBaris: (barisIds: string[]) => Promise<Map<string, { id: string; label: string }>>;
  sasaran: (akrualId: string) => Promise<BarisBertanda[] | null>;
  /** Akrual yang sudah dikembalikan jalur generasi pertama. */
  kecuali: readonly DokumenTanpaJurnal[];
  opsi: OpsiCariSapuan;
}): Promise<DokumenTanpaJurnal[]> {
  const { sourceType, opsi } = input;
  const batas = opsi.batas - input.kecuali.length;
  if (batas <= 0 || opsi.ids?.length === 0) return [];
  const jejak = await prisma.auditLog.findMany({
    where: { action: JEJAK_KOMISI_SPG.DIHITUNG_ULANG_SAAT_BAYAR, entityType: input.refType, createdAt: { gte: opsi.sejak, lte: opsi.sampai } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entityId: true, createdAt: true },
  });
  if (jejak.length === 0) return [];
  const akrual = await input.akrualBaris([...new Set(jejak.map((j) => j.entityId))]);
  const izinkan = opsi.ids ? new Set(opsi.ids) : null;
  const sudah = new Set(input.kecuali.map((k) => k.id));
  // Urut naik, jadi jejak yang lebih baru menimpa: akrual dibandingkan dengan pergeseran TERAKHIRNYA.
  const kandidat = new Map<string, DokumenTanpaJurnal>();
  for (const j of jejak) {
    const a = akrual.get(j.entityId);
    if (!a || sudah.has(a.id) || (izinkan && !izinkan.has(a.id))) continue;
    kandidat.set(a.id, { id: a.id, tanggal: j.createdAt, label: a.label });
  }

  // Jurnal terakhir per akrual (semua generasi). Tanpa jurnal = urusan jalur generasi pertama;
  // berjurnal SESUDAH jejaknya = sudah diselaraskan sesudah pembayaran itu.
  const ids = [...kandidat.keys()];
  const terakhir = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const potong = ids.slice(i, i + 100);
    const jurnal = await prisma.journal.findMany({
      where: { sourceType, ...SARING_JURNAL_BERLAKU, OR: potong.flatMap((id) => [{ sourceId: id }, { sourceId: { startsWith: `${id}#` } }]) },
      select: { sourceId: true, createdAt: true },
    });
    for (const j of jurnal) {
      const sourceId = j.sourceId;
      const milik = sourceId ? potong.find((id) => generasiSourceId(id, sourceId) !== null) : undefined;
      if (milik) terakhir.set(milik, Math.max(terakhir.get(milik) ?? 0, j.createdAt.getTime()));
    }
  }
  const urut = [...kandidat.values()]
    .filter((k) => {
      const t = terakhir.get(k.id);
      return t !== undefined && t < k.tanggal.getTime();
    })
    .sort((x, y) => x.tanggal.getTime() - y.tanggal.getTime() || x.id.localeCompare(y.id));

  const hasil: DokumenTanpaJurnal[] = [];
  for (const k of urut) {
    if (hasil.length >= batas) break;
    const [ada, sasaran] = await Promise.all([bacaJurnalTerposting(prisma, sourceType, k.id), input.sasaran(k.id)]);
    if (sasaran && ada.sourceIds.length > 0 && selisihBaris(sasaran, ada.baris).length > 0) hasil.push(k);
  }
  return hasil;
}

/** Baris pembayaran → akrualnya, dibaca per potongan (daftar `in` tidak pernah tak terbatas). */
async function petaPerPotong<T>(ids: string[], baca: (potong: string[]) => Promise<Array<[string, T]>>): Promise<Map<string, T>> {
  const peta = new Map<string, T>();
  for (let i = 0; i < ids.length; i += 500) for (const [k, v] of await baca(ids.slice(i, i + 500))) peta.set(k, v);
  return peta;
}

const LABEL_TERTINGGAL = "penyesuaian saat dibayar";

export async function cariKomisiKonsiTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const pertama = await siklusTerkunci(opsi, { commissions: { some: { total: { gt: 0 } } } }, SUMBER_OPERASIONAL.KOMISI_KONSI);
  const tertinggal = await akrualTertinggal({
    sourceType: SUMBER_OPERASIONAL.KOMISI_KONSI,
    refType: REF_KOMISI_KONSI,
    akrualBaris: (barisIds) =>
      petaPerPotong(barisIds, async (potong) =>
        (
          await prisma.consignmentCommission.findMany({
            where: { id: { in: potong } },
            select: { id: true, cycleId: true, cycle: { select: { noKonsi: true } } },
          })
        ).map((r): [string, { id: string; label: string }] => [r.id, { id: r.cycleId, label: `${r.cycle.noKonsi} (${LABEL_TERTINGGAL})` }]),
      ),
    sasaran: async (cycleId) => (await sasaranKomisiKonsi(prisma, cycleId, null)).sasaran,
    kecuali: pertama,
    opsi,
  });
  return [...pertama, ...tertinggal];
}

/**
 * Pembayaran gaji/komisi SPG `d` yang membawa koreksi komisi berjurnal
 * (`SpgCommissionCorrection` ber-`paidRefType`/`paidRefId` baris itu). Jurnal
 * pembayarannya ada walau neto barisnya SENDIRI nol (gaji pokok nol, laporan
 * tanpa penjualan di HP): beban koreksi di toko + kanal asalnya, bank sebesar
 * Σ koreksi. Bersyarat per toko × jenis laporan asal (= toko × kanal baris
 * bebannya), sama dengan `gabungBaris` di penulisnya: koreksi yang saling
 * menghapus di toko + kanal yang sama tidak menghasilkan baris, jadi tidak dicari.
 */
const membawaKoreksi = (paidRefType: typeof REF_KOMISI_KONSI | typeof REF_KOMISI_SPG_PUTUS) => Prisma.sql`EXISTS (
  SELECT 1 FROM ${sqlId("SpgCommissionCorrection")} c
  WHERE c.${sqlId("paidRefType")} = ${paidRefType} AND c.${sqlId("paidRefId")} = d.${sqlId("id")}
  GROUP BY c.${sqlId("sourceStoreId")}, c.${sqlId("sourceKind")}
  HAVING SUM(c.${sqlId("amount")}) <> 0
)`;

export function cariBayarGajiKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ConsignmentCommission",
    sourceType: SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI,
    tanggal: d("paidAt"),
    kolomLabel: "id",
    syarat: Prisma.sql`AND d.${sqlId("paidAt")} IS NOT NULL AND (d.${sqlId("total")} - d.${sqlId("deduction")} > 0 OR ${membawaKoreksi(REF_KOMISI_KONSI)})`,
    opsi,
  });
}

export function cariBayarTokoKonsiTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ConsignmentPayment",
    sourceType: SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI,
    tanggal: d("paidOn"),
    kolomLabel: "id",
    syarat: Prisma.sql`AND d.${sqlId("cancelledAt")} IS NULL AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

export async function cariKomisiSpgTanpaJurnal(opsi: OpsiCariSapuan): Promise<DokumenTanpaJurnal[]> {
  const grup = await prisma.spgCommission.groupBy({ by: ["storeId", "period"], _sum: { commission: true } });
  const kandidat: DokumenTanpaJurnal[] = [];
  for (const g of grup) {
    const p = bacaPeriode(g.period);
    if (!p || !(Number(g._sum.commission ?? 0) > 0)) continue;
    const tanggal = akhirBulanWib(p[0], p[1]);
    if (tanggal.getTime() < opsi.sejak.getTime() || tanggal.getTime() > opsi.sampai.getTime()) continue;
    kandidat.push({ id: idKomisiSpg(g.storeId, g.period), tanggal, label: `Komisi SPG ${g.period}` });
  }
  kandidat.sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime() || a.id.localeCompare(b.id));
  const pertama = await tanpaJurnalDari(SUMBER_OPERASIONAL.KOMISI_SPG, kandidat, opsi);
  const tertinggal = await akrualTertinggal({
    sourceType: SUMBER_OPERASIONAL.KOMISI_SPG,
    refType: REF_KOMISI_SPG_PUTUS,
    akrualBaris: (barisIds) =>
      petaPerPotong(barisIds, async (potong) =>
        (await prisma.spgCommission.findMany({ where: { id: { in: potong } }, select: { id: true, storeId: true, period: true } }))
          .filter((r) => bacaPeriode(r.period) !== null)
          .map((r): [string, { id: string; label: string }] => [
            r.id,
            { id: idKomisiSpg(r.storeId, r.period), label: `Komisi SPG ${r.period} (${LABEL_TERTINGGAL})` },
          ]),
      ),
    sasaran: async (id) => {
      const k = bacaIdKomisiSpg(id);
      return k ? ((await sasaranKomisiSpg(prisma, k.storeId, k.periode, null))?.sasaran ?? null) : null;
    },
    kecuali: pertama,
    opsi,
  });
  return [...pertama, ...tertinggal];
}

export function cariBayarKomisiSpgTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "SpgCommission",
    sourceType: SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG,
    tanggal: d("paidAt"),
    kolomLabel: "period",
    syarat: Prisma.sql`AND d.${sqlId("paidAt")} IS NOT NULL AND (d.${sqlId("commission")} - d.${sqlId("deduction")} > 0 OR ${membawaKoreksi(REF_KOMISI_SPG_PUTUS)})`,
    opsi,
  });
}

export function cariBarangHilangTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "StockLoss",
    sourceType: SUMBER_OPERASIONAL.BARANG_HILANG,
    tanggal: Prisma.sql`COALESCE(d.${sqlId("decidedAt")}, d.${sqlId("createdAt")})`,
    kolomLabel: "id",
    syarat: Prisma.sql`AND d.${sqlId("status")} IN ('DITETAPKAN', 'SELESAI') AND ${tokoKonsi(d("storeId"))} AND EXISTS (
      SELECT 1 FROM ${sqlId("StockLossLine")} l WHERE l.${sqlId("lossId")} = d.${sqlId("id")} AND l.${sqlId("itemId")} IS NOT NULL AND l.${sqlId("qty")} > 0
    )`,
    opsi,
  });
}

export function cariPotongSalesTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "StockLossDeduction",
    sourceType: SUMBER_OPERASIONAL.POTONG_SALES,
    tanggal: d("createdAt"),
    kolomLabel: "refId",
    syarat: Prisma.sql`AND d.${sqlId("refType")} = 'KomisiSalesman' AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

export function cariGudangRusakTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "DamagedStockMovement",
    sourceType: SUMBER_OPERASIONAL.GUDANG_RUSAK,
    tanggal: d("createdAt"),
    kolomLabel: "productName",
    // Nilai keluar nol (gudang rusak tanpa nilai) tidak berjurnal; JUAL_OBRAL menyimpan HASIL JUAL di `value`.
    syarat: Prisma.sql`AND d.${sqlId("kind")} IN ('PERBAIKI', 'JUAL_OBRAL', 'MUSNAHKAN')
      AND (d.${sqlId("kind")} = 'JUAL_OBRAL' OR d.${sqlId("value")} IS NULL OR d.${sqlId("value")} <> 0 OR d.${sqlId("refId")} IS NOT NULL)`,
    opsi,
  });
}

export function cariStokManualTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "StockAdjustment",
    sourceType: SUMBER_OPERASIONAL.STOK_MANUAL,
    tanggal: d("createdAt"),
    kolomLabel: "docNumber",
    syarat: Prisma.sql`AND d.${sqlId("source")} = 'ERP' AND d.${sqlId("reason")} NOT LIKE ${`${AWALAN_STOK_AWAL_UMKM}%`}
      AND ABS(d.${sqlId("newQty")} * d.${sqlId("newAvgCost")} - d.${sqlId("prevQty")} * d.${sqlId("prevAvgCost")}) >= 0.01`,
    opsi,
  });
}

export function cariReturPemasokTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "VendorReturn",
    sourceType: SUMBER_OPERASIONAL.RETUR_PEMASOK,
    tanggal: d("completedAt"),
    kolomLabel: "docNumber",
    // Nilai keluar = `gerakStokPerDokumen` (buku besar stok, arsip StockMovement untuk retur lama).
    // Baris buku besar tanpa nilai ikut ditemukan: penulisnya menolak (BIAYA_TIDAK_DIKETAHUI), tidak diam.
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'COMPLETED' AND (
      (d.${sqlId("poId")} IS NOT NULL AND COALESCE(d.${sqlId("poCreditAmount")}, 0) <> 0)
      OR EXISTS (
        SELECT 1 FROM ${sqlId("StockLedgerEntry")} l
        WHERE l.${sqlId("refType")} = 'VendorReturn' AND l.${sqlId("refId")} = d.${sqlId("id")} AND l.${sqlId("locationType")} = 'MAIN'
          AND (l.${sqlId("totalCost")} IS NULL OR l.${sqlId("totalCost")} <> 0)
      )
      OR EXISTS (SELECT 1 FROM ${sqlId("StockMovement")} m WHERE m.${sqlId("refType")} = 'VENDOR_RETURN' AND m.${sqlId("refId")} = d.${sqlId("id")} AND m.${sqlId("totalCost")} <> 0)
    )`,
    opsi,
  });
}

export function cariBiayaPerjalananTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ExpenseClaim",
    sourceType: SUMBER_OPERASIONAL.BIAYA_PERJALANAN,
    tanggal: Prisma.sql`COALESCE(d.${sqlId("reviewedAt")}, d.${sqlId("spentAt")})`,
    kolomLabel: "category",
    syarat: Prisma.sql`AND d.${sqlId("status")} IN ('DISETUJUI', 'DIBAYAR') AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

export function cariBayarBiayaPerjalananTanpaJurnal(opsi: OpsiCariSapuan) {
  return cariTanpaJurnalSql({
    tabel: "ExpenseClaim",
    sourceType: SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN,
    tanggal: d("paidAt"),
    kolomLabel: "category",
    syarat: Prisma.sql`AND d.${sqlId("status")} = 'DIBAYAR' AND d.${sqlId("paidAt")} IS NOT NULL AND d.${sqlId("amount")} > 0`,
    opsi,
  });
}

/** Pencari per sumber — satu tempat untuk registri sapuan dan layar rekonsiliasi persediaan. */
export const PENCARI_OPERASIONAL: Readonly<Record<SumberOperasional, (opsi: OpsiCariSapuan) => Promise<DokumenTanpaJurnal[]>>> = {
  CONSIGNMENT_SHIPMENT: cariKirimKonsiTanpaJurnal,
  CONSIGNMENT_ORDER: cariPesananKonsiTanpaJurnal,
  CONSIGNMENT_TRANSFER: cariPindahKonsiTanpaJurnal,
  CONSIGNMENT_RETURN: cariReturKonsiTanpaJurnal,
  CONSIGNMENT_FIELD_RETURN: cariReturLapanganKonsiTanpaJurnal,
  CONSIGNMENT_CYCLE: cariSiklusKonsiTanpaJurnal,
  CONSIGNMENT_COMMISSION: cariKomisiKonsiTanpaJurnal,
  CONSIGNMENT_COMMISSION_PAYMENT: cariBayarGajiKonsiTanpaJurnal,
  CONSIGNMENT_PAYMENT: cariBayarTokoKonsiTanpaJurnal,
  SPG_COMMISSION: cariKomisiSpgTanpaJurnal,
  SPG_COMMISSION_PAYMENT: cariBayarKomisiSpgTanpaJurnal,
  STOCK_LOSS: cariBarangHilangTanpaJurnal,
  LOSS_SALES_DEDUCTION: cariPotongSalesTanpaJurnal,
  DAMAGED_STOCK: cariGudangRusakTanpaJurnal,
  STOCK_ADJUSTMENT: cariStokManualTanpaJurnal,
  VENDOR_RETURN: cariReturPemasokTanpaJurnal,
  TRAVEL_CLAIM: cariBiayaPerjalananTanpaJurnal,
  TRAVEL_CLAIM_PAYMENT: cariBayarBiayaPerjalananTanpaJurnal,
};

/**
 * Hasil untuk registri sapuan. Kegagalan yang tidak punya kode di tipe hasil
 * registri SUDAH dicatat sebagai `JOURNAL_PENDING` oleh
 * `postingJurnalOperasionalAman`, lalu dilempar supaya runner mencatatnya per
 * dokumen — tidak pernah dipetakan ke kode lain yang artinya berbeda.
 */
async function postingSapuan(sumber: SumberOperasional, id: string, olehUserId: string): Promise<GenerateAutoJournalResult> {
  const r = await postingJurnalOperasionalAman(sumber, id, olehUserId);
  if (r.ok) return r.journalId ? { ok: true, journalId: r.journalId, created: r.created } : { ok: false, code: "NOTHING_TO_POST" };
  switch (r.code) {
    case "UNMAPPED_ROLE":
      return { ok: false, code: "UNMAPPED_ROLE", ...(r.role ? { role: r.role } : {}) };
    case "UNBALANCED":
      return { ok: false, code: "UNBALANCED" };
    case "NOTHING_TO_POST":
    case "BELUM_BERLAKU":
    case "GL_CUTOVER_NOT_CONFIGURED":
      return { ok: false, code: "NOTHING_TO_POST" };
    default:
      throw new Error(`Jurnal ${sumber} ${id} gagal: ${r.code}${r.detail ? ` (${r.detail})` : ""}`);
  }
}

const LABEL_SAPUAN: Readonly<Record<SumberOperasional, string>> = {
  CONSIGNMENT_SHIPMENT: "Kiriman titipan konsinyasi",
  CONSIGNMENT_ORDER: "Pesanan konsinyasi lama (stok pindah saat disetujui)",
  CONSIGNMENT_TRANSFER: "Pindah barang konsinyasi (pengiriman selesai)",
  CONSIGNMENT_RETURN: "Retur toko konsinyasi (NRI)",
  CONSIGNMENT_FIELD_RETURN: "Retur lapangan toko konsinyasi (disetujui)",
  CONSIGNMENT_CYCLE: "Penjualan siklus konsinyasi",
  CONSIGNMENT_COMMISSION: "Gaji & komisi SPG konsinyasi",
  CONSIGNMENT_COMMISSION_PAYMENT: "Pembayaran gaji SPG konsinyasi",
  CONSIGNMENT_PAYMENT: "Pembayaran toko konsinyasi",
  SPG_COMMISSION: "Komisi SPG toko putus",
  SPG_COMMISSION_PAYMENT: "Pembayaran komisi SPG toko putus",
  STOCK_LOSS: "Barang hilang di toko konsinyasi",
  LOSS_SALES_DEDUCTION: "Potongan beban barang hilang sales",
  DAMAGED_STOCK: "Keputusan gudang barang rusak",
  STOCK_ADJUSTMENT: "Penyesuaian stok manual",
  VENDOR_RETURN: "Retur ke pemasok",
  TRAVEL_CLAIM: "Biaya perjalanan disetujui",
  TRAVEL_CLAIM_PAYMENT: "Pembayaran biaya perjalanan",
};

for (const sumber of Object.values(SUMBER_OPERASIONAL)) {
  daftarkanSumberSapuan({
    sourceType: sumber,
    label: LABEL_SAPUAN[sumber],
    cariTanpaJurnal: PENCARI_OPERASIONAL[sumber],
    posting: (id, olehUserId) => postingSapuan(sumber, id, olehUserId),
  });
}

export type DokumenOperasionalTanpaJurnal = { sumber: SumberOperasional; id: string; tanggal: string; label: string };

/**
 * Dokumen operasional tanpa jurnal sejak tanggal mulai buku besar, `batas` per
 * jenis (layar rekonsiliasi persediaan). Tanpa tanggal mulai: kosong.
 */
export async function dokumenOperasionalTanpaJurnal(batas: number, sampai = new Date()): Promise<DokumenOperasionalTanpaJurnal[]> {
  const mulai = await readGlCutover();
  if (!mulai || mulai.getTime() > sampai.getTime()) return [];
  const opsi = { sejak: mulai, sampai, batas };
  const hasil: DokumenOperasionalTanpaJurnal[] = [];
  for (const sumber of Object.values(SUMBER_OPERASIONAL)) {
    try {
      for (const dok of await PENCARI_OPERASIONAL[sumber](opsi)) {
        hasil.push({ sumber, id: dok.id, tanggal: dok.tanggal.toISOString(), label: dok.label });
      }
    } catch (e) {
      console.error(`[jurnal-operasional] pencari ${NAMA_SUMBER_OPERASIONAL[sumber]} gagal`, e);
    }
  }
  return hasil;
}
