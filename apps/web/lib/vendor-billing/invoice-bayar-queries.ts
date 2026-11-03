import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { kunciDokumenHutang } from "@/lib/purchasing/pembayaran-aturan";
import { bacaHutangPemasok, keadaanBayarPo } from "@/lib/purchasing/pembayaran-hutang-queries";
import { urutkanInvoice } from "./bill-paid-rule";
import { bacaTagihanSumber } from "./belum-ditagih-queries";
import { penerimaanKoreksiMenunggu } from "./koreksi-utang-queries";
import { rincianLunasPerSumber, withSupplierPaid } from "./supplier-paid";
import type { VendorBillStatus } from "./status";

/*
 * Data kartu "Bayar per invoice" di Pembayaran pemasok → Bayar (Q19; P20; Q16; P29). KHUSUS SERVER —
 * komponen klien hanya `import type`. Dibangun di atas `rincianLunasPerSumber`, pembaca yang SAMA dengan
 * status lunas tagihan (`withSupplierPaid`), jadi isian pemilih dan status invoice selalu sepakat.
 * Hanya MariaDB (tabel tagihan vendor); halaman membungkusnya supaya basis data tanpa tabel itu tetap
 * menampilkan formulir tanpa kartunya.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type InvoiceUntukBayar = {
  id: string;
  docNumber: string;
  vendorInvoiceNo: string;
  billDate: string;
  createdAt: string;
  /** Total invoice dicatat (sebelum PPN untuk baris tanpa PPN). */
  total: number;
  paidAmount: number;
  status: VendorBillStatus;
  /** `kunciDokumenHutang` penerimaan yang disebutnya. */
  penerimaan: string[];
  koreksi: Array<{ id: string; status: string; jumlahSen: number }>;
};

export type PenerimaanInvoice = {
  kunci: string;
  jenis: "GRN" | "WO_STEP";
  id: string;
  nomor: string;
  poNomor: string | null;
  /** Ada di buku pembantu hutang (sudah berjurnal). */
  adaHutang: boolean;
  hutangSen: number;
  lunasSen: number;
  sisaSen: number;
  /** Baris tagihan hidup di penerimaan ini, urut tanggal invoice (P29). */
  baris: Array<{ billId: string; urutan: number; tercatatSen: number }>;
  koreksiMenunggu: Array<{ billId: string; vendorInvoiceNo: string }>;
  /** PO-nya ditandai lunas lewat tombol lama tanpa alokasi dokumen (ditolak penulis: `PO_DITANDAI_LUNAS`). */
  poDitandaiLunas: boolean;
  /** Pcs yang belum disebut invoice mana pun dan tidak dibebaskan ("Invoice belum diterima", P19). */
  qtyBelumDitagih: number;
};

export type DataBayarInvoice = {
  invoice: InvoiceUntukBayar[];
  penerimaan: PenerimaanInvoice[];
  /** Nomor invoice setiap tagihan hidup di penerimaan-penerimaan itu, untuk catatan "ikut melunasi". */
  nomorInvoice: Record<string, string>;
};

