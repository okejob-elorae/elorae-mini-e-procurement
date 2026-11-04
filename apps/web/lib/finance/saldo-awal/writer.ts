import { prisma, Prisma, postJournal, JournalError, moveMainStock, type StockLedgerRefType } from "@elorae/db";
import { withRetry } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import type { PostingRole } from "@/lib/constants/journal-roles";
import {
  JEJAK_SALDO_AWAL,
  PERAN_MILIK_JENIS_LAIN,
  STATUS_SALDO_AWAL,
  SUMBER_JURNAL_SALDO_AWAL,
  TIPE_AKUN_SALDO_AWAL,
  bacaIsian,
  idSumberBalik,
  kunciJenis,
  uraianJurnalSaldoAwal,
  type EntriAkun,
  type EntriHutang,
  type EntriPersediaan,
  type EntriPiutangMarketplace,
  type EntriPiutangToko,
  type IsiSaldoAwal,
  type JenisSaldoAwal,
  type RingkasanIsian,
} from "./jenis";
import { BATAS_CATATAN, adaKoreksi, gabungDenganHitungan, periksaIsian, type KodeGalatIsian } from "./validasi";
import {
  barisBertandaAkun,
  barisBertandaHutang,
  barisBertandaPersediaan,
  barisBertandaPiutangMarketplace,
  barisBertandaPiutangToko,
  dariSen,
  keSen,
  susunJurnalSaldoAwal,
  type BarisBertanda,
} from "./jurnal";
import { periodeTertutupSejak, tanggalJurnalSaldoAwal } from "./tanggal";
import { pratinjauPersediaan, type BarisPratinjauPersediaan, type BarisStok } from "./persediaan";
import { hitungHutangPemasokAwal, hitungPiutangMarketplaceAwal, hitungPiutangTokoAwal } from "./hitung-queries";

/*
 * Penulis saldo awal. Satu `OpeningBalanceImport` BERLAKU per jenis; memposting
 * (ulang) di dalam SATU transaksi serializable:
 *   1. membalik jurnal posting lama (baris persis kebalikannya, bertanggal sama,
 *      `reversalOfId`) dan menandainya REVERSED,
 *   2. memposting jurnal baru `OPENING` bertanggal sehari sebelum tanggal mulai,
 *      lawan `OPENING_EQUITY`,
 *   3. (persediaan) mengisi `avgCost`/`totalValue` stok TANPA mengubah qty — lewat
 *      `moveMainStock` (qty 0), jadi kartu stok mencatat penilaian ulangnya,
 *   4. menulis jejak `AuditLog` keduanya.
 * Ditolak selama periode jurnal itu (atau sesudahnya) sudah ditutup — dibaca
 * langsung dari `AccountingPeriod`/`AccountingYear`.
 */

export type KodeGalatSaldoAwal =
  | KodeGalatIsian
  | "TANPA_TANGGAL_MULAI"
  | "PERIODE_TERTUTUP"
  | "PERAN_BELUM_DIPETAKAN"
  | "AKUN_TIDAK_SAH"
  | "AKUN_MILIK_JENIS_LAIN"
  | "BARANG_TIDAK_DIKENAL"
  | "PEMASOK_TIDAK_DIKENAL"
  | "ALASAN_KOREKSI_WAJIB"
  | "CATATAN_TERLALU_PANJANG"
  | "AKUN_TIDAK_BISA_DIPOSTING"
  | "TANPA_DRAF";

export type GagalSaldoAwal = {
  ok: false;
  kode: KodeGalatSaldoAwal;
  baris?: number;
  peran?: string;
  /** "YYYY-MM" atau "YYYY" periode tertutup. */
  periode?: string;
  /** Kode akun / SKU / nama yang ditolak. */
  rincian?: string;
};

export type HasilPostingSaldoAwal =
  | { ok: true; importId: string; journalId: string | null; jurnalBalikId: string | null; ekuitas: number }
  | GagalSaldoAwal;

