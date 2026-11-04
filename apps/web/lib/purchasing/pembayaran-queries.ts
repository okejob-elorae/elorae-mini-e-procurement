// Bukan aksi server — pembaca halaman Pembayaran pemasok (register PO, daftar
// pembayaran, rincian, umur hutang). KHUSUS SERVER: komponen klien hanya boleh
// `import type` dari berkas ini.

import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { listPOs } from "@/lib/purchase-orders/queries";
import { pisahUtangPo, utangBaris } from "@/app/backoffice/supplier-payments/nilai-utang";
import { poIdsWithStandingPaymentJournalWhileUnpaid } from "./supplier-payment-journal";
import { bacaJenisPotongPemasok, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { JEJAK_KAS } from "@/lib/finance/kas/jejak";
import { adalahCerminTandaiLunas, SUMBER_PEMBAYARAN_PEMASOK, SUMBER_PEMBAYARAN_PEMASOK_BALIK } from "./pembayaran-aturan";
import { bacaHutangPemasok, keadaanBayarPo, saldoHutangUsahaBukuBesarSen, type DokumenHutang } from "./pembayaran-hutang-queries";
import { jumlahkanUmur, susunUmur, type BarisUmur } from "./pembayaran-umur";

type Klien = Prisma.TransactionClient | typeof prisma;
const sen = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 100);

// ───────────────────── Register utang per PO ─────────────────────

export type SaringRegister = {
  pemasokId?: string | null;
  jatuhTempoDari?: string | null;
  jatuhTempoSampai?: string | null;
  status?: "semua" | "lunas" | "belum";
  cari?: string | null;
  halaman?: number;
  ukuran?: number;
};

export type BarisRegister = {
  id: string;
  nomor: string;
  status: string;
  pemasok: { id: string; nama: string; kode: string };
  jatuhTempo: string | null;
  lunasPada: string | null;
  grandTotal: number;
  /** Utang PO (total − tidak datang − retur), tampilan. */
  utang: number;
  utangDiterima: number;
  komitmen: number;
  adaPenerimaan: boolean;
  /** Sisa hutang menurut buku besar (GRN berjurnal − retur − pembayaran). Null bila belum ada GRN berjurnal. */
  sisaBukuBesar: number | null;
  /** PO ini sudah punya pembayaran dokumen (BYR/…) — tombol lama ditolak. */
  adaPembayaranDokumen: boolean;
  paymentJournalStandingWhileUnpaid: boolean;
};

export type RegisterUtang = {
  baris: BarisRegister[];
  total: number;
  halaman: number;
  ukuran: number;
  /** Atas SELURUH PO yang tersaring, bukan halaman ini. */
  ringkasan: { utangDiterima: number; jumlahPoUtang: number; komitmen: number; jumlahPoKomitmen: number; belumDibayar: number; sudahDibayar: number };
};

