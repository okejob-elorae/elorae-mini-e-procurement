// Bukan aksi server — buku pembantu HUTANG PEMASOK (siapa berhutang berapa, per
// dokumen) untuk pembayaran pemasok sebagian dan umur hutang. KHUSUS SERVER:
// komponen klien hanya boleh `import type` dari berkas ini.

import { prisma, type Prisma } from "@elorae/db";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { daftarHutangJasa } from "@/lib/production/hutang-jasa-queries";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { kunciJenis, SUMBER_JURNAL_SALDO_AWAL } from "@/lib/finance/saldo-awal/jenis";
import { JEJAK_KAS } from "@/lib/finance/kas/jejak";
import { bacaSkbPemasok, type SkbPemasok } from "@/lib/finance/pajak/pemotongan";
import { ID_SALDO_AWAL, kunciDokumenHutang, type SisaDokumen } from "./pembayaran-aturan";
import { SARING_PEMBAYARAN_DOKUMEN } from "./pembayaran-dokumen-po";
import { oldestBookedBillDateByWo, vendorPaidBySource } from "@/lib/vendor-billing/billable";
import { grnLineKey, readGrnLines } from "@/lib/vendor-billing/bill-paid-rule";
import { terapkanFifo } from "./pembayaran-umur";
import { hitungUangMukaBelumDipotong, susunJejakUangMuka, type DataUangMukaPembayaran } from "./pembayaran-uang-muka";

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Sumber kebenaran tiap angka:
 *
 * - Hutang barang per GRN = Σ (kredit − debit) baris AKUN HUTANG USAHA di jurnal
 *   `GRN` dan `GRN_REVERSAL` GRN itu (bukan `GRN.totalAmount`: mode PKP sudah
 *   termasuk PPN, dan GRN tanpa jurnal bukan hutang di buku besar). GRN tanpa
 *   jurnal dihitung terpisah (`grnBelumBerjurnal`).
 * - Kredit per PO = retur pemasok SELESAI (baris hutang usaha jurnal
 *   `VENDOR_RETURN`-nya — sama dengan yang dibaca tombol lama) +
 *   pembayaran tombol lama "Tandai lunas" yang masih berdiri (jurnal
 *   `SUPPLIER_PAYMENT` `<poId>#<gen>` tanpa pembaliknya), diterapkan FIFO dari
 *   GRN tertua PO itu. Pembayaran Vendor Billing yang berlaku (jurnal
 *   `VENDOR_PAYMENT`-nya mendebit hutang usaha sebesar itu juga) dikreditkan
 *   per BARIS PO tagihannya (`vendorPaidBySource().byPoItem`) ke GRN PO itu
 *   yang membawa barang baris itu (kunci barang + varian, GRN tertua dulu,
 *   sampai hutang tiap GRN); sisanya ikut kredit PO yang diterapkan FIFO.
 *   Pembayaran Vendor Billing tidak menerima pembayaran baru sejak 2026-11-01;
 *   yang lama tetap dihitung di sini, jadi sisanya dibayar lewat halaman ini
 *   dan bagian yang sudah dibayar di sana tidak terbayar dua kali.
 * - Dibayar per dokumen = Σ alokasi pembayaran pemasok yang BERLAKU, kecuali
 *   pembayaran cermin "Tandai lunas" (nilainya sudah terbaca dari jurnalnya).
 * - Hutang jasa produksi per langkah WO dari `daftarHutangJasa` (jurnal
 *   penerimaan barang jadi + jurnal tagihan vendor yang masih berdiri; dibayar
 *   termasuk bagian pembayaran Vendor Billing atas langkah itu).
 * - Hutang saldo awal per pemasok dari impor saldo awal `AP` yang berlaku.
 * - Uang muka = bagian pembayaran berlaku yang belum dialokasikan.
 * - Uang muka belum dipotong per dokumen (dasar PPh pembayaran berikutnya) dari
 *   jejak pembayarannya (`pembayaran-uang-muka.ts`).
 */

export type JenisDokumenHutang = "GRN" | "WO_STEP" | "OTHER";

export type DokumenHutang = {
  jenis: JenisDokumenHutang;
  id: string;
  nomor: string;
  keterangan: string | null;
  poId: string | null;
  poNomor: string | null;
  woId: string | null;
  /** "YYYY-MM-DD" WIB — dasar umur hutang. */
  tanggal: string;
  hutangSen: number;
  kreditSen: number;
  dibayarSen: number;
  sisaSen: number;
  /** 0..1, bagian alokasi yang menjadi dasar PPh 23/21 (jasa tanpa PPN). */
  porsiDasarPotong: number;
  /**
   * Bruto uang muka yang sudah diterapkan ke dokumen ini tetapi PPh-nya belum
   * dipotong — ikut dasar potongan pembayaran berikutnya. Negatif = kredit.
   */
  uangMukaBelumDipotongSen: number;
};

