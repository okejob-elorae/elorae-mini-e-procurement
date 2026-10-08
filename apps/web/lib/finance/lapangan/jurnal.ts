import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal } from "@/lib/finance/journal";
import { bacaPengaturanPpn } from "@/lib/finance/pajak/ppn-pengaturan";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { potonganRetur } from "@/lib/receivables/deductions";
import { idBebanDariCatatan, penandaBebanRetur } from "@/lib/receivables/penanda-beban";
import { returTertahan } from "@/lib/receivables/rules";
import {
  barisKlaim,
  barisNota,
  barisRetur,
  barisTukar,
  gabungBaris,
  keBarisJurnal,
  nilaiReturBukuBesar,
  peranPotongan,
  SUMBER_LAPANGAN,
  tanggalJurnalKlaim,
  type BarisBertanda,
  type NilaiReturBukuBesar,
  type SumberLapangan,
} from "./aturan";
import { selaraskanJurnal, type HasilSelaras } from "./selaras";

/*
 * Penulis jurnal penjualan lapangan & piutang toko — KHUSUS SERVER. Aturannya
 * di `aturan.ts`. Dipanggil SESUDAH dokumennya di-commit (lewat `kait.ts`,
 * sapuan, atau tombol posting ulang); tidak pernah dari dalam transaksi
 * dokumen, dan tidak pernah mengubah logika uang modul piutang — hanya membaca
 * hasilnya.
 *
 * GERBANG TANGGAL MULAI. Dokumen yang tanggalnya sebelum `finance.glCutoverDate`
 * sudah tercakup saldo awal (piutang toko awal = sisa modul per tanggal mulai),
 * jadi tidak dijurnal lagi; tanpa tanggal mulai tidak ada yang dijurnal (sama
 * dengan sapuan penjualan marketplace). Dokumen yang sudah berjurnal tetap
 * diselaraskan walau tanggal mulai digeser kemudian.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

export type KodeGagalLapangan =
  | "UNMAPPED_ROLE"
  | "UNBALANCED"
  /** Nilai nol — tidak ada yang dijurnal. */
  | "NOTHING_TO_POST"
  /** Belum boleh dijurnal: sebelum tanggal mulai buku besar, atau belum final. */
  | "BELUM_BERLAKU"
  | "GL_CUTOVER_NOT_CONFIGURED"
  /** Biaya barang yang keluar tidak ditemukan di kartu stok (nota lama tanpa penyesuaian stok). */
  | "BIAYA_TIDAK_DIKETAHUI";

export type HasilJurnalLapangan =
  | { ok: true; journalId: string | null; created: boolean }
  | { ok: false; code: KodeGagalLapangan; role?: string; detail?: string };

/** Kode yang bukan kegagalan — tidak menulis `JOURNAL_PENDING`. */
export const KODE_BUKAN_GAGAL: ReadonlySet<KodeGagalLapangan> = new Set(["NOTHING_TO_POST", "BELUM_BERLAKU", "GL_CUTOVER_NOT_CONFIGURED"]);

const angka = (v: unknown): number => Number(v ?? 0);

/** Dokumen bertanggal `tanggal` boleh dijurnal pertama kali? */
function bolehMulai(mulai: Date | null, tanggal: Date): boolean {
  return mulai !== null && tanggal.getTime() >= mulai.getTime();
}

function dariSelaras(r: HasilSelaras, adaCutover: boolean): HasilJurnalLapangan {
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.berubah };
  if (r.code === "BELUM_BERLAKU") return { ok: false, code: adaCutover ? "BELUM_BERLAKU" : "GL_CUTOVER_NOT_CONFIGURED" };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

// ── Nota tagihan putus (sekali posting) ─────────────────────────────────────

/** Kunci penyesuaian stok pengiriman putus (`consumeFieldSalesOrderPartial`). */
export function kunciStokPengiriman(orderNo: string, deliveryId: string, orderLineId: string): string {
  return `fieldsales-${orderNo}-delivery-${deliveryId}-line-${orderLineId}`;
}