/** Hanya untuk tes: ruang nama jenis, tanggal mulai, dan cakupan hitungan. */
export type OpsiUjiSaldoAwal = {
  ruang: string;
  tanggalMulai: Date;
  lingkup?: { storeIds?: string[]; orderIds?: string[]; grnIds?: string[] };
};

class Tolak extends Error {
  constructor(public galat: GagalSaldoAwal) {
    super(galat.kode);
  }
}

function tolak(kode: KodeGalatSaldoAwal, lain: Omit<GagalSaldoAwal, "ok" | "kode"> = {}): never {
  throw new Tolak({ ok: false, kode, ...lain });
}

async function jalankan<T>(cb: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withRetry(() =>
    prisma.$transaction(cb, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      // Persediaan bisa memperbarui ribuan baris stok dalam satu transaksi.
      timeout: 120_000,
    }),
  );
}

async function bacaTanggalMulai(uji?: OpsiUjiSaldoAwal): Promise<{ mulai: Date; teks: string } | null> {
  const mulai = uji ? uji.tanggalMulai : await readGlCutover();
  return mulai ? { mulai, teks: formatDateOnlyJakarta(mulai) } : null;
}

function periksaCatatan(catatan: string | null | undefined): string | null | "TERLALU_PANJANG" {
  const c = (catatan ?? "").trim();
  if (!c) return null;
  return c.length > BATAS_CATATAN ? "TERLALU_PANJANG" : c;
}

// ── Draf ────────────────────────────────────────────────────────────────────

export async function simpanDrafSaldoAwal(input: {
  jenis: JenisSaldoAwal;
  baris: unknown;
  catatan?: string | null;
  namaBerkas?: string | null;
  olehUserId: string;
  uji?: OpsiUjiSaldoAwal;
}): Promise<{ ok: true; importId: string } | GagalSaldoAwal> {
  if (input.jenis === "AR_STORE") return { ok: false, kode: "ISIAN_TIDAK_SAH" };
  const periksa = periksaIsian(input.jenis, input.baris);
  if (!periksa.ok) return { ok: false, kode: periksa.kode, ...(periksa.baris ? { baris: periksa.baris } : {}) };
  const catatan = periksaCatatan(input.catatan);
  if (catatan === "TERLALU_PANJANG") return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  const mulai = await bacaTanggalMulai(input.uji);
  if (!mulai) return { ok: false, kode: "TANPA_TANGGAL_MULAI" };

  const kunci = kunciJenis(input.jenis, input.uji?.ruang);
  const isi: IsiSaldoAwal = { versi: 1, baris: periksa.baris };
  const importId = await jalankan(async (tx) => {
    const draf = await tx.openingBalanceImport.findFirst({
      where: { kind: kunci, status: STATUS_SALDO_AWAL.DRAF },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    const data = {
      cutoverDate: mulai.mulai,
      entries: isi as unknown as Prisma.InputJsonValue,
      note: catatan,
      fileName: input.namaBerkas?.slice(0, 191) ?? null,
    };
    const rec = draf
      ? await tx.openingBalanceImport.update({ where: { id: draf.id }, data, select: { id: true } })
      : await tx.openingBalanceImport.create({
          data: { ...data, kind: kunci, status: STATUS_SALDO_AWAL.DRAF, createdById: input.olehUserId },
          select: { id: true },
        });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_SALDO_AWAL.DRAF,
        entityType: "OpeningBalanceImport",
        entityId: rec.id,
        metadata: { jenis: input.jenis, baris: periksa.baris.length, tanggalMulai: mulai.teks },
      },
    });
    return rec.id;
  });
  return { ok: true, importId };
}