export type UangMukaPemasok = {
  pembayaranId: string;
  nomor: string;
  tanggal: string;
  sisaSen: number;
  /** Bagian uang muka yang sudah dipotong PPh saat dibayar dan belum diterapkan. */
  sudahDipotongSen: number;
};

export type HutangPemasok = {
  supplierId: string;
  kode: string;
  nama: string;
  jenisPotong: string | null;
  adaNpwp: boolean;
  isPkp: boolean | null;
  /** SKB pemasok (nomor + berlaku sampai, hari WIB); null = tanpa SKB. */
  skb: SkbPemasok | null;
  dokumen: DokumenHutang[];
  uangMuka: UangMukaPemasok[];
  uangMukaSen: number;
  /** Kredit PO yang tidak terserap GRN PO itu (lebih bayar lewat tombol lama / Vendor Billing / retur). */
  lebihBayarSen: number;
  grnBelumBerjurnal: number;
  /** Σ sisa dokumen yang positif. */
  sisaSen: number;
  /** sisaSen − uang muka − lebih bayar − sisa negatif. */
  netoSen: number;
};

export type OpsiHutangPemasok = {
  /** Hanya pemasok ini. Tanpa saringan = semua pemasok yang punya hutang/uang muka. */
  supplierIds?: string[];
  /** Buang pemasok yang sisanya, uang mukanya, dan lebih bayarnya nol. */
  hanyaAda?: boolean;
  /** Hanya tes: ruang `OpeningBalanceImport.kind` (`kunciJenis("AP", ruang)`). */
  ruangSaldoAwal?: string;
};

export type HasilHutangPemasok = { pemasok: HutangPemasok[]; apBelumDipetakan: boolean };

const sen = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);
const tglWib = (d: Date) => formatDateOnlyJakarta(d);

function potong<T>(arr: T[], n: number): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < arr.length; i += n) hasil.push(arr.slice(i, i + n));
  return hasil;
}

export { SARING_PEMBAYARAN_DOKUMEN };

/** PO id dari sourceId `<poId>#<gen>` jurnal tombol lama. */
function poDariSumberTandaiLunas(sourceId: string | null): string | null {
  if (!sourceId) return null;
  const i = sourceId.lastIndexOf("#");
  return i <= 0 ? null : sourceId.slice(0, i);
}

type GrnBaris = {
  id: string;
  docNumber: string;
  grnDate: Date;
  poId: string | null;
  supplierId: string;
  totalAmount: Prisma.Decimal;
  ownerDeclinedAt: Date | null;
  items: Prisma.JsonValue;
  po: { docNumber: string } | null;
};

/**
 * Dokumen hutang GRN (dengan kredit PO dan alokasi sudah diterapkan) untuk
 * GRN yang cocok `where`. Juga mengembalikan GRN tanpa jurnal per pemasok dan
 * kredit PO yang tidak terserap.
 */
