// Bukan aksi server — PPh yang dipotong dari pembayaran pemasok dan voucher kas
// keluar, per masa. KHUSUS SERVER: komponen klien hanya `import type`.

import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { bacaJenisPotongPemasok, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { JEJAK_KAS } from "./jejak";

type Klien = Prisma.TransactionClient | typeof prisma;

export type BarisPotongPemasok = {
  sumber: "PEMBAYARAN_PEMASOK" | "VOUCHER_KAS";
  id: string;
  nomor: string;
  tanggal: string;
  pihak: string;
  /** "NPWP ••••1234", "tanpa NPWP", atau null bila bukan pemasok terdaftar. */
  identitas: string | null;
  jenis: JenisPotongPemasok;
  /** Dasar potongan (dari jejak pencatatan); null bila tidak tercatat. */
  dasar: number | null;
  pph: number;
  /**
   * Pembayaran yang DIBEBASKAN SKB pemasok (PPh 0): `jenis` = jenis yang
   * dibebaskan, `dasar` = dasar yang akan dipotong tanpa SKB. null = baris biasa.
   */
  dibebaskanSkb: { nomor: string; berlakuSampai: string } | null;
};

/** Awal bulan WIB "YYYY-MM" dan awal bulan berikutnya. */
function batasMasa(masa: string): { dari: Date; sampai: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(masa)) return null;
  const [y, m] = masa.split("-").map(Number);
  const dari = parseDateOnly(`${masa}-01`);
  const berikut = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const sampai = parseDateOnly(berikut);
  return dari && sampai ? { dari, sampai } : null;
}

/** `metadata.dibebaskanSkb` jejak pencatatan → pembebasan (atau null bila tidak sah). */
function bacaPembebasan(v: unknown): { jenis: JenisPotongPemasok; dasar: number | null; skb: { nomor: string; berlakuSampai: string } } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const jenis = bacaJenisPotongPemasok(o.jenis);
  if (!jenis || typeof o.nomor !== "string" || typeof o.berlakuSampai !== "string") return null;
  return { jenis, dasar: typeof o.dasar === "number" ? o.dasar : null, skb: { nomor: o.nomor, berlakuSampai: o.berlakuSampai } };
}

function identitasPemasok(p: { hasNpwp: boolean; npwpLast4: string | null } | undefined): string | null {
  if (!p) return null;
  if (!p.hasNpwp) return "tanpa NPWP";
  return p.npwpLast4 ? `NPWP ••••${p.npwpLast4}` : "NPWP belum diisi";
}

/**
 * Pembayaran pemasok dan voucher kas keluar BERLAKU ber-PPh yang tanggal
 * bayarnya di masa itu (bulan WIB). Dasar potongan dibaca dari metadata jejak
 * pencatatannya (`SUPPLIER_PAYMENT_RECORDED` / `CASH_VOUCHER_RECORDED`) —
 * tidak ada kolom dasar potongan di tabelnya.
 *
 * Ditambah baris bernilai 0 untuk pembayaran/voucher tanpa PPh yang jejaknya
 * mencatat `dibebaskanSkb` (SKB pemasok berlaku pada hari bayar) — supaya
 * pembebasannya terlihat di masa yang sama dengan potongan lainnya.
 */
export async function daftarPotongPemasokKas(masa: string, klien: Klien = prisma): Promise<BarisPotongPemasok[]> {
  const b = batasMasa(masa);
  if (!b) return [];
  // Tanpa PPh: kandidat pembebasan SKB (dipastikan dari jejaknya di bawah).
  const [bayar, voucher] = await Promise.all([
    klien.supplierPayment.findMany({
      where: { status: "POSTED", date: { gte: b.dari, lt: b.sampai } },
      select: { id: true, docNumber: true, date: true, supplierId: true, withholdingType: true, withholdingAmount: true },
      orderBy: { date: "asc" },
    }),
    klien.cashVoucher.findMany({
      where: { status: "POSTED", type: "OUT", date: { gte: b.dari, lt: b.sampai }, OR: [{ withholdingAmount: { gt: 0 } }, { supplierId: { not: null } }] },
      select: { id: true, docNumber: true, date: true, supplierId: true, counterpart: true, withholdingType: true, withholdingAmount: true },
      orderBy: { date: "asc" },
    }),
  ]);
  const pemasokIds = [...new Set([...bayar.map((x) => x.supplierId), ...voucher.map((x) => x.supplierId).filter((x): x is string => Boolean(x))])];
  const [pemasok, jejak] = await Promise.all([
    pemasokIds.length ? klien.supplier.findMany({ where: { id: { in: pemasokIds } }, select: { id: true, name: true, hasNpwp: true, npwpLast4: true } }) : [],
    klien.auditLog.findMany({
      where: {
        action: { in: [JEJAK_KAS.PEMBAYARAN_DICATAT, JEJAK_KAS.VOUCHER_DICATAT] },
        entityId: { in: [...bayar.map((x) => x.id), ...voucher.map((x) => x.id)] },
      },
      select: { entityId: true, metadata: true },
    }),
  ]);
  const p = new Map(pemasok.map((x) => [x.id, x]));
  const dasar = new Map<string, number>();
  const bebas = new Map<string, { jenis: JenisPotongPemasok; dasar: number | null; skb: { nomor: string; berlakuSampai: string } }>();
  for (const j of jejak) {
    const m = j.metadata as { dasarPotong?: unknown; dibebaskanSkb?: unknown } | null;
    if (!j.entityId) continue;
    if (typeof m?.dasarPotong === "number") dasar.set(j.entityId, m.dasarPotong);
    const s = bacaPembebasan(m?.dibebaskanSkb);
    if (s) bebas.set(j.entityId, s);
  }
  const hasil: BarisPotongPemasok[] = [];
  const baris = (
    x: { id: string; docNumber: string; date: Date; withholdingType: string | null; withholdingAmount: Prisma.Decimal },
    sumber: BarisPotongPemasok["sumber"],
    pihak: string,
    identitas: string | null,
  ) => {
    const tanggal = formatDateOnlyJakarta(x.date);
    const jenis = Number(x.withholdingAmount) > 0 ? bacaJenisPotongPemasok(x.withholdingType) : null;
    if (jenis) {
      hasil.push({ sumber, id: x.id, nomor: x.docNumber, tanggal, pihak, identitas, jenis, dasar: dasar.get(x.id) ?? null, pph: Number(x.withholdingAmount), dibebaskanSkb: null });
      return;
    }
    const s = Number(x.withholdingAmount) === 0 ? bebas.get(x.id) : undefined;
    if (s) hasil.push({ sumber, id: x.id, nomor: x.docNumber, tanggal, pihak, identitas, jenis: s.jenis, dasar: s.dasar, pph: 0, dibebaskanSkb: s.skb });
  };
  for (const x of bayar) {
    const s = p.get(x.supplierId);
    baris(x, "PEMBAYARAN_PEMASOK", s?.name ?? "?", identitasPemasok(s));
  }
  for (const x of voucher) {
    const s = x.supplierId ? p.get(x.supplierId) : undefined;
    baris(x, "VOUCHER_KAS", s?.name ?? x.counterpart ?? "–", identitasPemasok(s));
  }
  return hasil.sort((a, z) => a.tanggal.localeCompare(z.tanggal) || a.nomor.localeCompare(z.nomor));
}