/** Kunci konsumsi lama saat disetujui (sebelum ada pengiriman bertahap; nota backfill). */
export function kunciStokPersetujuan(orderNo: string, orderLineId: string): string {
  return `fieldsales-${orderNo}-consume-line-${orderLineId}`;
}

export type BahanNota = {
  docNo: string;
  storeId: string;
  storeName: string;
  invoiceDate: Date;
  total: number;
  putus: boolean;
  hpp: { tipeBarang: string | null; nilai: number }[];
  /** Baris yang biaya keluarnya tidak ditemukan. */
  tanpaBiaya: string[];
};

/**
 * Biaya yang keluar = qty × harga rata-rata yang dipakai penyesuaian stoknya
 * (`prevAvgCost`), persis nilai yang turun di kartu stok. Nota backfill (dari
 * konsumsi saat disetujui) memakai harga per unit penyesuaian persetujuan.
 */
export async function bacaBahanNota(client: Klien, deliveryId: string): Promise<BahanNota | null> {
  const d = await client.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      docNo: true,
      invoiceDate: true,
      total: true,
      order: { select: { orderNo: true, orderType: true, storeId: true, store: { select: { name: true } } } },
      lines: { select: { orderLineId: true, qty: true, productName: true, item: { select: { type: true } } } },
    },
  });
  if (!d) return null;
  const kunci = d.lines.flatMap((l) => [
    kunciStokPengiriman(d.order.orderNo, deliveryId, l.orderLineId),
    kunciStokPersetujuan(d.order.orderNo, l.orderLineId),
  ]);
  const penyesuaian = kunci.length
    ? await client.stockAdjustment.findMany({ where: { idempotencyKey: { in: kunci } }, select: { idempotencyKey: true, qtyChange: true, prevAvgCost: true } })
    : [];
  const perKunci = new Map(penyesuaian.map((p) => [p.idempotencyKey!, p]));
  const hpp: BahanNota["hpp"] = [];
  const tanpaBiaya: string[] = [];
  for (const l of d.lines) {
    const kirim = perKunci.get(kunciStokPengiriman(d.order.orderNo, deliveryId, l.orderLineId));
    if (kirim) {
      hpp.push({ tipeBarang: l.item.type, nilai: Math.abs(angka(kirim.qtyChange)) * angka(kirim.prevAvgCost) });
      continue;
    }
    const setuju = perKunci.get(kunciStokPersetujuan(d.order.orderNo, l.orderLineId));
    if (setuju) {
      hpp.push({ tipeBarang: l.item.type, nilai: l.qty * angka(setuju.prevAvgCost) });
      continue;
    }
    if (l.qty > 0) tanpaBiaya.push(l.productName);
  }
  return {
    docNo: d.docNo,
    storeId: d.order.storeId,
    storeName: d.order.store.name,
    invoiceDate: d.invoiceDate,
    total: angka(d.total),
    putus: d.order.orderType === "PUTUS",
    hpp,
    tanpaBiaya,
  };
}