async function susunHutangGrn(
  where: Prisma.GRNWhereInput,
  apAkunId: string,
  klien: Klien,
): Promise<{
  dokumen: Array<DokumenHutang & { supplierId: string }>;
  belumBerjurnal: Map<string, number>;
  lebihBayar: Map<string, number>;
  /**
   * Kredit per PO yang diterapkan FIFO (retur, tombol lama, sisa Vendor Billing yang tidak
   * terserap GRN barangnya) dan bagian tombol lama di dalamnya — untuk `bacaLunasPemasokPerGrn`.
   */
  kreditPo: Map<string, number>;
  tandaiPo: Map<string, number>;
  /** Per GRN: bagian kredit PO FIFO yang terserap GRN itu (tanpa kredit Vendor Billing per barang). */
  kreditFifoGrn: Map<string, number>;
}> {
  const grns: GrnBaris[] = await klien.gRN.findMany({
    where,
    select: {
      id: true,
      docNumber: true,
      grnDate: true,
      poId: true,
      supplierId: true,
      totalAmount: true,
      ownerDeclinedAt: true,
      items: true,
      po: { select: { docNumber: true } },
    },
    orderBy: [{ grnDate: "asc" }, { docNumber: "asc" }],
  });
  const belumBerjurnal = new Map<string, number>();
  const lebihBayar = new Map<string, number>();
  const kreditPo = new Map<string, number>();
  const tandaiPo = new Map<string, number>();
  const kreditFifoGrn = new Map<string, number>();
  if (grns.length === 0) return { dokumen: [], belumBerjurnal, lebihBayar, kreditPo, tandaiPo, kreditFifoGrn };

  const hutangPerGrn = new Map<string, number>();
  const berjurnal = new Set<string>();
  for (const ids of potong(grns.map((g) => g.id), 500)) {
    const jurnal = await klien.journal.findMany({
      where: { sourceType: { in: ["GRN", "GRN_REVERSAL"] }, sourceId: { in: ids }, status: "POSTED" },
      select: { sourceType: true, sourceId: true, lines: { where: { chartAccountId: apAkunId }, select: { debit: true, credit: true } } },
    });
    for (const j of jurnal) {
      if (!j.sourceId) continue;
      if (j.sourceType === "GRN") berjurnal.add(j.sourceId);
      const n = j.lines.reduce((s, l) => s + sen(l.credit) - sen(l.debit), 0);
      hutangPerGrn.set(j.sourceId, (hutangPerGrn.get(j.sourceId) ?? 0) + n);
    }
  }
  for (const g of grns) {
    if (!berjurnal.has(g.id) && g.ownerDeclinedAt == null && Math.abs(Number(g.totalAmount)) >= 0.01) {
      belumBerjurnal.set(g.supplierId, (belumBerjurnal.get(g.supplierId) ?? 0) + 1);
    }
  }

  // Kredit per PO: retur pemasok selesai + pembayaran tombol lama yang berdiri; pembayaran
  // Vendor Billing per barang (`vendorBarang`), diterapkan ke GRN barangnya lebih dulu.
  const poIds = [...new Set(grns.map((g) => g.poId).filter((x): x is string => Boolean(x)))];
  const vendorBarang = new Map<string, Array<{ key: string; sen: number }>>();
  if (poIds.length > 0) {
    // Retur ke pemasok: dibaca dari jurnal `VENDOR_RETURN`-nya (DR hutang usaha
    // sebesar kredit PO), bukan dari `poCreditAmount`, supaya buku pembantu =
    // buku besar. Retur selesai yang belum berjurnal belum mengurangi hutang di
    // keduanya (sapuan jurnal operasional menangkapnya).
    for (const ids of potong(poIds, 500)) {
      const retur = await klien.vendorReturn.findMany({ where: { poId: { in: ids }, status: "COMPLETED" }, select: { id: true, poId: true } });
      if (retur.length === 0) continue;
      const poPerRetur = new Map(retur.map((r) => [r.id, r.poId as string]));
      const jurnalRetur = await klien.journal.findMany({
        where: { sourceType: "VENDOR_RETURN", sourceId: { in: retur.map((r) => r.id) }, status: "POSTED" },
        select: { sourceId: true, lines: { where: { chartAccountId: apAkunId }, select: { debit: true, credit: true } } },
      });
      for (const j of jurnalRetur) {
        const po = j.sourceId ? poPerRetur.get(j.sourceId) : undefined;
        if (!po) continue;
        kreditPo.set(po, (kreditPo.get(po) ?? 0) + j.lines.reduce((s, l) => s + sen(l.debit) - sen(l.credit), 0));
      }
    }
    const poSet = new Set(poIds);
    const tandai = await klien.journal.findMany({
      where: { sourceType: { in: ["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"] }, status: "POSTED" },
      select: { sourceType: true, sourceId: true, lines: { select: { debit: true } } },
    });
    const dibalik = new Set(tandai.filter((j) => j.sourceType === "SUPPLIER_PAYMENT_REVERSAL").map((j) => j.sourceId));
    for (const j of tandai) {
      if (j.sourceType !== "SUPPLIER_PAYMENT" || dibalik.has(j.sourceId)) continue;
      const po = poDariSumberTandaiLunas(j.sourceId);
      if (!po || !poSet.has(po)) continue;
      const n = j.lines.reduce((s, l) => s + sen(l.debit), 0);
      kreditPo.set(po, (kreditPo.get(po) ?? 0) + n);
      tandaiPo.set(po, (tandaiPo.get(po) ?? 0) + n);
    }
    // Pembayaran Vendor Billing: dialokasikan per TAGIHAN, dibagi ke baris tagihan
    // sebanding nilainya; bagian tiap baris PO dikreditkan ke GRN PO itu yang membawa
    // barang baris itu (barang + varian, GRN tertua dulu, sampai hutang tiap GRN) — dasar
    // yang sama dengan aturan lunas per potong (`bill-paid-rule.ts`). Yang tidak terserap
    // GRN mana pun ikut kredit PO yang diterapkan FIFO, seperti tombol lama.
    for (const ids of potong(poIds, 500)) {
      const { byPoItem } = await vendorPaidBySource(klien, { poIds: ids, woStepIds: [] });
      for (const itemIds of potong([...byPoItem.keys()], 500)) {
        const barisPo = await klien.pOItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, poId: true, itemId: true, variantSku: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        for (const it of barisPo) {
          const n = byPoItem.get(it.id) ?? 0;
          if (n <= 0) continue;
          const daftar = vendorBarang.get(it.poId) ?? [];
          daftar.push({ key: grnLineKey(it.itemId, it.variantSku), sen: n });
          vendorBarang.set(it.poId, daftar);
        }
      }
    }
  }

  // Alokasi dokumen ke GRN.
  const dibayarGrn = new Map<string, number>();
  for (const ids of potong(grns.map((g) => g.id), 500)) {
    const alokasi = await klien.supplierPaymentAllocation.findMany({
      where: { targetType: "GRN", targetId: { in: ids }, payment: SARING_PEMBAYARAN_DOKUMEN },
      select: { targetId: true, amount: true },
    });
    for (const a of alokasi) if (a.targetId) dibayarGrn.set(a.targetId, (dibayarGrn.get(a.targetId) ?? 0) + sen(a.amount));
  }

  type DokGrn = DokumenHutang & { supplierId: string };
  const dokumen: DokGrn[] = [];
  const perPo = new Map<string, Array<DokGrn & { kunci: string }>>();
  for (const g of grns) {
    if (!berjurnal.has(g.id)) continue;
    const hutangSen = hutangPerGrn.get(g.id) ?? 0;
    const d: DokGrn = {
      jenis: "GRN",
      id: g.id,
      supplierId: g.supplierId,
      nomor: g.docNumber,
      keterangan: null,
      poId: g.poId,
      poNomor: g.po?.docNumber ?? null,
      woId: null,
      tanggal: tglWib(g.grnDate),
      hutangSen,
      kreditSen: 0,
      dibayarSen: 0,
      sisaSen: hutangSen,
      porsiDasarPotong: 0,
      uangMukaBelumDipotongSen: 0,
    };
    if (g.poId) {
      const daftar = perPo.get(g.poId) ?? [];
      daftar.push({ ...d, kunci: g.id });
      perPo.set(g.poId, daftar);
    } else {
      dokumen.push(d);
    }
  }
  const itemsGrn = new Map(grns.map((g) => [g.id, g.items]));
  for (const [poId, asli] of perPo) {
    // Urutan sama dengan `terapkanFifo` (tanggal, lalu kunci), pada salinan dokumennya.
    const daftar = [...asli].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kunci.localeCompare(b.kunci)).map((d) => ({ ...d }));
    const vendor = vendorBarang.get(poId) ?? [];
    if (vendor.length > 0) {
      const kunciGrn = new Map(daftar.map((d) => [d.id, new Set(readGrnLines(itemsGrn.get(d.id)).map((l) => l.key))]));
      for (const { key, sen: n } of vendor) {
        let sisa = n;
        for (const d of daftar) {
          if (sisa <= 0) break;
          if (d.sisaSen <= 0 || !kunciGrn.get(d.id)?.has(key)) continue;
          const pakai = Math.min(sisa, d.sisaSen);
          d.sisaSen -= pakai;
          sisa -= pakai;
        }
        if (sisa > 0) kreditPo.set(poId, (kreditPo.get(poId) ?? 0) + sisa);
      }
    }
    const sebelumFifo = new Map(daftar.map((d) => [d.id, d.sisaSen]));
    const r = terapkanFifo(daftar, kreditPo.get(poId) ?? 0);
    for (const d of r.dokumen) {
      const { kunci, ...isi } = d;
      void kunci;
      kreditFifoGrn.set(isi.id, (sebelumFifo.get(isi.id) ?? isi.sisaSen) - isi.sisaSen);
      dokumen.push({ ...isi, kreditSen: isi.hutangSen - isi.sisaSen });
    }
    if (r.sisaKreditSen > 0) {
      const s = daftar[0].supplierId;
      lebihBayar.set(s, (lebihBayar.get(s) ?? 0) + r.sisaKreditSen);
    }
  }
  for (const d of dokumen) {
    const bayar = dibayarGrn.get(d.id) ?? 0;
    d.dibayarSen = bayar;
    d.sisaSen = d.sisaSen - bayar;
  }
  return { dokumen, belumBerjurnal, lebihBayar, kreditPo, tandaiPo, kreditFifoGrn };
}