export async function bacaInvoiceUntukBayar(supplierId: string, db: Db = prisma): Promise<DataBayarInvoice> {
  const [hutang, bills] = await Promise.all([
    bacaHutangPemasok({ supplierIds: [supplierId] }, db),
    db.vendorBill.findMany({
      where: { supplierId, status: { not: "VOID" } },
      select: {
        id: true,
        docNumber: true,
        vendorInvoiceNo: true,
        billDate: true,
        createdAt: true,
        total: true,
        paidAmount: true,
        status: true,
        lines: { select: { id: true, grnId: true, woStepId: true } },
      },
    }),
  ]);
  const dokumen = (hutang.pemasok[0]?.dokumen ?? []).filter((d) => d.jenis === "GRN" || d.jenis === "WO_STEP");
  const dokPer = new Map(dokumen.map((d) => [kunciDokumenHutang(d.jenis, d.id), d]));

  const kunciBill = new Map<string, string[]>();
  const grnIds = new Set(dokumen.filter((d) => d.jenis === "GRN").map((d) => d.id));
  const stepIds = new Set(dokumen.filter((d) => d.jenis === "WO_STEP").map((d) => d.id));
  for (const b of bills) {
    const k = new Set<string>();
    for (const l of b.lines) {
      if (l.grnId) {
        k.add(kunciDokumenHutang("GRN", l.grnId));
        grnIds.add(l.grnId);
      } else if (l.woStepId) {
        k.add(kunciDokumenHutang("WO_STEP", l.woStepId));
        stepIds.add(l.woStepId);
      }
    }
    kunciBill.set(b.id, [...k]);
  }

  const semuaKunci = [...[...grnIds].map((id) => kunciDokumenHutang("GRN", id)), ...[...stepIds].map((id) => kunciDokumenHutang("WO_STEP", id))];
  const [rinci, paid, menunggu, tagih, koreksi] = await Promise.all([
    rincianLunasPerSumber(db, { grnIds: [...grnIds], woStepIds: [...stepIds] }),
    withSupplierPaid(bills.map((b) => ({ id: b.id, total: Number(b.total), paidAmount: Number(b.paidAmount), status: b.status })), db),
    penerimaanKoreksiMenunggu(db, semuaKunci),
    bacaTagihanSumber(db, [...[...grnIds].map((id) => ({ jenis: "GRN" as const, id })), ...[...stepIds].map((id) => ({ jenis: "WO_STEP" as const, id }))]),
    db.supplierPayableCorrection.findMany({ where: { billId: { in: bills.map((b) => b.id) }, status: { not: "DIBATALKAN" } }, select: { id: true, billId: true, status: true, amount: true } }),
  ]);
  const paidPer = new Map(paid.map((p) => [p.id, p]));

  const grnPo = grnIds.size > 0 ? await db.gRN.findMany({ where: { id: { in: [...grnIds] } }, select: { id: true, docNumber: true, poId: true, po: { select: { docNumber: true, paidAt: true } } } }) : [];
  const poLunas = [...new Set(grnPo.filter((g) => g.poId && g.po?.paidAt).map((g) => g.poId as string))];
  const keadaanPo = poLunas.length > 0 ? await keadaanBayarPo(poLunas, db) : new Map();
  const ditandaiTombolLama = new Set(poLunas.filter((p) => !keadaanPo.get(p)?.adaAlokasiDokumen));
  const steps = stepIds.size > 0 ? await db.workOrderStep.findMany({ where: { id: { in: [...stepIds] } }, select: { id: true, sequence: true, stepName: true, wo: { select: { docNumber: true } } } }) : [];
  const grnPer = new Map(grnPo.map((g) => [g.id, g]));
  const stepPer = new Map(steps.map((s) => [s.id, s]));

  const penerimaan: PenerimaanInvoice[] = semuaKunci.map((kunci) => {
    const [jenis, id] = [kunci.slice(0, kunci.indexOf("|")) as "GRN" | "WO_STEP", kunci.slice(kunci.indexOf("|") + 1)];
    const d = dokPer.get(kunci);
    const r = rinci.get(kunci);
    const g = jenis === "GRN" ? grnPer.get(id) : undefined;
    const s = jenis === "WO_STEP" ? stepPer.get(id) : undefined;
    return {
      kunci,
      jenis,
      id,
      nomor: d?.nomor ?? g?.docNumber ?? (s ? `${s.wo.docNumber} · ${s.sequence}${s.stepName ? ` ${s.stepName}` : ""}` : id),
      poNomor: d?.poNomor ?? g?.po?.docNumber ?? null,
      adaHutang: d != null,
      hutangSen: d?.hutangSen ?? 0,
      lunasSen: r?.lunasSen ?? 0,
      sisaSen: d?.sisaSen ?? 0,
      baris: (r?.baris ?? []).map((b) => ({ billId: b.billId, urutan: b.urutan, tercatatSen: b.tercatatSen })),
      koreksiMenunggu: menunggu.get(kunci) ?? [],
      poDitandaiLunas: g?.poId != null && ditandaiTombolLama.has(g.poId),
      qtyBelumDitagih: tagih.get(kunci)?.belum ?? 0,
    };
  });

  const invoice: InvoiceUntukBayar[] = urutkanInvoice(bills)
    .map((b) => {
      const p = paidPer.get(b.id);
      return {
        id: b.id,
        docNumber: b.docNumber,
        vendorInvoiceNo: b.vendorInvoiceNo,
        billDate: formatDateOnlyJakarta(b.billDate),
        createdAt: b.createdAt.toISOString(),
        total: Number(b.total),
        paidAmount: p?.paidAmount ?? Number(b.paidAmount),
        status: p?.status ?? b.status,
        penerimaan: kunciBill.get(b.id) ?? [],
        koreksi: koreksi.filter((k) => k.billId === b.id).map((k) => ({ id: k.id, status: k.status, jumlahSen: Math.round(Number(k.amount) * 100) })),
      };
    })
    .filter((b) => b.status === "UNPAID" || b.status === "PARTIAL");

  return { invoice, penerimaan, nomorInvoice: Object.fromEntries(bills.map((b) => [b.id, b.vendorInvoiceNo])) };
}