export async function postJurnalNota(deliveryId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalLapangan> {
  const ada = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: SUMBER_LAPANGAN.NOTA, sourceId: deliveryId } },
    select: { id: true },
  });
  if (ada) return { ok: true, journalId: ada.id, created: false };

  const b = await bacaBahanNota(client, deliveryId);
  if (!b || !b.putus) return { ok: false, code: "NOTHING_TO_POST" };
  const mulai = await readGlCutover();
  if (!mulai) return { ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" };
  if (!bolehMulai(mulai, b.invoiceDate)) return { ok: false, code: "BELUM_BERLAKU" };
  if (b.tanpaBiaya.length > 0) return { ok: false, code: "BIAYA_TIDAK_DIKETAHUI", detail: b.tanpaBiaya.join(", ") };

  const baris = barisNota({
    total: b.total,
    storeId: b.storeId,
    tanggal: b.invoiceDate,
    pengaturanPpn: await bacaPengaturanPpn(client),
    hpp: b.hpp,
  });
  if (baris.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  const r = await generateAutoJournal(client, SUMBER_LAPANGAN.NOTA, deliveryId, keBarisJurnal(baris), {
    date: b.invoiceDate,
    description: `Nota tagihan ${b.docNo} — ${b.storeName}`,
    postedById,
  });
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.created };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

// ── Pelunasan BKM (diselaraskan) ────────────────────────────────────────────

export async function selaraskanJurnalKlaim(claimId: string, postedById: string): Promise<HasilJurnalLapangan> {
  const mulai = await readGlCutover();
  const r = await selaraskanJurnal({
    sourceType: SUMBER_LAPANGAN.BKM,
    entityId: claimId,
    postedById,
    susun: async (tx) => {
      const k = await tx.paymentClaim.findUnique({
        where: { id: claimId },
        select: {
          docNo: true,
          status: true,
          method: true,
          storeId: true,
          receivedAmount: true,
          claimedTransferAt: true,
          verifiedAt: true,
          store: { select: { name: true, termsType: true } },
          deductions: {
            select: { amount: true, storeReturnId: true, deductionType: { select: { postingRole: true, pkpOnly: true } } },
          },
        },
      });
      if (!k) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Pelunasan ${claimId}` };
      const terverifikasi = k.status === "TERVERIFIKASI" && k.store.termsType !== "KONSI";
      const diverifikasi = k.verifiedAt ?? new Date();
      return {
        sasaran: barisKlaim({
          terverifikasi,
          cara: k.method,
          diterima: angka(k.receivedAmount),
          storeId: k.storeId,
          potongan: k.deductions.map((p) => ({
            nilai: angka(p.amount),
            // Penunjuk menggantung tetap retur: Aturan 2 menahannya penuh, jadi tidak pernah mengurangi piutang.
            retur: p.storeReturnId !== null,
            peran: peranPotongan(p.deductionType),
          })),
        }),
        bolehMulai: terverifikasi && bolehMulai(mulai, diverifikasi),
        tanggal: tanggalJurnalKlaim({ verifiedAt: diverifikasi, claimedTransferAt: k.claimedTransferAt, giro: k.method === "giro", mulai }),
        deskripsi: `Pelunasan ${k.docNo} — ${k.store.name}`,
      };
    },
  });
  return dariSelaras(r, mulai !== null);
}

// ── Retur toko (diselaraskan, per hitungan gudang/NRI) ──────────────────────

/** Kolom hitungan gudang yang menentukan nilai jurnal returnya. */
const PILIH_NRI = {
  id: true,
  noNri: true,
  status: true,
  storeId: true,
  physicalAmount: true,
  finalisedAt: true,
  createdAt: true,
  store: { select: { name: true, termsType: true } },
  storeReturn: {
    select: {
      id: true,
      noNrt: true,
      status: true,
      claimedAmount: true,
      storeId: true,
      store: { select: { name: true, termsType: true } },
      charges: { select: { id: true, status: true } },
      deductions: { select: { amount: true, paymentClaim: { select: { status: true } } } },
    },
  },
} as const;

type BarisNri = Prisma.WarehouseReturnGetPayload<{ select: typeof PILIH_NRI }>;

export type NilaiRetur = {
  noNri: string;
  noNrt: string | null;
  storeId: string | null;
  storeName: string | null;
  konsinyasi: boolean;
  final: boolean;
  tanggal: Date;
  nilai: NilaiReturBukuBesar;
};

/** Faktur beban selisih yang ditetapkan ke toko, per id beban (penanda di catatan faktur). */
async function fakturBebanPerBeban(client: Klien, chargeIds: string[]): Promise<Map<string, number>> {
  const hasil = new Map<string, number>();
  if (chargeIds.length === 0) return hasil;
  const ids = new Set(chargeIds);
  const faktur = await client.receivable.findMany({
    where: { source: "MANUAL", OR: chargeIds.map((id) => ({ note: { contains: penandaBebanRetur(id) } })) },
    select: { amount: true, note: true },
  });
  for (const f of faktur) {
    const id = idBebanDariCatatan(f.note);
    if (id && ids.has(id)) hasil.set(id, (hasil.get(id) ?? 0) + angka(f.amount));
  }
  return hasil;
}

/**
 * Nilai jurnal retur satu hitungan gudang. Potongan atas notanya diterjemahkan
 * lewat penerjemah modul piutang (`potonganRetur` + `returTertahan`) — satu
 * penerjemah, bukan salinan.
 */
function nilaiDariBaris(nri: BarisNri, fakturBeban: Map<string, number>): NilaiRetur {
  const nrt = nri.storeReturn && nri.storeReturn.status !== "BATAL" ? nri.storeReturn : null;
  const toko = nri.store ?? nrt?.store ?? null;
  const final = nri.status === "FINAL";
  let potonganDiakui = 0;
  let ditagihKeToko = 0;
  if (nrt && final) {
    const basis = {
      claimedAmount: nrt.claimedAmount,
      status: nrt.status,
      warehouseReturn: { physicalAmount: nri.physicalAmount, status: nri.status },
      charges: nrt.charges.map((c) => ({ status: c.status })),
    };
    for (const p of nrt.deductions) {
      if (p.paymentClaim.status !== "TERVERIFIKASI") continue;
      potonganDiakui += angka(p.amount) - returTertahan(potonganRetur([{ amount: p.amount, storeReturnId: nrt.id, storeReturn: basis }]));
    }
    for (const c of nrt.charges) ditagihKeToko += fakturBeban.get(c.id) ?? 0;
  }
  return {
    noNri: nri.noNri,
    noNrt: nri.storeReturn?.noNrt ?? null,
    storeId: nri.storeId ?? nrt?.storeId ?? null,
    storeName: toko?.name ?? null,
    konsinyasi: toko?.termsType === "KONSI",
    final,
    tanggal: nri.finalisedAt ?? nri.createdAt,
    nilai: nilaiReturBukuBesar({
      nilaiFisik: final ? angka(nri.physicalAmount) : 0,
      nilaiKlaimNota: nrt ? angka(nrt.claimedAmount) : null,
      potonganDiakui,
      ditagihKeToko,
    }),
  };
}

/** Nilai jurnal retur banyak hitungan gudang sekaligus (layar rekonsiliasi): dua kueri, bukan dua per dokumen. */
export async function bacaNilaiReturBanyak(client: Klien, nriIds: string[]): Promise<Map<string, NilaiRetur>> {
  const hasil = new Map<string, NilaiRetur>();
  if (nriIds.length === 0) return hasil;
  const rows = await client.warehouseReturn.findMany({ where: { id: { in: nriIds } }, select: PILIH_NRI });
  const faktur = await fakturBebanPerBeban(
    client,
    rows.flatMap((r) => r.storeReturn?.charges.map((c) => c.id) ?? []),
  );
  for (const r of rows) hasil.set(r.id, nilaiDariBaris(r, faktur));
  return hasil;
}

export type BahanRetur = NilaiRetur & {
  stokLayak: { tipeBarang: string | null; nilai: number }[];
  /** Barang rusak/kedaluwarsa ber-barang katalog: biaya rata-rata saat dibaca. */
  rusak: number;
};

/** Data satu hitungan gudang untuk jurnalnya. */
export async function bacaBahanRetur(client: Klien, nriId: string): Promise<BahanRetur | null> {
  const nri = await client.warehouseReturn.findUnique({
    where: { id: nriId },
    select: { ...PILIH_NRI, items: { select: { id: true, itemId: true, variantSku: true, qty: true, condition: true } } },
  });
  if (!nri) return null;
  const nilai = nilaiDariBaris(nri, await fakturBebanPerBeban(client, nri.storeReturn?.charges.map((c) => c.id) ?? []));

  // Barang layak: penyesuaian stok yang ditulis hitungan ini (`masukkanKeStok`).
  const stok = nilai.final
    ? await client.stockAdjustment.findMany({
        where: { source: "STORE_RETURN_RECEIVE", reason: { startsWith: `Retur toko ${nri.noNri} — ` } },
        select: { qtyChange: true, prevAvgCost: true, item: { select: { type: true } } },
      })
    : [];

  // Barang rusak: nilai gerakan masuk gudang barang rusak baris itu (`DamagedStockMovement.value`,
  // ditulis bersama hitungannya) — supaya buku besar = nilai gudang rusak; baris lama tanpa nilai:
  // biaya rata-rata barang × varian itu (varian persis, lalu baris tanpa varian, lalu varian mana pun).
  let rusak = 0;
  if (nilai.final) {
    const idRusak = nri.items.filter((i) => i.itemId && i.qty > 0 && i.condition !== "LAYAK").map((i) => i.id);
    const masukRusak = idRusak.length
      ? await client.damagedStockMovement.findMany({
          where: { kind: "MASUK_RETUR", refType: "WarehouseReturnItem", refId: { in: idRusak }, value: { not: null } },
          select: { refId: true, value: true },
        })
      : [];
    const nilaiMasuk = new Map(masukRusak.map((m) => [m.refId!, angka(m.value)]));
    for (const i of nri.items) {
      if (!i.itemId || !(i.qty > 0) || i.condition === "LAYAK") continue;
      const tercatat = nilaiMasuk.get(i.id);
      if (tercatat !== undefined) {
        rusak += tercatat;
        continue;
      }
      const varian = i.variantSku?.trim() ?? "";
      const baris =
        (varian ? await client.inventoryValue.findFirst({ where: { itemId: i.itemId, variantSku: varian }, select: { avgCost: true } }) : null) ??
        (await client.inventoryValue.findFirst({ where: { itemId: i.itemId, OR: [{ variantSku: null }, { variantSku: "" }] }, select: { avgCost: true } })) ??
        (await client.inventoryValue.findFirst({ where: { itemId: i.itemId }, select: { avgCost: true } }));
      rusak += i.qty * angka(baris?.avgCost);
    }
  }

  return {
    ...nilai,
    stokLayak: stok.map((s) => ({ tipeBarang: s.item.type, nilai: Math.abs(angka(s.qtyChange)) * angka(s.prevAvgCost) })),
    rusak,
  };
}

/** Biaya barang rusak yang sudah dijurnal untuk dokumen ini (dibekukan sejak jurnal pertama). */
function rusakTerposting(terposting: readonly BarisBertanda[]): number | null {
  const sen = gabungBaris(terposting.filter((b) => b.role === "INVENTORY_DAMAGED")).reduce((s, b) => s + b.sen, 0);
  return sen === 0 ? null : sen / 100;
}

export async function selaraskanJurnalRetur(nriId: string, postedById: string): Promise<HasilJurnalLapangan> {
  const mulai = await readGlCutover();
  const r = await selaraskanJurnal({
    sourceType: SUMBER_LAPANGAN.RETUR,
    entityId: nriId,
    postedById,
    susun: async (tx, terposting) => {
      const b = await bacaBahanRetur(tx, nriId);
      if (!b) return { sasaran: [], bolehMulai: false, tanggal: new Date(), deskripsi: `Retur toko ${nriId}` };
      /*
       * Biaya barang rusak tidak tersimpan di gerakan gudang rusak, jadi dibaca
       * dari harga rata-rata saat jurnal PERTAMA dibuat lalu dibekukan: generasi
       * berikutnya (keputusan beban, BKM baru) tidak boleh menggeser persediaan
       * hanya karena harga rata-ratanya sudah berubah.
       */
      const beku = rusakTerposting(terposting);
      const sasaran = barisRetur({
        konsinyasi: b.konsinyasi,
        storeId: b.storeId,
        tanggal: b.tanggal,
        pengaturanPpn: await bacaPengaturanPpn(tx),
        nilai: b.nilai,
        stokLayak: b.stokLayak,
        nilaiRusak: beku ?? b.rusak,
      });
      return {
        sasaran,
        bolehMulai: !b.konsinyasi && bolehMulai(mulai, b.tanggal),
        tanggal: b.tanggal,
        deskripsi: `Retur toko ${b.noNri}${b.noNrt ? ` (${b.noNrt})` : ""}${b.storeName ? ` — ${b.storeName}` : ""}`,
      };
    },
  });
  return dariSelaras(r, mulai !== null);
}

// ── Tukar barang (sekali posting) ───────────────────────────────────────────

export async function postJurnalTukar(exchangeId: string, postedById: string, client: Klien = prisma): Promise<HasilJurnalLapangan> {
  const ada = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: SUMBER_LAPANGAN.TUKAR, sourceId: exchangeId } },
    select: { id: true },
  });
  if (ada) return { ok: true, journalId: ada.id, created: false };

  const d = await client.storeExchange.findUnique({
    where: { id: exchangeId },
    select: { docNo: true, status: true, storeId: true, completedAt: true, updatedAt: true },
  });
  if (!d || d.status !== "SELESAI") return { ok: false, code: "NOTHING_TO_POST" };
  const tanggal = d.completedAt ?? d.updatedAt;
  const mulai = await readGlCutover();
  if (!mulai) return { ok: false, code: "GL_CUTOVER_NOT_CONFIGURED" };
  if (!bolehMulai(mulai, tanggal)) return { ok: false, code: "BELUM_BERLAKU" };

  const baris = await client.storeExchangeLine.findMany({ where: { exchangeId }, select: { id: true, direction: true, productName: true } });
  const stok = baris.length
    ? await client.stockAdjustment.findMany({
        where: { idempotencyKey: { in: baris.map((b) => `tukar:${b.id}`) } },
        select: { idempotencyKey: true, qtyChange: true, prevAvgCost: true, item: { select: { type: true } } },
      })
    : [];
  const perKunci = new Map(stok.map((s) => [s.idempotencyKey!, s]));
  const tanpaBiaya = baris.filter((b) => !perKunci.has(`tukar:${b.id}`)).map((b) => b.productName);
  if (tanpaBiaya.length > 0) return { ok: false, code: "BIAYA_TIDAK_DIKETAHUI", detail: tanpaBiaya.join(", ") };
  const nilai = (arah: string) =>
    baris
      .filter((b) => b.direction === arah)
      .map((b) => {
        const s = perKunci.get(`tukar:${b.id}`)!;
        return { tipeBarang: s.item.type, nilai: Math.abs(angka(s.qtyChange)) * angka(s.prevAvgCost) };
      });
  const toko = await client.store.findUnique({ where: { id: d.storeId }, select: { name: true } });
  const sasaran = barisTukar({ storeId: d.storeId, masuk: nilai("MASUK"), keluar: nilai("KELUAR") });
  if (sasaran.length === 0) return { ok: false, code: "NOTHING_TO_POST" };
  const r = await generateAutoJournal(client, SUMBER_LAPANGAN.TUKAR, exchangeId, keBarisJurnal(sasaran), {
    date: tanggal,
    description: `Tukar barang ${d.docNo}${toko ? ` — ${toko.name}` : ""}`,
    postedById,
  });
  if (r.ok) return { ok: true, journalId: r.journalId, created: r.created };
  return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
}

// ── Satu pintu ──────────────────────────────────────────────────────────────

export function jurnalLapangan(sumber: SumberLapangan, id: string, postedById: string): Promise<HasilJurnalLapangan> {
  switch (sumber) {
    case SUMBER_LAPANGAN.NOTA:
      return postJurnalNota(id, postedById);
    case SUMBER_LAPANGAN.BKM:
      return selaraskanJurnalKlaim(id, postedById);
    case SUMBER_LAPANGAN.RETUR:
      return selaraskanJurnalRetur(id, postedById);
    case SUMBER_LAPANGAN.TUKAR:
      return postJurnalTukar(id, postedById);
  }
}