export type LunasPemasokGrn = { poId: string | null; hutangSen: number; lunasPemasokSen: number };

/**
 * Per GRN berjurnal milik PO-PO ini: hutang barangnya dan bagian yang SUDAH dilunasi lewat
 * Pembayaran pemasok — alokasi dokumen ke GRN itu + bagiannya dari pembayaran tombol lama
 * "Tandai lunas" yang masih berdiri. Hanya bagian kredit PO yang berlaku untuk seluruh PO yang
 * diterapkan FIFO dari GRN tertua seperti di buku pembantu (kredit Vendor Billing per barang
 * lebih dulu masuk GRN barangnya); bagian tombol lama dari kredit FIFO satu GRN sebanding porsinya
 * di kredit PO itu. Retur pemasok dan pembayaran Vendor Billing lama tidak ikut: retur bukan
 * pembayaran, dan pembayaran Vendor Billing tercatat di tagihannya sendiri. Dibaca Vendor Billing
 * (`lib/vendor-billing/supplier-paid.ts`) untuk menandai invoice lunas per penerimaan. GRN tanpa
 * jurnal tidak ada di peta; AP belum dipetakan = peta kosong.
 */
export async function bacaLunasPemasokPerGrn(poIds: string[], klien: Klien = prisma): Promise<Map<string, LunasPemasokGrn>> {
  const hasil = new Map<string, LunasPemasokGrn>();
  const unik = [...new Set(poIds)];
  if (unik.length === 0) return hasil;
  let apAkunId: string | null = null;
  try {
    apAkunId = await resolveAccount("AP", klien);
  } catch (e) {
    if (!(e instanceof UnmappedRoleError)) throw e;
  }
  if (!apAkunId) return hasil;
  for (const ids of potong(unik, 500)) {
    const g = await susunHutangGrn({ poId: { in: ids } }, apAkunId, klien);
    for (const d of g.dokumen) {
      const kredit = d.poId ? (g.kreditPo.get(d.poId) ?? 0) : 0;
      const tandai = d.poId ? (g.tandaiPo.get(d.poId) ?? 0) : 0;
      // Hanya bagian FIFO: kredit Vendor Billing per barang tetap di luar `lunasPemasokSen`,
      // karena tagihannya sudah menghitungnya lewat `lineRooms`.
      const fifo = g.kreditFifoGrn.get(d.id) ?? 0;
      const bagianTandai = kredit > 0 && tandai > 0 && fifo > 0 ? Math.round((fifo * Math.min(tandai, kredit)) / kredit) : 0;
      hasil.set(d.id, { poId: d.poId, hutangSen: d.hutangSen, lunasPemasokSen: d.dibayarSen + bagianTandai });
    }
  }
  return hasil;
}

