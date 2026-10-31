import { prisma, type Prisma } from "@elorae/db";
import { Decimal } from "decimal.js";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { computeStepDays, resolveChain, type LeadTimeType } from "@/lib/leadtime/calculations";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import { geserHari, hariIniWib } from "@/lib/tanggal-isian";
import { keadaanLangkah, ringkasJadwal, type KeadaanLangkah, type RingkasanJadwal, type StatusLangkah } from "./jadwal";
import { UKURAN_HALAMAN_FOLLOW_UP, type SaringanFollowUp } from "./jadwal-jejak";
import { ambilKalenderKerja } from "./jadwal-pengaturan";

/*
 * Jadwal proses per tahap Plan Kerja — kueri (2026-10-07).
 *
 * Semua tanggal keluar sebagai teks "YYYY-MM-DD" (hari kalender WIB), bukan
 * `Date`, jadi layar tidak pernah menggeser harinya. "Hari ini" = hari ini WIB.
 * Keadaan langkah (TELAT/HARI_INI/…) dihitung di sini dengan `keadaanLangkah`
 * — "telat" baru sesudah harinya lewat.
 *
 * Saringan follow-up punya SATU definisi (`whereFollowUp`), dipakai daftar,
 * jumlah per tab, dan hitungan antrean Beranda — angka Beranda = baris yang
 * tampil begitu tautannya dibuka.
 */

const keTeks = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);
const keTanggal = (teks: string): Date => parseDateOnly(teks) as Date;

/** Tautan obrolan WhatsApp pemasok (tanpa pesan) — layar menambahkan `?text=` sendiri. */
export function tautanWaPemasok(telepon: string | null | undefined): string | null {
  const n = nomorWhatsApp(telepon);
  return n ? `https://wa.me/${n}` : null;
}

export type PemasokLangkah = { id: string; name: string; wa: string | null };

function pemasokLangkah(s: { id: string; name: string; phone: string | null } | null): PemasokLangkah | null {
  return s ? { id: s.id, name: s.name, wa: tautanWaPemasok(s.phone) } : null;
}

function bulanSah(tahun: number, bulan: number): boolean {
  return Number.isInteger(tahun) && tahun >= 2000 && tahun <= 2100 && Number.isInteger(bulan) && bulan >= 1 && bulan <= 12;
}

/** [awal bulan, awal bulan berikutnya) sebagai instan tengah malam WIB. */
function rentangBulan(tahun: number, bulan: number): { gte: Date; lt: Date } {
  const dua = (n: number) => String(n).padStart(2, "0");
  const berikut = bulan === 12 ? { t: tahun + 1, b: 1 } : { t: tahun, b: bulan + 1 };
  return { gte: keTanggal(`${tahun}-${dua(bulan)}-01`), lt: keTanggal(`${berikut.t}-${dua(berikut.b)}-01`) };
}

// ─── Ruang kerja tahap ──────────────────────────────────────────────────────

export type LangkahRuangKerja = {
  id: string;
  sequence: number;
  name: string;
  durationDays: number;
  /** "YYYY-MM-DD" */
  targetDate: string;
  /** "YYYY-MM-DD" | null — hanya bila SELESAI. */
  doneDate: string | null;
  status: StatusLangkah;
  keadaan: KeadaanLangkah;
  note: string | null;
  pemasok: PemasokLangkah | null;
};

export type PoTahap = {
  id: string;
  docNumber: string;
  status: string;
  supplierName: string;
  /** "YYYY-MM-DD" | null */
  etaDate: string | null;
  grandTotal: number;
};

export type KebutuhanBahan = {
  itemId: string;
  nama: string;
  sku: string;
  satuan: string;
  /** Pemakaian per pcs barang jadi (aturan konsumsi). */
  perPcs: number;
  wastePercent: number;
  /** qty tahap × per pcs × (1 + waste%), dua desimal. */
  butuh: number;
  /** Σ qty baris PO tahap ini (PO tidak CANCELLED) untuk bahan ini; 0 bila tidak boleh melihat PO. */
  diPo: number;
  /** Σ qty diterima baris yang sama. */
  diterima: number;
};

