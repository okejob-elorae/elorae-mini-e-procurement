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
 */
export async function daftarPotongPemasokKas(masa: string, klien: Klien = prisma): Promise<BarisPotongPemasok[]> {
  const b = batasMasa(masa);
  if (!b) return [];
  const [bayar, voucher] = await Promise.all([
    klien.supplierPayment.findMany({
      where: { status: "POSTED", withholdingAmount: { gt: 0 }, date: { gte: b.dari, lt: b.sampai } },
      select: { id: true, docNumber: true, date: true, supplierId: true, withholdingType: true, withholdingAmount: true },
      orderBy: { date: "asc" },
    }),
    klien.cashVoucher.findMany({
      where: { status: "POSTED", type: "OUT", withholdingAmount: { gt: 0 }, date: { gte: b.dari, lt: b.sampai } },
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
  for (const j of jejak) {
    const m = j.metadata as { dasarPotong?: unknown } | null;
    if (j.entityId && typeof m?.dasarPotong === "number") dasar.set(j.entityId, m.dasarPotong);
  }
  const hasil: BarisPotongPemasok[] = [];
  for (const x of bayar) {
    const jenis = bacaJenisPotongPemasok(x.withholdingType);
    if (!jenis) continue;
    const s = p.get(x.supplierId);
    hasil.push({ sumber: "PEMBAYARAN_PEMASOK", id: x.id, nomor: x.docNumber, tanggal: formatDateOnlyJakarta(x.date), pihak: s?.name ?? "?", identitas: identitasPemasok(s), jenis, dasar: dasar.get(x.id) ?? null, pph: Number(x.withholdingAmount) });
  }
  for (const x of voucher) {
    const jenis = bacaJenisPotongPemasok(x.withholdingType);
    if (!jenis) continue;
    const s = x.supplierId ? p.get(x.supplierId) : undefined;
    hasil.push({ sumber: "VOUCHER_KAS", id: x.id, nomor: x.docNumber, tanggal: formatDateOnlyJakarta(x.date), pihak: s?.name ?? x.counterpart ?? "–", identitas: identitasPemasok(s), jenis, dasar: dasar.get(x.id) ?? null, pph: Number(x.withholdingAmount) });
  }
  return hasil.sort((a, z) => a.tanggal.localeCompare(z.tanggal) || a.nomor.localeCompare(z.nomor));
}