export async function registerUtangPo(s: SaringRegister): Promise<RegisterUtang> {
  const ukuran = Math.min(Math.max(s.ukuran ?? 20, 10), 100);
  const halaman = Math.max(1, s.halaman ?? 1);
  const semua = (await listPOs({
    statusIn: ["SUBMITTED", "PARTIAL", "CLOSED", "OVER"],
    supplierId: s.pemasokId || undefined,
    paymentDueFrom: s.jatuhTempoDari ? parseDateOnly(s.jatuhTempoDari) : undefined,
    paymentDueTo: s.jatuhTempoSampai ? parseDateOnlyEnd(s.jatuhTempoSampai) : undefined,
    paid: s.status === "lunas" ? true : s.status === "belum" ? false : undefined,
    cari: s.cari?.trim() || undefined,
  })) as Array<Record<string, unknown> & { id: string; paidAt: Date | string | null }>;

  let utangSen = 0;
  let komitmenSen = 0;
  let jumlahPoUtang = 0;
  let jumlahPoKomitmen = 0;
  let belum = 0;
  let sudah = 0;
  const dihitung = semua.map((po) => {
    const p = po as unknown as Parameters<typeof pisahUtangPo>[0] & { paidAt: unknown };
    const pisah = pisahUtangPo({ grandTotal: p.grandTotal, ppnRatePercent: (p.ppnRatePercent as number | null) ?? null, utang: p.utang, items: p.items ?? [] });
    if (po.paidAt) sudah++;
    else {
      belum++;
      const u = Math.round(pisah.utangDiterima * 100);
      const k = Math.round(pisah.komitmen * 100);
      utangSen += u;
      komitmenSen += k;
      if (u > 0) jumlahPoUtang++;
      if (k > 0) jumlahPoKomitmen++;
    }
    return { po, pisah };
  });

  const halamanIni = dihitung.slice((halaman - 1) * ukuran, halaman * ukuran);
  const ids = halamanIni.map((x) => x.po.id);
  const [berdiri, keadaan] = await Promise.all([
    poIdsWithStandingPaymentJournalWhileUnpaid(halamanIni.filter((x) => !x.po.paidAt).map((x) => x.po.id)),
    keadaanBayarPo(ids),
  ]);
  const tanggal = (v: unknown) => (v ? formatDateOnlyJakarta(new Date(v as string)) : null);
  return {
    total: semua.length,
    halaman,
    ukuran,
    ringkasan: { utangDiterima: utangSen / 100, jumlahPoUtang, komitmen: komitmenSen / 100, jumlahPoKomitmen, belumDibayar: belum, sudahDibayar: sudah },
    baris: halamanIni.map(({ po, pisah }) => {
      const p = po as unknown as {
        id: string;
        docNumber: string;
        status: string;
        supplierId: string;
        supplier: { name: string; code: string };
        paymentDueDate: unknown;
        paidAt: unknown;
        grandTotal: number | string;
        items?: Array<{ receivedQty: unknown }>;
      };
      const k = keadaan.get(p.id);
      return {
        id: p.id,
        nomor: p.docNumber,
        status: p.status,
        pemasok: { id: p.supplierId, nama: p.supplier.name, kode: p.supplier.code },
        jatuhTempo: tanggal(p.paymentDueDate),
        lunasPada: tanggal(p.paidAt),
        grandTotal: Number(p.grandTotal),
        utang: utangBaris(po as unknown as Parameters<typeof utangBaris>[0]),
        utangDiterima: pisah.utangDiterima,
        komitmen: pisah.komitmen,
        adaPenerimaan: (p.items ?? []).some((l) => Number(l.receivedQty) > 0),
        sisaBukuBesar: k?.adaGrnBerjurnal ? k.sisaSen / 100 : null,
        adaPembayaranDokumen: k?.adaAlokasiDokumen ?? false,
        paymentJournalStandingWhileUnpaid: berdiri.has(p.id),
      };
    }),
  };
}

// ───────────────────── Daftar pembayaran ─────────────────────

export type SaringPembayaran = {
  pemasokId?: string | null;
  dari?: string | null;
  sampai?: string | null;
  status?: "POSTED" | "CANCELLED" | null;
  cari?: string | null;
  halaman?: number;
  ukuran?: number;
};

export type BarisPembayaran = {
  id: string;
  nomor: string;
  tanggal: string;
  pemasok: { id: string; nama: string; kode: string };
  cara: string;
  rekening: string | null;
  referensi: string | null;
  bruto: number;
  potong: number;
  jenisPotong: string | null;
  neto: number;
  uangMukaSisa: number;
  dokumen: string[];
  jumlahDokumen: number;
  status: "POSTED" | "CANCELLED";
  cerminTandaiLunas: boolean;
};

export type HalamanPembayaran = {
  baris: BarisPembayaran[];
  total: number;
  halaman: number;
  ukuran: number;
  ringkasan: { bruto: number; potong: number; neto: number; jumlahBerlaku: number };
};