export async function hapusDrafSaldoAwal(input: {
  jenis: JenisSaldoAwal;
  olehUserId: string;
  uji?: Pick<OpsiUjiSaldoAwal, "ruang">;
}): Promise<{ ok: true; dihapus: number } | GagalSaldoAwal> {
  const kunci = kunciJenis(input.jenis, input.uji?.ruang);
  return jalankan(async (tx) => {
    const draf = await tx.openingBalanceImport.findMany({
      where: { kind: kunci, status: STATUS_SALDO_AWAL.DRAF },
      select: { id: true },
    });
    if (draf.length === 0) return { ok: false as const, kode: "TANPA_DRAF" as const };
    for (const d of draf) {
      await tx.openingBalanceImport.delete({ where: { id: d.id } });
      await tx.auditLog.create({
        data: {
          userId: input.olehUserId,
          action: JEJAK_SALDO_AWAL.DRAF_DIHAPUS,
          entityType: "OpeningBalanceImport",
          entityId: d.id,
          metadata: { jenis: input.jenis },
        },
      });
    }
    return { ok: true as const, dihapus: draf.length };
  });
}

// ── Posting ─────────────────────────────────────────────────────────────────

type Hitungan = {
  AR_STORE?: EntriPiutangToko[];
  AR_MARKETPLACE?: EntriPiutangMarketplace[];
  AP?: EntriHutang[];
};

/**
 * Bagian per jenis yang berjalan di dalam transaksi: isian final + baris bertanda.
 * `penilaianUlang` = baris stok persediaan yang HPP/nilainya berubah; ditulis
 * sesudah catatan impornya ada, karena id catatan itulah rujukan kartu stoknya.
 */
type HasilJenis = {
  baris: unknown[];
  bertanda: BarisBertanda[];
  ringkasanPersediaan?: Record<"INVENTORY" | "INVENTORY_FG", number>;
  penilaianUlang?: BarisPratinjauPersediaan[];
};

async function siapkanAkun(tx: Prisma.TransactionClient, baris: EntriAkun[], akunEkuitas: string): Promise<HasilJenis> {
  const ids = baris.map((b) => b.akunId);
  const akun = ids.length
    ? await tx.chartAccount.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, type: true, isActive: true } })
    : [];
  const perId = new Map(akun.map((a) => [a.id, a]));
  const anak = ids.length ? await tx.chartAccount.findMany({ where: { parentId: { in: ids } }, select: { parentId: true } }) : [];
  const induk = new Set(anak.map((a) => a.parentId));
  for (let i = 0; i < baris.length; i++) {
    const a = perId.get(baris[i].akunId);
    if (!a) tolak("AKUN_TIDAK_SAH", { baris: i + 1 });
    if (!a.isActive || induk.has(a.id) || !(TIPE_AKUN_SALDO_AWAL as readonly string[]).includes(a.type)) {
      tolak("AKUN_TIDAK_SAH", { baris: i + 1, rincian: a.code });
    }
    if (a.id === akunEkuitas) tolak("AKUN_MILIK_JENIS_LAIN", { baris: i + 1, rincian: a.code, peran: "OPENING_EQUITY" });
  }
  const milikLain = ids.length
    ? await tx.journalAccountMapping.findMany({
        where: { chartAccountId: { in: ids }, role: { in: [...PERAN_MILIK_JENIS_LAIN] } },
        select: { role: true, chartAccountId: true },
      })
    : [];
  if (milikLain.length > 0) {
    const m = milikLain[0];
    tolak("AKUN_MILIK_JENIS_LAIN", { rincian: perId.get(m.chartAccountId)?.code, peran: m.role });
  }
  const final = baris.map((b) => ({ ...b, kode: perId.get(b.akunId)!.code, nama: perId.get(b.akunId)!.name }));
  return { baris: final, bertanda: barisBertandaAkun(final) };
}