export type LangkahSumberLeadTime = {
  /** `SupplierProcess.sequence` — kirim kembali apa adanya ke `tarikJadwalAction`. */
  sequence: number;
  name: string;
  type: LeadTimeType;
  days: number;
  rateQty: number | null;
  /** Lama untuk qty tahap ini (sebanding, `computeStepDays`). */
  hariUntukQty: number;
};

export type SumberLeadTime = {
  supplierId: string;
  supplierName: string;
  /** Jenis pemasok (SupplierType.name). */
  jenis: string;
  langkah: LangkahSumberLeadTime[];
};

export type RuangKerjaTahap = {
  tahap: {
    id: string;
    name: string;
    targetQty: number;
    targetMonth: number | null;
    variantSku: string | null;
    /** Tahun plan (PlanYear.year). */
    planYear: number;
    planYearId: string;
    /** Status plan tahunan. */
    statusPlan: "DRAFT" | "ACTIVE";
    planTerkunci: boolean;
    kategori: { id: string; code: string; name: string };
    barang: { id: string; sku: string; nama: string } | null;
    penjahit: { id: string; name: string } | null;
    /** "YYYY-MM-DD" | null */
    scheduleStart: string | null;
    /** "YYYY-MM-DD" | null — tenggat bila disusun mundur. */
    deadline: string | null;
  };
  langkah: LangkahRuangKerja[];
  ringkasan: RingkasanJadwal;
  /** null juga bila penonton tidak memegang `work_orders:view`. */
  wo: { id: string; docNumber: string; status: string } | null;
  /** Kosong bila penonton tidak memegang `purchase_orders:view`. */
  po: PoTahap[];
  kebutuhan: KebutuhanBahan[];
  sumberLeadTime: SumberLeadTime[];
  /** Hari kerja produksi (0 = Minggu … 6 = Sabtu). */
  hariKerja: number[];
  /** Tanggal merah "YYYY-MM-DD", urut. */
  tanggalMerah: string[];
  /** Hari ini WIB saat dibaca — dipakai layar untuk pratinjau dengan pustaka murni yang sama. */
  hariIni: string;
};

export type OpsiLihat = { lihatPo: boolean; lihatSpk: boolean };

const angka = (d: Prisma.Decimal | Decimal | number | string | null | undefined): number =>
  d === null || d === undefined ? 0 : Number(d.toString());