function wherePembayaran(s: SaringPembayaran): Prisma.SupplierPaymentWhereInput {
  const tanggal: Prisma.DateTimeFilter = {};
  if (s.dari) tanggal.gte = parseDateOnly(s.dari);
  if (s.sampai) tanggal.lte = parseDateOnlyEnd(s.sampai);
  const cari = s.cari?.trim();
  return {
    ...(s.pemasokId ? { supplierId: s.pemasokId } : {}),
    ...(s.status ? { status: s.status } : {}),
    ...(s.dari || s.sampai ? { date: tanggal } : {}),
    ...(cari ? { AND: [{ OR: [{ docNumber: cariTeks(cari) }, { reference: cariTeks(cari) }, { note: cariTeks(cari) }, { allocations: { some: { note: cariTeks(cari) } } }] }] } : {}),
  };
}

export async function daftarPembayaran(s: SaringPembayaran, klien: Klien = prisma): Promise<HalamanPembayaran> {
  const ukuran = Math.min(Math.max(s.ukuran ?? 20, 10), 100);
  const halaman = Math.max(1, s.halaman ?? 1);
  const where = wherePembayaran(s);
  const [rows, total, agg] = await Promise.all([
    klien.supplierPayment.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (halaman - 1) * ukuran,
      take: ukuran,
      include: { allocations: { select: { amount: true, note: true } } },
    }),
    klien.supplierPayment.count({ where }),
    klien.supplierPayment.aggregate({ where: { ...where, status: "POSTED" }, _sum: { grossAmount: true, withholdingAmount: true, netAmount: true }, _count: { _all: true } }),
  ]);
  const pemasokIds = [...new Set(rows.map((r) => r.supplierId))];
  const akunIds = [...new Set(rows.map((r) => r.cashAccountId).filter((x): x is string => Boolean(x)))];
  const [pemasok, akun] = await Promise.all([
    pemasokIds.length ? klien.supplier.findMany({ where: { id: { in: pemasokIds } }, select: { id: true, name: true, code: true } }) : [],
    akunIds.length ? klien.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, name: true, code: true } }) : [],
  ]);
  const p = new Map(pemasok.map((x) => [x.id, x]));
  const a = new Map(akun.map((x) => [x.id, `${x.name} (${x.code})`]));
  return {
    total,
    halaman,
    ukuran,
    ringkasan: {
      bruto: sen(agg._sum.grossAmount) / 100,
      potong: sen(agg._sum.withholdingAmount) / 100,
      neto: sen(agg._sum.netAmount) / 100,
      jumlahBerlaku: agg._count._all,
    },
    baris: rows.map((r) => ({
      id: r.id,
      nomor: r.docNumber,
      tanggal: formatDateOnlyJakarta(r.date),
      pemasok: { id: r.supplierId, nama: p.get(r.supplierId)?.name ?? "?", kode: p.get(r.supplierId)?.code ?? "?" },
      cara: r.method,
      rekening: r.cashAccountId ? (a.get(r.cashAccountId) ?? null) : null,
      referensi: r.reference,
      bruto: Number(r.grossAmount),
      potong: Number(r.withholdingAmount),
      jenisPotong: r.withholdingType,
      neto: Number(r.netAmount),
      uangMukaSisa: (sen(r.grossAmount) - r.allocations.reduce((s2, x) => s2 + sen(x.amount), 0)) / 100,
      dokumen: r.allocations.slice(0, 3).map((x) => x.note ?? "-"),
      jumlahDokumen: r.allocations.length,
      status: r.status === "CANCELLED" ? "CANCELLED" : "POSTED",
      cerminTandaiLunas: adalahCerminTandaiLunas(r.idempotencyKey),
    })),
  };
}

export type RincianPembayaran = BarisPembayaran & {
  catatan: string | null;
  jatuhTempoGiro: string | null;
  fotoUrl: string | null;
  pencatat: string | null;
  dibuat: string;
  dibatalkan: { pada: string; oleh: string | null; alasan: string | null } | null;
  alokasi: Array<{ id: string; jenis: string; targetId: string | null; jumlah: number; label: string; poId: string | null; woId: string | null }>;
  jurnalId: string | null;
  jurnalBalikId: string | null;
  mutasiTercocok: number;
  /** SKB pemasok yang membebaskan potongan pembayaran ini (dari jejak pencatatannya); null = tidak. */
  dibebaskanSkb: { nomor: string; berlakuSampai: string; jenis: JenisPotongPemasok } | null;
};