async function siapkanPersediaan(
  tx: Prisma.TransactionClient,
  baris: EntriPersediaan[],
  lama: RingkasanIsian | undefined,
): Promise<HasilJenis> {
  const itemIds = [...new Set(baris.map((b) => b.itemId))];
  const rows = itemIds.length
    ? await tx.inventoryValue.findMany({
        where: { itemId: { in: itemIds } },
        select: {
          id: true,
          itemId: true,
          variantSku: true,
          qtyOnHand: true,
          avgCost: true,
          totalValue: true,
          item: { select: { sku: true, nameId: true, type: true } },
        },
      })
    : [];
  const stok: BarisStok[] = rows.map((r) => ({
    ivId: r.id,
    itemId: r.itemId,
    skuBarang: r.item.sku,
    variantSku: r.variantSku,
    nama: r.item.nameId,
    tipe: r.item.type,
    qty: Number(r.qtyOnHand),
    avgCost: Number(r.avgCost),
    totalValue: Number(r.totalValue),
  }));
  const p = pratinjauPersediaan(baris, stok);
  if (p.tidakDikenal.length > 0) tolak("BARANG_TIDAK_DIKENAL", { rincian: p.tidakDikenal[0].sku });

  const penilaianUlang = p.baris.filter(
    (b) => keSen(b.hppLama) !== keSen(b.hppBaru) || keSen(b.nilaiLama) !== keSen(b.nilaiBaru),
  );

  // Nilai jurnal KUMULATIF: nilai posting lama (yang dibalik) + selisih kali ini.
  const kumulatif = {
    INVENTORY: keSen(lama?.nilaiPerPeran?.INVENTORY ?? 0) + p.selisihPerPeranSen.INVENTORY,
    INVENTORY_FG: keSen(lama?.nilaiPerPeran?.INVENTORY_FG ?? 0) + p.selisihPerPeranSen.INVENTORY_FG,
  };
  const final: EntriPersediaan[] = p.baris.map((b) => ({
    itemId: b.itemId,
    variantSku: b.variantSku,
    hpp: b.hppBaru,
    sku: b.sku,
    nama: b.nama,
    qty: b.qty,
    hppLama: b.hppLama,
    nilaiLama: b.nilaiLama,
    nilaiBaru: b.nilaiBaru,
  }));
  return { baris: final, bertanda: barisBertandaPersediaan(kumulatif), ringkasanPersediaan: kumulatif, penilaianUlang };
}

/**
 * HPP baru ke baris stok, qty tetap. Lewat `moveMainStock` dengan qty 0 (entri
 * ADJUSTMENT), bukan tulis langsung: kartu stok menilai stok dari saldo nilai
 * entri terakhirnya, jadi tanpa entri ini kartu stok tetap menunjukkan nilai
 * lama — berbeda dari `InventoryValue` dan dari jurnal OPENING yang baru
 * diposting — sampai gerakan berikutnya melompatinya tanpa baris penjelas.
 * `inventoryValueId` mengunci tulisan ke baris yang dinilai pratinjau (barang
 * dengan baris kembar null/"" dinilai per baris).
 */
async function tulisPenilaianUlang(
  tx: Prisma.TransactionClient,
  baris: BarisPratinjauPersediaan[],
  importId: string,
  olehUserId: string,
): Promise<void> {
  for (const b of baris) {
    await moveMainStock(tx, {
      itemId: b.itemId,
      variantSku: b.variantSku,
      qtyDelta: 0,
      inventoryValueId: b.ivId,
      avgCost: b.hppBaru,
      totalValue: b.nilaiBaru,
      unitCost: b.hppBaru,
      totalCost: dariSen(keSen(b.nilaiBaru) - keSen(b.nilaiLama)),
      balanceValue: b.nilaiBaru,
      refType: "OpeningBalance" satisfies StockLedgerRefType,
      refId: importId,
      createdById: olehUserId,
    });
  }
}