export async function ruangKerjaTahap(planStageId: string, opsi: OpsiLihat): Promise<RuangKerjaTahap | null> {
  if (!planStageId) return null;
  const tahap = await prisma.planStage.findUnique({
    where: { id: planStageId },
    select: {
      id: true,
      name: true,
      targetQty: true,
      targetMonth: true,
      variantSku: true,
      scheduleStart: true,
      deadline: true,
      planCategory: {
        select: {
          id: true,
          code: true,
          name: true,
          planYear: { select: { id: true, year: true, status: true, isLocked: true } },
          item: { select: { id: true, sku: true, nameId: true } },
        },
      },
      supplier: { select: { id: true, name: true } },
      workOrder: { select: { id: true, docNumber: true, status: true } },
      steps: {
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sequence: true,
          name: true,
          durationDays: true,
          targetDate: true,
          doneDate: true,
          status: true,
          note: true,
          supplier: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });
  if (!tahap) return null;

  const hariIni = hariIniWib();
  const barang = tahap.planCategory.item;

  const [kalender, po, aturan, rantai] = await Promise.all([
    ambilKalenderKerja(),
    opsi.lihatPo
      ? prisma.purchaseOrder.findMany({
          where: { planStageId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            docNumber: true,
            status: true,
            etaDate: true,
            grandTotal: true,
            supplier: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    barang
      ? prisma.consumptionRule.findMany({
          where: { finishedGoodId: barang.id, isActive: true },
          orderBy: [{ material: { nameId: "asc" } }, { id: "asc" }],
          select: {
            qtyRequired: true,
            wastePercent: true,
            material: { select: { id: true, sku: true, nameId: true, uom: { select: { code: true } } } },
          },
        })
      : Promise.resolve([]),
    prisma.supplier.findMany({
      where: { isActive: true, status: "ACTIVE", processChain: { some: {} } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        type: { select: { name: true } },
        processChain: { include: { processTemplate: true }, orderBy: { sequence: "asc" } },
      },
    }),
  ]);

  const terPo =
    opsi.lihatPo && aturan.length > 0
      ? await prisma.pOItem.groupBy({
          by: ["itemId"],
          where: {
            itemId: { in: aturan.map((a) => a.material.id) },
            po: { planStageId, status: { not: "CANCELLED" } },
          },
          _sum: { qty: true, receivedQty: true },
        })
      : [];

  const langkah: LangkahRuangKerja[] = tahap.steps.map((s) => {
    const targetDate = keTeks(s.targetDate) ?? "";
    return {
      id: s.id,
      sequence: s.sequence,
      name: s.name,
      durationDays: s.durationDays,
      targetDate,
      doneDate: keTeks(s.doneDate),
      status: s.status,
      keadaan: keadaanLangkah(s.status, targetDate, hariIni),
      note: s.note,
      pemasok: pemasokLangkah(s.supplier),
    };
  });

  const kebutuhan: KebutuhanBahan[] = aturan.map((a) => {
    const perPcs = new Decimal(a.qtyRequired.toString());
    const waste = new Decimal(a.wastePercent.toString());
    const butuh = perPcs.mul(tahap.targetQty).mul(new Decimal(1).plus(waste.div(100))).toDecimalPlaces(2);
    const sum = terPo.find((t) => t.itemId === a.material.id)?._sum;
    return {
      itemId: a.material.id,
      nama: a.material.nameId,
      sku: a.material.sku,
      satuan: a.material.uom.code,
      perPcs: perPcs.toNumber(),
      wastePercent: waste.toNumber(),
      butuh: butuh.toNumber(),
      diPo: angka(sum?.qty),
      diterima: angka(sum?.receivedQty),
    };
  });

  const sumberLeadTime: SumberLeadTime[] = rantai.flatMap((p) => {
    const langkahRantai = p.processChain
      .filter((r) => r.processTemplate.isActive)
      .map((r) => {
        const [l] = resolveChain([r]);
        return {
          sequence: r.sequence,
          name: l.name,
          type: l.type,
          days: l.days,
          rateQty: l.rateQty,
          hariUntukQty: computeStepDays(l, tahap.targetQty),
        };
      });
    return langkahRantai.length > 0
      ? [{ supplierId: p.id, supplierName: p.name, jenis: p.type.name, langkah: langkahRantai }]
      : [];
  });

  const plan = tahap.planCategory.planYear;
  return {
    tahap: {
      id: tahap.id,
      name: tahap.name,
      targetQty: tahap.targetQty,
      targetMonth: tahap.targetMonth,
      variantSku: tahap.variantSku,
      planYear: plan.year,
      planYearId: plan.id,
      statusPlan: plan.status,
      planTerkunci: plan.isLocked,
      kategori: { id: tahap.planCategory.id, code: tahap.planCategory.code, name: tahap.planCategory.name },
      barang: barang ? { id: barang.id, sku: barang.sku, nama: barang.nameId } : null,
      penjahit: tahap.supplier ? { id: tahap.supplier.id, name: tahap.supplier.name } : null,
      scheduleStart: keTeks(tahap.scheduleStart),
      deadline: keTeks(tahap.deadline),
    },
    langkah,
    ringkasan: ringkasJadwal(langkah, hariIni),
    wo: opsi.lihatSpk && tahap.workOrder ? { ...tahap.workOrder } : null,
    po: po.map((p) => ({
      id: p.id,
      docNumber: p.docNumber,
      status: p.status,
      supplierName: p.supplier.name,
      etaDate: keTeks(p.etaDate),
      grandTotal: angka(p.grandTotal),
    })),
    kebutuhan,
    sumberLeadTime,
    hariKerja: kalender.hariKerja,
    tanggalMerah: kalender.tanggalMerah.map((t) => t.tanggal),
    hariIni,
  };
}

// ─── Ikhtisar per bulan (Kalender di Plan Kerja) ────────────────────────────

export type IkhtisarBulan = {
  bulan: number;
  /** Banyaknya tahap dengan bulan target ini. */
  tahap: number;
  /** Σ qty tahap. */
  qty: number;
  /** Langkah belum selesai yang targetnya sudah lewat. */
  langkahTelat: number;
  /** Tahap tanpa satu langkah pun. */
  tanpaJadwal: number;
  /** Tahap tanpa PO (yang tidak CANCELLED). */
  tanpaPo: number;
  /** Tahap yang semua langkahnya selesai (dan punya langkah). */
  selesai: number;
};

/** 12 baris (Jan–Des) untuk plan tahun `tahun`. Tahap tanpa bulan target tidak dihitung. */
export async function ikhtisarJadwalTahun(tahun: number): Promise<IkhtisarBulan[]> {
  const kosong = (bulan: number): IkhtisarBulan => ({
    bulan,
    tahap: 0,
    qty: 0,
    langkahTelat: 0,
    tanpaJadwal: 0,
    tanpaPo: 0,
    selesai: 0,
  });
  const hasil = Array.from({ length: 12 }, (_, i) => kosong(i + 1));
  if (!bulanSah(tahun, 1)) return hasil;
  const hariIni = hariIniWib();
  const tahap = await prisma.planStage.findMany({
    where: { planCategory: { planYear: { year: tahun } }, targetMonth: { gte: 1, lte: 12 } },
    select: {
      targetMonth: true,
      targetQty: true,
      steps: { select: { status: true, targetDate: true } },
      _count: { select: { purchaseOrders: { where: { status: { not: "CANCELLED" } } } } },
    },
  });
  for (const t of tahap) {
    const b = hasil[(t.targetMonth ?? 1) - 1];
    b.tahap += 1;
    b.qty += t.targetQty;
    if (t.steps.length === 0) b.tanpaJadwal += 1;
    if (t._count.purchaseOrders === 0) b.tanpaPo += 1;
    if (t.steps.length > 0 && t.steps.every((s) => s.status === "SELESAI")) b.selesai += 1;
    b.langkahTelat += t.steps.filter(
      (s) => keadaanLangkah(s.status, keTeks(s.targetDate) ?? "", hariIni) === "TELAT",
    ).length;
  }
  return hasil;
}

export type TahapBulan = {
  id: string;
  name: string;
  kategori: { id: string; code: string; name: string };
  targetQty: number;
  variantSku: string | null;
  ringkasan: RingkasanJadwal;
  /** null bila tanpa WO atau penonton tidak memegang `work_orders:view`. */
  wo: { id: string; docNumber: string; status: string } | null;
  /** PO tahap yang tidak CANCELLED; null bila penonton tidak memegang `purchase_orders:view`. */
  jumlahPo: number | null;
  /**
   * PO tahap yang tidak CANCELLED (urut dibuat), untuk tautan nomor PO di tab
   * Kalender; `[]` = "Belum ada PO". null bila penonton tidak memegang `purchase_orders:view`.
   */
  po: { id: string; docNumber: string }[] | null;
  penjahit: { id: string; name: string } | null;
};

/** Tahap plan `tahun` dengan bulan target `bulan`, urut kategori lalu urutan tahap. */
export async function tahapBulan(tahun: number, bulan: number, opsi: OpsiLihat): Promise<TahapBulan[]> {
  if (!bulanSah(tahun, bulan)) return [];
  const hariIni = hariIniWib();
  const tahap = await prisma.planStage.findMany({
    where: { planCategory: { planYear: { year: tahun } }, targetMonth: bulan },
    orderBy: [{ planCategory: { sortOrder: "asc" } }, { planCategory: { code: "asc" } }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      targetQty: true,
      variantSku: true,
      planCategory: { select: { id: true, code: true, name: true } },
      supplier: { select: { id: true, name: true } },
      workOrder: { select: { id: true, docNumber: true, status: true } },
      steps: { orderBy: [{ sequence: "asc" }, { id: "asc" }], select: { name: true, status: true, targetDate: true } },
      purchaseOrders: {
        where: { status: { not: "CANCELLED" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, docNumber: true },
      },
    },
  });
  return tahap.map((t) => ({
    id: t.id,
    name: t.name,
    kategori: { ...t.planCategory },
    targetQty: t.targetQty,
    variantSku: t.variantSku,
    ringkasan: ringkasJadwal(
      t.steps.map((s) => ({ name: s.name, status: s.status, targetDate: keTeks(s.targetDate) ?? "" })),
      hariIni,
    ),
    wo: opsi.lihatSpk && t.workOrder ? { ...t.workOrder } : null,
    jumlahPo: opsi.lihatPo ? t.purchaseOrders.length : null,
    po: opsi.lihatPo ? t.purchaseOrders.map((p) => ({ id: p.id, docNumber: p.docNumber })) : null,
    penjahit: t.supplier ? { ...t.supplier } : null,
  }));
}

// ─── Follow-up produksi ─────────────────────────────────────────────────────

/**
 * SATU definisi saringan follow-up: hanya langkah yang belum SELESAI.
 *  - hari-ini   : target = hari ini WIB
 *  - terlambat  : target sebelum hari ini WIB (harinya sudah lewat)
 *  - minggu-ini : hari ini s.d. hari ini + 6
 *  - semua      : semua yang belum selesai
 */
export function whereFollowUp(
  saring: SaringanFollowUp,
  hariIni: string,
  supplierId?: string | null,
): Prisma.PlanStageStepWhereInput {
  const awal = keTanggal(hariIni);
  const besok = keTanggal(geserHari(hariIni, 1));
  const tujuhHari = keTanggal(geserHari(hariIni, 7));
  const target =
    saring === "hari-ini"
      ? { gte: awal, lt: besok }
      : saring === "terlambat"
        ? { lt: awal }
        : saring === "minggu-ini"
          ? { gte: awal, lt: tujuhHari }
          : undefined;
  return {
    status: { not: "SELESAI" },
    ...(supplierId ? { supplierId } : {}),
    ...(target ? { targetDate: target } : {}),
  };
}

export type FollowUpBaris = {
  stepId: string;
  name: string;
  status: StatusLangkah;
  keadaan: KeadaanLangkah;
  /** "YYYY-MM-DD" */
  targetDate: string;
  durationDays: number;
  note: string | null;
  tahap: { id: string; name: string; targetQty: number };
  kategori: { code: string; name: string };
  tahun: number;
  pemasok: PemasokLangkah | null;
};

export type FollowUpProduksi = {
  baris: FollowUpBaris[];
  /** Jumlah per tab — dengan saringan pemasok yang sama. */
  jumlah: { hariIni: number; terlambat: number; mingguIni: number; semua: number };
  halaman: number;
  jumlahHalaman: number;
};

export async function followUpProduksi(opsi: {
  saring: SaringanFollowUp;
  supplierId?: string | null;
  halaman?: number;
}): Promise<FollowUpProduksi> {
  const hariIni = hariIniWib();
  const supplierId = opsi.supplierId || null;
  const [hariIniN, terlambat, mingguIni, semua] = await Promise.all(
    (["hari-ini", "terlambat", "minggu-ini", "semua"] as const).map((s) =>
      prisma.planStageStep.count({ where: whereFollowUp(s, hariIni, supplierId) }),
    ),
  );
  const jumlah = { hariIni: hariIniN, terlambat, mingguIni, semua };
  const total =
    opsi.saring === "hari-ini" ? hariIniN : opsi.saring === "terlambat" ? terlambat : opsi.saring === "minggu-ini" ? mingguIni : semua;
  const jumlahHalaman = Math.max(1, Math.ceil(total / UKURAN_HALAMAN_FOLLOW_UP));
  const halaman = Math.min(Math.max(1, Math.floor(opsi.halaman ?? 1) || 1), jumlahHalaman);

  const langkah = await prisma.planStageStep.findMany({
    where: whereFollowUp(opsi.saring, hariIni, supplierId),
    orderBy: [{ targetDate: "asc" }, { planStageId: "asc" }, { sequence: "asc" }, { id: "asc" }],
    skip: (halaman - 1) * UKURAN_HALAMAN_FOLLOW_UP,
    take: UKURAN_HALAMAN_FOLLOW_UP,
    select: {
      id: true,
      name: true,
      status: true,
      targetDate: true,
      durationDays: true,
      note: true,
      supplier: { select: { id: true, name: true, phone: true } },
      planStage: {
        select: {
          id: true,
          name: true,
          targetQty: true,
          planCategory: { select: { code: true, name: true, planYear: { select: { year: true } } } },
        },
      },
    },
  });

  return {
    baris: langkah.map((l) => {
      const targetDate = keTeks(l.targetDate) ?? "";
      return {
        stepId: l.id,
        name: l.name,
        status: l.status,
        keadaan: keadaanLangkah(l.status, targetDate, hariIni),
        targetDate,
        durationDays: l.durationDays,
        note: l.note,
        tahap: { id: l.planStage.id, name: l.planStage.name, targetQty: l.planStage.targetQty },
        kategori: { code: l.planStage.planCategory.code, name: l.planStage.planCategory.name },
        tahun: l.planStage.planCategory.planYear.year,
        pemasok: pemasokLangkah(l.supplier),
      };
    }),
    jumlah,
    halaman,
    jumlahHalaman,
  };
}

export type ChipKalenderProduksi = {
  stepId: string;
  name: string;
  status: StatusLangkah;
  keadaan: KeadaanLangkah;
  tahapId: string;
  tahapName: string;
  kodeKategori: string;
};

/** Kunci "YYYY-MM-DD" → langkah yang targetnya hari itu (semua status). */
export type KalenderProduksiBulan = Record<string, ChipKalenderProduksi[]>;

export async function kalenderProduksiBulan(
  tahun: number,
  bulan: number,
  opsi: { supplierId?: string | null } = {},
): Promise<KalenderProduksiBulan> {
  if (!bulanSah(tahun, bulan)) return {};
  const hariIni = hariIniWib();
  const langkah = await prisma.planStageStep.findMany({
    where: { targetDate: rentangBulan(tahun, bulan), ...(opsi.supplierId ? { supplierId: opsi.supplierId } : {}) },
    orderBy: [{ targetDate: "asc" }, { planStageId: "asc" }, { sequence: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      targetDate: true,
      planStage: { select: { id: true, name: true, planCategory: { select: { code: true } } } },
    },
  });
  const hasil: KalenderProduksiBulan = {};
  for (const l of langkah) {
    const hari = keTeks(l.targetDate) ?? "";
    (hasil[hari] ??= []).push({
      stepId: l.id,
      name: l.name,
      status: l.status,
      keadaan: keadaanLangkah(l.status, hari, hariIni),
      tahapId: l.planStage.id,
      tahapName: l.planStage.name,
      kodeKategori: l.planStage.planCategory.code,
    });
  }
  return hasil;
}

// ─── Antrean Beranda ────────────────────────────────────────────────────────

/** Langkah produksi terlambat — sama dengan tab "Terlambat" follow-up tanpa saringan pemasok. */
export function hitungLangkahTelat(): Promise<number> {
  return prisma.planStageStep.count({ where: whereFollowUp("terlambat", hariIniWib()) });
}

/** Langkah produksi yang jatuh tempo hari ini — sama dengan tab "Hari ini" follow-up. */
export function hitungLangkahHariIni(): Promise<number> {
  return prisma.planStageStep.count({ where: whereFollowUp("hari-ini", hariIniWib()) });
}