/** Hutang saldo awal per pemasok dari impor `AP` yang berlaku (null bila belum ada). */
async function hutangSaldoAwal(klien: Klien, ruang?: string): Promise<{ tanggal: string; perPemasok: Map<string, number> } | null> {
  const imp = await klien.openingBalanceImport.findFirst({
    where: { kind: kunciJenis("AP", ruang), status: "POSTED" },
    orderBy: { postedAt: "desc" },
    select: { id: true, cutoverDate: true, entries: true, journalId: true },
  });
  if (!imp) return null;
  const jurnal = imp.journalId
    ? await klien.journal.findUnique({ where: { id: imp.journalId }, select: { date: true } })
    : await klien.journal.findFirst({ where: { sourceType: SUMBER_JURNAL_SALDO_AWAL, sourceId: imp.id }, select: { date: true } });
  const perPemasok = new Map<string, number>();
  const entri = Array.isArray(imp.entries) ? (imp.entries as Array<{ supplierId?: unknown; jumlah?: unknown }>) : [];
  for (const e of entri) {
    if (typeof e?.supplierId !== "string") continue;
    const n = sen(e.jumlah as number);
    if (n !== 0) perPemasok.set(e.supplierId, (perPemasok.get(e.supplierId) ?? 0) + n);
  }
  const tanggal = jurnal?.date ? tglWib(jurnal.date) : tglWib(new Date(imp.cutoverDate.getTime() - 86_400_000));
  return { tanggal, perPemasok };
}

/**
 * Dasar umur hutang jasa per WO: saat hutang jasanya PERTAMA dijurnal — penerimaan barang jadi
 * pertama yang menjurnal jasa, atau tagihan vendor berlaku tertua yang menjurnal jasa pcs lama
 * (`oldestBookedBillDateByWo`), mana yang lebih dulu. Jadi hutang jahit lama di WO yang sebagian
 * pcs-nya diterima sesudah aturan baru tidak tampak lebih muda dari sebenarnya. WO tanpa keduanya
 * memakai tanggal tagihan berlaku tertuanya.
 */