export async function postingSaldoAwal(input: {
  jenis: JenisSaldoAwal;
  baris: unknown;
  catatan?: string | null;
  namaBerkas?: string | null;
  olehUserId: string;
  uji?: OpsiUjiSaldoAwal;
}): Promise<HasilPostingSaldoAwal> {
  const { jenis } = input;
  const periksa = periksaIsian(jenis, input.baris);
  if (!periksa.ok) return { ok: false, kode: periksa.kode, ...(periksa.baris ? { baris: periksa.baris } : {}) };
  const catatan = periksaCatatan(input.catatan);
  if (catatan === "TERLALU_PANJANG") return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  const mulai = await bacaTanggalMulai(input.uji);
  if (!mulai) return { ok: false, kode: "TANPA_TANGGAL_MULAI" };
  const teksJurnal = tanggalJurnalSaldoAwal(mulai.teks);
  const tanggalJurnal = parseDateOnly(teksJurnal)!;
  const lingkup = input.uji?.lingkup ?? {};

  // Hitungan modul dibaca DI LUAR transaksi: ribuan pesanan/faktur di dalam
  // transaksi serializable hanya mengundang konflik dengan penulis operasional.
  const hitungan: Hitungan = {};
  if (jenis === "AR_STORE") hitungan.AR_STORE = await hitungPiutangTokoAwal(mulai.mulai, { storeIds: lingkup.storeIds });
  if (jenis === "AR_MARKETPLACE") hitungan.AR_MARKETPLACE = await hitungPiutangMarketplaceAwal(mulai.mulai, { orderIds: lingkup.orderIds });
  if (jenis === "AP") hitungan.AP = await hitungHutangPemasokAwal(mulai.mulai, { grnIds: lingkup.grnIds });

  let koreksi = false;
  let barisMp: EntriPiutangMarketplace[] = [];
  let barisAp: EntriHutang[] = [];
  if (jenis === "AR_MARKETPLACE") {
    barisMp = gabungDenganHitungan(hitungan.AR_MARKETPLACE!, periksa.baris as EntriPiutangMarketplace[], (b) => b.kanal);
    koreksi = adaKoreksi(barisMp);
  }
  if (jenis === "AP") {
    barisAp = gabungDenganHitungan(hitungan.AP!, periksa.baris as EntriHutang[], (b) => b.supplierId);
    koreksi = adaKoreksi(barisAp);
  }
  if (koreksi && !catatan) return { ok: false, kode: "ALASAN_KOREKSI_WAJIB" };

  const kunci = kunciJenis(jenis, input.uji?.ruang);
  try {
    return await jalankan(async (tx) => {
      const lama = await tx.openingBalanceImport.findFirst({
        where: { kind: kunci, status: STATUS_SALDO_AWAL.DIPOSTING },
        orderBy: { postedAt: "desc" },
      });
      const jurnalLama = lama?.journalId
        ? await tx.journal.findUnique({ where: { id: lama.journalId }, include: { lines: true } })
        : null;

      // Kunci periode: tanggal jurnal baru DAN tanggal jurnal yang akan dibalik.
      const tanggalCek = [teksJurnal, ...(jurnalLama ? [formatDateOnlyJakarta(jurnalLama.date)] : [])].sort()[0];
      const [periode, tahun] = await Promise.all([
        tx.accountingPeriod.findMany({ where: { status: "CLOSED" }, select: { year: true, month: true, status: true } }),
        tx.accountingYear.findMany({ where: { status: "CLOSED" }, select: { year: true, status: true } }),
      ]);
      const tertutup = periodeTertutupSejak(tanggalCek, periode, tahun);
      if (tertutup) {
        tolak("PERIODE_TERTUTUP", {
          periode: tertutup.bulan === null ? String(tertutup.tahun) : `${tertutup.tahun}-${String(tertutup.bulan).padStart(2, "0")}`,
        });
      }

      const akunPeran = new Map<PostingRole, string>();
      const akunUntuk = async (peran: PostingRole): Promise<string> => {
        const ada = akunPeran.get(peran);
        if (ada) return ada;
        const id = await resolveAccount(peran, tx);
        akunPeran.set(peran, id);
        return id;
      };
      const akunEkuitas = await akunUntuk("OPENING_EQUITY");

      let disiapkan: HasilJenis;
      switch (jenis) {
        case "ACCOUNTS":
          disiapkan = await siapkanAkun(tx, periksa.baris as EntriAkun[], akunEkuitas);
          break;
        case "INVENTORY":
          disiapkan = await siapkanPersediaan(tx, periksa.baris as EntriPersediaan[], lama ? bacaIsian(lama.entries).ringkasan : undefined);
          break;
        case "AR_STORE":
          disiapkan = { baris: hitungan.AR_STORE!, bertanda: barisBertandaPiutangToko(hitungan.AR_STORE!) };
          break;
        case "AR_MARKETPLACE":
          disiapkan = { baris: barisMp, bertanda: barisBertandaPiutangMarketplace(barisMp) };
          break;
        case "AP": {
          const ids = barisAp.map((b) => b.supplierId);
          const pemasok = ids.length
            ? await tx.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } })
            : [];
          const perId = new Map(pemasok.map((s) => [s.id, s]));
          const hilang = barisAp.find((b) => !perId.has(b.supplierId));
          if (hilang) tolak("PEMASOK_TIDAK_DIKENAL", { rincian: hilang.supplierId });
          barisAp = barisAp.map((b) => ({ ...b, kode: perId.get(b.supplierId)!.code, nama: perId.get(b.supplierId)!.name }));
          disiapkan = { baris: barisAp, bertanda: barisBertandaHutang(barisAp) };
          break;
        }
      }

      const jurnal = susunJurnalSaldoAwal(disiapkan.bertanda);

      // Satu catatan per jenis: draf (bila ada) menjadi posting ini.
      const draf = await tx.openingBalanceImport.findFirst({
        where: { kind: kunci, status: STATUS_SALDO_AWAL.DRAF },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      const ringkasan: RingkasanIsian = {
        ekuitas: dariSen(jurnal.ekuitasSen),
        tanggalMulai: mulai.teks,
        ...(disiapkan.ringkasanPersediaan
          ? {
              nilaiPerPeran: {
                INVENTORY: dariSen(disiapkan.ringkasanPersediaan.INVENTORY),
                INVENTORY_FG: dariSen(disiapkan.ringkasanPersediaan.INVENTORY_FG),
              },
            }
          : {}),
      };
      const isi = { versi: 1, baris: disiapkan.baris, ringkasan } as unknown as Prisma.InputJsonValue;
      const dataDasar = {
        cutoverDate: mulai.mulai,
        entries: isi,
        totalAmount: dariSen(jurnal.ekuitasSen),
        note: catatan,
        ...(input.namaBerkas !== undefined ? { fileName: input.namaBerkas?.slice(0, 191) ?? null } : {}),
      };
      const rec = draf
        ? await tx.openingBalanceImport.update({ where: { id: draf.id }, data: dataDasar, select: { id: true } })
        : await tx.openingBalanceImport.create({
            data: { ...dataDasar, kind: kunci, status: STATUS_SALDO_AWAL.DRAF, createdById: input.olehUserId },
            select: { id: true },
          });

      // 1. Balik posting lama.
      let jurnalBalikId: string | null = null;
      if (lama) {
        if (jurnalLama) {
          const balik = await postJournal(tx, {
            source: { type: SUMBER_JURNAL_SALDO_AWAL, id: idSumberBalik(lama.id) },
            reversalOfId: jurnalLama.id,
            date: jurnalLama.date,
            // Saldo awal tidak boleh digeser keluar dari tanggalnya: periode tertutup → tolak.
            closedPeriod: "refuse",
            description: `Pembalikan ${jurnalLama.description}`.slice(0, 191),
            postedById: input.olehUserId,
            lines: jurnalLama.lines.map((l) => ({
              chartAccountId: l.chartAccountId,
              debit: Number(l.credit),
              credit: Number(l.debit),
              memo: l.memo ?? undefined,
              channel: l.channel,
              storeId: l.storeId,
            })),
          });
          jurnalBalikId = balik.journalId;
        }
        await tx.openingBalanceImport.update({ where: { id: lama.id }, data: { status: STATUS_SALDO_AWAL.DIBALIK } });
        await tx.auditLog.create({
          data: {
            userId: input.olehUserId,
            action: JEJAK_SALDO_AWAL.DIBALIK,
            entityType: "OpeningBalanceImport",
            entityId: lama.id,
            changes: { status: { sebelum: STATUS_SALDO_AWAL.DIPOSTING, sesudah: STATUS_SALDO_AWAL.DIBALIK } },
            metadata: { jenis, journalId: lama.journalId, jurnalBalikId, digantiOleh: rec.id },
            reason: catatan,
          },
        });
      }

      // 2. Posting baru.
      let journalId: string | null = null;
      if (jurnal.baris.length > 0) {
        const lines = [];
        for (const b of jurnal.baris) {
          lines.push({
            chartAccountId: b.peran ? await akunUntuk(b.peran) : b.akunId!,
            debit: b.debit,
            credit: b.kredit,
            ...(b.memo ? { memo: b.memo.slice(0, 191) } : {}),
            ...(b.channel ? { channel: b.channel } : {}),
            ...(b.storeId ? { storeId: b.storeId } : {}),
          });
        }
        const res = await postJournal(tx, {
          source: { type: SUMBER_JURNAL_SALDO_AWAL, id: rec.id },
          date: tanggalJurnal,
          closedPeriod: "refuse",
          description: uraianJurnalSaldoAwal(jenis, mulai.teks),
          postedById: input.olehUserId,
          lines,
        });
        journalId = res.journalId;
      }

      // 3. Persediaan: HPP baru ke baris stok, dicatat di kartu stok atas catatan ini.
      if (disiapkan.penilaianUlang?.length) {
        await tulisPenilaianUlang(tx, disiapkan.penilaianUlang, rec.id, input.olehUserId);
      }

      await tx.openingBalanceImport.update({
        where: { id: rec.id },
        data: { status: STATUS_SALDO_AWAL.DIPOSTING, journalId, postedAt: new Date(), postedById: input.olehUserId },
      });
      await tx.auditLog.create({
        data: {
          userId: input.olehUserId,
          action: JEJAK_SALDO_AWAL.DIPOSTING,
          entityType: "OpeningBalanceImport",
          entityId: rec.id,
          changes: lama ? { ekuitas: { sebelum: Number(lama.totalAmount), sesudah: dariSen(jurnal.ekuitasSen) } } : undefined,
          metadata: {
            jenis,
            tanggalMulai: mulai.teks,
            tanggalJurnal: teksJurnal,
            ekuitas: dariSen(jurnal.ekuitasSen),
            journalId,
            menggantikan: lama?.id ?? null,
            baris: disiapkan.baris.length,
            dikoreksi: koreksi,
          },
          reason: catatan,
        },
      });

      return { ok: true as const, importId: rec.id, journalId, jurnalBalikId, ekuitas: dariSen(jurnal.ekuitasSen) };
    });
  } catch (e) {
    if (e instanceof Tolak) return e.galat;
    if (e instanceof UnmappedRoleError) return { ok: false, kode: "PERAN_BELUM_DIPETAKAN", peran: e.role };
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "AKUN_TIDAK_BISA_DIPOSTING" };
    // Penjaga periode di `postJournal` (bagian tutup buku) — kode string supaya
    // tidak bergantung pada urutan penggabungan.
    if (e instanceof JournalError && (e.code as string) === "PERIOD_CLOSED") return { ok: false, kode: "PERIODE_TERTUTUP" };
    throw e;
  }
}
