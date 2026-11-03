import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { evaluasiPermintaan, PILIH_PERMINTAAN } from "./permintaan-invoice-queries";
import { tandaiPermintaanTerpenuhi } from "./permintaan-invoice-writer";
import { susunKabarInvoiceTerlambat, SUPPLIER_INVOICE_OVERDUE, type NotifikasiKantor } from "./kabar-pemasok";

/*
 * Pengingat permintaan invoice yang 7 hari belum terjawab (keputusan pemilik 2026-11-02, P19 "pengingat
 * bila 7 hari belum ada invoice"). Cron harian 08:45 Asia/Jakarta (`lib/cron/jobs.ts`). SATU pengingat
 * per permintaan per kali diminta: `remindedAt` adalah penandanya, di-compare-and-swap DI DALAM
 * transaksi yang sama dengan baris `AdminNotification`-nya, jadi gagal menulis lonceng meninggalkan
 * `remindedAt` kosong untuk run berikutnya. "Minta ulang" mengosongkannya lagi. Permintaan yang ternyata
 * sudah terpenuhi ditutup, tidak diingatkan. Fan-out di-`await` karena ini cron (tidak ada yang
 * menunggu) — jangan disalin ke jalur interaktif. Spec WAJIB memberi `requestIds` dan `asOf`.
 */

export async function runInvoiceRequestReminderSweep(o: { requestIds?: string[]; asOf?: Date } = {}): Promise<{ scanned: number; reminded: number; closed: number; failed: number }> {
  const hariIni = formatDateOnlyJakarta(o.asOf ?? new Date());
  const rows = await prisma.supplierInvoiceRequest.findMany({
    where: { cancelledAt: null, closedAt: null, remindedAt: null, ...(o.requestIds ? { id: { in: o.requestIds } } : {}) },
    select: PILIH_PERMINTAAN,
    orderBy: [{ lastRequestedAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  const hasil = { scanned: rows.length, reminded: 0, closed: 0, failed: 0 };
  if (rows.length === 0) return hasil;
  const evaluasi = await evaluasiPermintaan(prisma, rows, hariIni);
  const selesai = rows.filter((r) => {
    const e = evaluasi.get(r.id);
    return e && e.status !== "TERBUKA";
  });
  if (selesai.length > 0) {
    try {
      hasil.closed = await tandaiPermintaanTerpenuhi({ requestIds: selesai.map((r) => r.id) });
    } catch (e) {
      console.error("[runInvoiceRequestReminderSweep] tutup", e);
    }
  }
  const pemasok = new Map(
    (await prisma.supplier.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  );
  for (const r of rows) {
    const e = evaluasi.get(r.id);
    if (!e || e.status !== "TERBUKA" || !e.terlambat) continue;
    try {
      const n = await runSerializable(async (tx): Promise<NotifikasiKantor | null> => {
        let tertulis: NotifikasiKantor | null = null;
        const cas = await tx.supplierInvoiceRequest.updateMany({
          where: { id: r.id, remindedAt: null, closedAt: null, cancelledAt: null, lastRequestedAt: r.lastRequestedAt },
          data: { remindedAt: new Date() },
        });
        if (cas.count !== 1) return null;
        const nama = pemasok.get(r.supplierId) ?? "";
        const teks = susunKabarInvoiceTerlambat({ namaPemasok: nama, jumlah: r.lines.length, tanggalMinta: formatDateOnlyJakarta(r.lastRequestedAt) });
        tertulis = await tx.adminNotification.create({
          data: {
            category: SUPPLIER_INVOICE_OVERDUE,
            severity: "WARNING",
            title: teks.title,
            message: teks.message,
            metadata: {
              requestId: r.id,
              supplierId: r.supplierId,
              supplierName: nama,
              lastRequestedAt: r.lastRequestedAt.toISOString(),
              count: r.lines.length,
              amountSen: Math.round(r.lines.reduce((s, l) => s + Number(l.amount), 0) * 100),
            },
          },
          select: { id: true, category: true, title: true, message: true, metadata: true },
        });
        return tertulis;
      });
      if (!n) continue;
      hasil.reminded += 1;
      await fanOutAdminNotification(n);
    } catch (err) {
      hasil.failed += 1;
      console.error("[runInvoiceRequestReminderSweep]", r.id, err);
    }
  }
  return hasil;
}