async function tanggalJasaPerWo(woIds: string[], klien: Klien): Promise<Map<string, string>> {
  const hasil = new Map<string, string>();
  const pakai = (woId: string, t: string) => {
    const ada = hasil.get(woId);
    if (!ada || t < ada) hasil.set(woId, t);
  };
  for (const ids of potong(woIds, 500)) {
    const r = await klien.fGReceipt.groupBy({ by: ["woId"], where: { woId: { in: ids }, serviceCost: { not: null } }, _min: { receivedAt: true } });
    for (const x of r) if (x._min.receivedAt) pakai(x.woId, tglWib(x._min.receivedAt));
    for (const [woId, tanggal] of await oldestBookedBillDateByWo(klien, ids)) pakai(woId, tglWib(tanggal));
  }
  for (const ids of potong(woIds.filter((id) => !hasil.has(id)), 500)) {
    const baris = await klien.vendorBillLine.findMany({
      where: { woStep: { woId: { in: ids } }, bill: { status: { not: "VOID" } } },
      select: { woStep: { select: { woId: true } }, bill: { select: { billDate: true } } },
    });
    for (const b of baris) {
      if (!b.woStep) continue;
      const t = tglWib(b.bill.billDate);
      const ada = hasil.get(b.woStep.woId);
      if (!ada || t < ada) hasil.set(b.woStep.woId, t);
    }
  }
  return hasil;
}

/**
 * Buku pembantu hutang pemasok. Tanpa `supplierIds`: setiap pemasok yang punya
 * dokumen hutang, uang muka, atau lebih bayar.
 */