/** `metadata.dibebaskanSkb` jejak `SUPPLIER_PAYMENT_RECORDED` → pembebasan, atau null. */
function bacaDibebaskanSkb(metadata: unknown): RincianPembayaran["dibebaskanSkb"] {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).dibebaskanSkb : null;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const jenis = bacaJenisPotongPemasok(o.jenis);
  return jenis && typeof o.nomor === "string" && typeof o.berlakuSampai === "string" ? { nomor: o.nomor, berlakuSampai: o.berlakuSampai, jenis } : null;
}

export async function rincianPembayaran(id: string, klien: Klien = prisma): Promise<RincianPembayaran | null> {
  const b = await klien.supplierPayment.findUnique({ where: { id }, include: { allocations: { orderBy: { createdAt: "asc" } } } });
  if (!b) return null;
  const userIds = [...new Set([b.createdById, b.cancelledById].filter((x): x is string => Boolean(x)))];
  const grnIds = b.allocations.filter((x) => x.targetType === "GRN" && x.targetId).map((x) => x.targetId as string);
  const stepIds = b.allocations.filter((x) => x.targetType === "WO_STEP" && x.targetId).map((x) => x.targetId as string);
  const [pemasok, akun, users, grn, step, jurnal, jejak] = await Promise.all([
    klien.supplier.findUnique({ where: { id: b.supplierId }, select: { id: true, name: true, code: true } }),
    b.cashAccountId ? klien.chartAccount.findUnique({ where: { id: b.cashAccountId }, select: { name: true, code: true } }) : null,
    klien.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    grnIds.length ? klien.gRN.findMany({ where: { id: { in: grnIds } }, select: { id: true, poId: true } }) : [],
    stepIds.length ? klien.workOrderStep.findMany({ where: { id: { in: stepIds } }, select: { id: true, woId: true } }) : [],
    klien.journal.findMany({ where: { sourceType: { in: [SUMBER_PEMBAYARAN_PEMASOK, SUMBER_PEMBAYARAN_PEMASOK_BALIK, "SUPPLIER_PAYMENT"] }, sourceId: { in: [b.id, ...(adalahCerminTandaiLunas(b.idempotencyKey) ? [String(b.idempotencyKey).slice("tandai-lunas:".length)] : [])] } }, select: { id: true, sourceType: true, lines: { select: { id: true } } } }),
    klien.auditLog.findFirst({ where: { action: JEJAK_KAS.PEMBAYARAN_DICATAT, entityType: "SupplierPayment", entityId: b.id }, orderBy: { createdAt: "asc" }, select: { metadata: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x.name || x.email]));
  const g = new Map(grn.map((x) => [x.id, x.poId]));
  const st = new Map(step.map((x) => [x.id, x.woId]));
  const asli = jurnal.find((j) => j.sourceType === SUMBER_PEMBAYARAN_PEMASOK || j.sourceType === "SUPPLIER_PAYMENT") ?? null;
  const balik = jurnal.find((j) => j.sourceType === SUMBER_PEMBAYARAN_PEMASOK_BALIK) ?? null;
  const mutasiTercocok = asli ? await klien.bankStatementLine.count({ where: { matchedJournalLineId: { in: asli.lines.map((l) => l.id) } } }) : 0;
  const dialokasikan = b.allocations.reduce((s2, x) => s2 + sen(x.amount), 0);
  return {
    id: b.id,
    nomor: b.docNumber,
    tanggal: formatDateOnlyJakarta(b.date),
    pemasok: { id: b.supplierId, nama: pemasok?.name ?? "?", kode: pemasok?.code ?? "?" },
    cara: b.method,
    rekening: akun ? `${akun.name} (${akun.code})` : null,
    referensi: b.reference,
    bruto: Number(b.grossAmount),
    potong: Number(b.withholdingAmount),
    jenisPotong: b.withholdingType,
    neto: Number(b.netAmount),
    uangMukaSisa: (sen(b.grossAmount) - dialokasikan) / 100,
    dokumen: b.allocations.map((x) => x.note ?? "-"),
    jumlahDokumen: b.allocations.length,
    status: b.status === "CANCELLED" ? "CANCELLED" : "POSTED",
    cerminTandaiLunas: adalahCerminTandaiLunas(b.idempotencyKey),
    catatan: b.note,
    jatuhTempoGiro: b.giroDueDate ? formatDateOnlyJakarta(b.giroDueDate) : null,
    fotoUrl: b.proofPhotoUrl,
    pencatat: u.get(b.createdById) ?? null,
    dibuat: b.createdAt.toISOString(),
    dibatalkan: b.cancelledAt ? { pada: b.cancelledAt.toISOString(), oleh: b.cancelledById ? (u.get(b.cancelledById) ?? null) : null, alasan: b.cancelReason } : null,
    alokasi: b.allocations.map((x) => ({
      id: x.id,
      jenis: x.targetType,
      targetId: x.targetId,
      jumlah: Number(x.amount),
      label: x.note ?? x.targetId ?? "-",
      poId: x.targetType === "PO" ? x.targetId : x.targetType === "GRN" && x.targetId ? (g.get(x.targetId) ?? null) : null,
      woId: x.targetType === "WO_STEP" && x.targetId ? (st.get(x.targetId) ?? null) : null,
    })),
    jurnalId: asli?.id ?? null,
    jurnalBalikId: balik?.id ?? null,
    mutasiTercocok,
    dibebaskanSkb: Number(b.withholdingAmount) === 0 ? bacaDibebaskanSkb(jejak?.metadata) : null,
  };
}

// ───────────────────── Umur hutang ─────────────────────

export type BarisUmurPemasok = BarisUmur & {
  supplierId: string;
  kode: string;
  nama: string;
  grnBelumBerjurnal: number;
  dokumen: Array<Pick<DokumenHutang, "jenis" | "id" | "nomor" | "poId" | "poNomor" | "woId" | "tanggal"> & { sisa: number; umurHari: number }>;
};

export type LaporanUmurHutang = {
  tanggal: string;
  baris: BarisUmurPemasok[];
  total: BarisUmur;
  /** Saldo akun hutang usaha di buku besar (sen) — pembanding Σ buku pembantu. */
  saldoBukuBesarSen: number | null;
  apBelumDipetakan: boolean;
};

/** Umur hutang per pemasok per `tanggal` (saldo = saat ini; umur dihitung sampai tanggal itu). */
export async function umurHutangPemasok(tanggal: string, opsi: { supplierIds?: string[] } = {}): Promise<LaporanUmurHutang> {
  const [h, gl] = await Promise.all([bacaHutangPemasok({ hanyaAda: true, ...(opsi.supplierIds ? { supplierIds: opsi.supplierIds } : {}) }), saldoHutangUsahaBukuBesarSen()]);
  const msHari = (t: string) => Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
  const baris: BarisUmurPemasok[] = h.pemasok.map((p) => {
    const dokumen = p.dokumen.filter((d) => d.sisaSen !== 0);
    const umur = susunUmur(
      dokumen.map((d) => ({ kunci: `${d.jenis}|${d.id}`, tanggal: d.tanggal, sisaSen: d.sisaSen })),
      tanggal,
      p.uangMukaSen + p.lebihBayarSen,
    );
    return {
      ...umur,
      supplierId: p.supplierId,
      kode: p.kode,
      nama: p.nama,
      grnBelumBerjurnal: p.grnBelumBerjurnal,
      dokumen: dokumen.map((d) => ({
        jenis: d.jenis,
        id: d.id,
        nomor: d.nomor,
        poId: d.poId,
        poNomor: d.poNomor,
        woId: d.woId,
        tanggal: d.tanggal,
        sisa: d.sisaSen / 100,
        umurHari: Math.round((msHari(tanggal) - msHari(d.tanggal)) / 86_400_000),
      })),
    };
  });
  return { tanggal, baris, total: jumlahkanUmur(baris), saldoBukuBesarSen: gl, apBelumDipetakan: h.apBelumDipetakan };
}