export async function bacaHutangPemasok(opsi: OpsiHutangPemasok = {}, klien: Klien = prisma): Promise<HasilHutangPemasok> {
  const saringPemasok = opsi.supplierIds ? { in: opsi.supplierIds } : undefined;
  if (opsi.supplierIds && opsi.supplierIds.length === 0) return { pemasok: [], apBelumDipetakan: false };

  let apAkunId: string | null = null;
  try {
    apAkunId = await resolveAccount("AP", klien);
  } catch (e) {
    if (!(e instanceof UnmappedRoleError)) throw e;
  }

  const grn = apAkunId
    ? await susunHutangGrn(saringPemasok ? { supplierId: saringPemasok } : {}, apAkunId, klien)
    : { dokumen: [], belumBerjurnal: new Map<string, number>(), lebihBayar: new Map<string, number>() };

  const jasa = await daftarHutangJasa(opsi.supplierIds?.length === 1 ? { supplierId: opsi.supplierIds[0] } : {}, klien);
  const jasaTersaring = saringPemasok ? jasa.filter((j) => opsi.supplierIds!.includes(j.supplierId)) : jasa;
  const tanggalWo = await tanggalJasaPerWo([...new Set(jasaTersaring.flatMap((j) => j.langkah.map((l) => l.woId)))], klien);

  const saldoAwal = apAkunId ? await hutangSaldoAwal(klien, opsi.ruangSaldoAwal) : null;

  // Pembayaran dokumen berlaku: alokasi ke saldo awal + uang muka yang belum terpakai.
  const pembayaran = await klien.supplierPayment.findMany({
    where: { ...SARING_PEMBAYARAN_DOKUMEN, ...(saringPemasok ? { supplierId: saringPemasok } : {}) },
    select: { id: true, docNumber: true, date: true, supplierId: true, grossAmount: true, allocations: { select: { targetType: true, targetId: true, amount: true } } },
    orderBy: { date: "asc" },
  });
  const bayarSaldoAwal = new Map<string, number>();
  const uangMukaPer = new Map<string, UangMukaPemasok[]>();
  for (const p of pembayaran) {
    let dialokasikan = 0;
    for (const a of p.allocations) {
      dialokasikan += sen(a.amount);
      if (a.targetType === "OTHER" && a.targetId === ID_SALDO_AWAL) bayarSaldoAwal.set(p.supplierId, (bayarSaldoAwal.get(p.supplierId) ?? 0) + sen(a.amount));
    }
    const sisa = sen(p.grossAmount) - dialokasikan;
    if (sisa > 0) {
      const daftar = uangMukaPer.get(p.supplierId) ?? [];
      daftar.push({ pembayaranId: p.id, nomor: p.docNumber, tanggal: tglWib(p.date), sisaSen: sisa, sudahDipotongSen: 0 });
      uangMukaPer.set(p.supplierId, daftar);
    }
  }

  // Jejak pembayaran (pencatatan + penerapan uang muka), urut waktu, untuk uang muka belum dipotong.
  const jejakPer = new Map<string, Array<{ action: string; changes: unknown; metadata: unknown }>>();
  for (const ids of potong(pembayaran.map((p) => p.id), 500)) {
    const jejak = await klien.auditLog.findMany({
      where: { entityType: "SupplierPayment", entityId: { in: ids }, action: { in: [JEJAK_KAS.PEMBAYARAN_DICATAT, JEJAK_KAS.UANG_MUKA_DITERAPKAN] } },
      select: { entityId: true, action: true, changes: true, metadata: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const j of jejak) {
      const daftar = jejakPer.get(j.entityId) ?? [];
      daftar.push(j);
      jejakPer.set(j.entityId, daftar);
    }
  }

  const ids = new Set<string>([
    ...grn.dokumen.map((d) => d.supplierId),
    ...grn.belumBerjurnal.keys(),
    ...grn.lebihBayar.keys(),
    ...jasaTersaring.map((j) => j.supplierId),
    ...uangMukaPer.keys(),
    ...(saldoAwal ? [...saldoAwal.perPemasok.keys()] : []),
  ]);
  if (opsi.supplierIds) for (const s of opsi.supplierIds) ids.add(s);
  const pemasokRows = ids.size
    ? await klien.supplier.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, code: true, name: true, taxWithholding: true, hasNpwp: true, isPkp: true, skbNumber: true, skbValidUntil: true },
      })
    : [];

  const hasil: HutangPemasok[] = [];
  for (const p of pemasokRows) {
    const dokumen: DokumenHutang[] = grn.dokumen
      .filter((d) => d.supplierId === p.id)
      .map((d) => {
        const { supplierId, ...isi } = d;
        void supplierId;
        return isi;
      });
    const jp = jasaTersaring.find((j) => j.supplierId === p.id);
    for (const l of jp?.langkah ?? []) {
      const hutangSen = sen(l.hutang);
      dokumen.push({
        jenis: "WO_STEP",
        id: l.stepId,
        nomor: `${l.woDocNumber} · ${l.urutan}${l.namaLangkah ? ` ${l.namaLangkah}` : ""}`,
        keterangan: `${l.qtyTerhutang} pcs × ${l.hargaPerPcs.toLocaleString("id-ID")}${l.hargaTermasukPpn ? " (termasuk PPN)" : ""}`,
        poId: null,
        poNomor: null,
        woId: l.woId,
        tanggal: tanggalWo.get(l.woId) ?? tglWib(new Date()),
        hutangSen,
        kreditSen: 0,
        dibayarSen: sen(l.dibayar),
        sisaSen: sen(l.sisa),
        porsiDasarPotong: hutangSen > 0 ? Math.min(1, sen(l.dasarPotong) / hutangSen) : 0,
        uangMukaBelumDipotongSen: 0,
      });
    }
    const awal = saldoAwal?.perPemasok.get(p.id) ?? 0;
    if (awal !== 0 || (bayarSaldoAwal.get(p.id) ?? 0) !== 0) {
      const dibayar = bayarSaldoAwal.get(p.id) ?? 0;
      dokumen.push({
        jenis: "OTHER",
        id: ID_SALDO_AWAL,
        nomor: "Utang saldo awal",
        keterangan: null,
        poId: null,
        poNomor: null,
        woId: null,
        tanggal: saldoAwal?.tanggal ?? tglWib(new Date()),
        hutangSen: awal,
        kreditSen: 0,
        dibayarSen: dibayar,
        sisaSen: awal - dibayar,
        porsiDasarPotong: 0,
        uangMukaBelumDipotongSen: 0,
      });
    }
    dokumen.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.nomor.localeCompare(b.nomor));
    const uangMuka = uangMukaPer.get(p.id) ?? [];
    const porsi = new Map(dokumen.map((d) => [kunciDokumenHutang(d.jenis, d.id), d.porsiDasarPotong]));
    const dataUangMuka: DataUangMukaPembayaran[] = pembayaran
      .filter((b) => b.supplierId === p.id)
      .map((b) => ({
        id: b.id,
        alokasi: b.allocations.filter((a) => a.targetId).map((a) => ({ kunci: kunciDokumenHutang(a.targetType, a.targetId as string), sen: sen(a.amount) })),
        ...susunJejakUangMuka(jejakPer.get(b.id) ?? [], (k) => porsi.get(k) ?? 0),
      }));
    const belum = hitungUangMukaBelumDipotong(dataUangMuka);
    for (const d of dokumen) d.uangMukaBelumDipotongSen = belum.perDokumen.get(kunciDokumenHutang(d.jenis, d.id)) ?? 0;
    for (const u of uangMuka) u.sudahDipotongSen = Math.min(u.sisaSen, belum.sisaTerpotong.get(u.pembayaranId) ?? 0);
    const uangMukaSen = uangMuka.reduce((s, u) => s + u.sisaSen, 0);
    const lebihBayarSen = grn.lebihBayar.get(p.id) ?? 0;
    const sisaSen = dokumen.reduce((s, d) => s + Math.max(0, d.sisaSen), 0);
    const negatif = dokumen.reduce((s, d) => s + Math.min(0, d.sisaSen), 0);
    hasil.push({
      supplierId: p.id,
      kode: p.code,
      nama: p.name,
      jenisPotong: p.taxWithholding,
      adaNpwp: p.hasNpwp,
      isPkp: p.isPkp,
      skb: bacaSkbPemasok(p),
      dokumen,
      uangMuka,
      uangMukaSen,
      lebihBayarSen,
      grnBelumBerjurnal: grn.belumBerjurnal.get(p.id) ?? 0,
      sisaSen,
      netoSen: sisaSen + negatif - uangMukaSen - lebihBayarSen,
    });
  }
  const tersaring = opsi.hanyaAda
    ? hasil.filter((h) => h.sisaSen !== 0 || h.uangMukaSen !== 0 || h.lebihBayarSen !== 0 || h.dokumen.some((d) => d.sisaSen !== 0) || h.grnBelumBerjurnal > 0)
    : hasil;
  tersaring.sort((a, b) => a.nama.localeCompare(b.nama, "id", { sensitivity: "base" }) || a.kode.localeCompare(b.kode));
  return { pemasok: tersaring, apBelumDipetakan: apAkunId == null };
}

/** Peta sisa dokumen satu pemasok untuk memeriksa alokasi (`periksaAlokasiTerhadapSisa`). */
export function petaSisaDokumen(h: HutangPemasok | undefined): Map<string, SisaDokumen> {
  const peta = new Map<string, SisaDokumen>();
  for (const d of h?.dokumen ?? []) {
    peta.set(kunciDokumenHutang(d.jenis, d.id), { sisaSen: d.sisaSen, porsiDasarPotong: d.porsiDasarPotong, uangMukaBelumDipotongSen: d.uangMukaBelumDipotongSen });
  }
  return peta;
}

/**
 * Sisa hutang per PO (Σ sisa GRN berjurnal PO itu) dan apakah PO itu punya
 * alokasi pembayaran dokumen. Dipakai penulis pembayaran untuk menandai /
 * membuka tanda lunas PO otomatis, dan oleh tombol lama untuk menolak.
 */
export async function keadaanBayarPo(
  poIds: string[],
  klien: Klien = prisma,
): Promise<Map<string, { sisaSen: number; adaGrnBerjurnal: boolean; adaAlokasiDokumen: boolean }>> {
  const hasil = new Map<string, { sisaSen: number; adaGrnBerjurnal: boolean; adaAlokasiDokumen: boolean }>();
  const unik = [...new Set(poIds)];
  if (unik.length === 0) return hasil;
  for (const id of unik) hasil.set(id, { sisaSen: 0, adaGrnBerjurnal: false, adaAlokasiDokumen: false });
  let apAkunId: string | null = null;
  try {
    apAkunId = await resolveAccount("AP", klien);
  } catch (e) {
    if (!(e instanceof UnmappedRoleError)) throw e;
  }
  if (apAkunId) {
    const g = await susunHutangGrn({ poId: { in: unik } }, apAkunId, klien);
    for (const d of g.dokumen) {
      if (!d.poId) continue;
      const k = hasil.get(d.poId)!;
      k.sisaSen += d.sisaSen;
      k.adaGrnBerjurnal = true;
    }
  }
  const grnPo = await klien.gRN.findMany({ where: { poId: { in: unik } }, select: { id: true, poId: true } });
  if (grnPo.length > 0) {
    const alokasi = await klien.supplierPaymentAllocation.findMany({
      where: { targetType: "GRN", targetId: { in: grnPo.map((g) => g.id) }, payment: SARING_PEMBAYARAN_DOKUMEN },
      select: { targetId: true },
    });
    const poPerGrn = new Map(grnPo.map((g) => [g.id, g.poId]));
    for (const a of alokasi) {
      const po = a.targetId ? poPerGrn.get(a.targetId) : null;
      if (po && hasil.has(po)) hasil.get(po)!.adaAlokasiDokumen = true;
    }
  }
  return hasil;
}

/** Saldo akun hutang usaha di buku besar (kredit − debit, jurnal berlaku), untuk dibandingkan dengan Σ buku pembantu. */
export async function saldoHutangUsahaBukuBesarSen(klien: Klien = prisma): Promise<number | null> {
  let apAkunId: string;
  try {
    apAkunId = await resolveAccount("AP", klien);
  } catch (e) {
    if (e instanceof UnmappedRoleError) return null;
    throw e;
  }
  const r = await klien.journalLine.aggregate({
    where: { chartAccountId: apAkunId, journal: { status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  return sen(r._sum.credit) - sen(r._sum.debit);
}
