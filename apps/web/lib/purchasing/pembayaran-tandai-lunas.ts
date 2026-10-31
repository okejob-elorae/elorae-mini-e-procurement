import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { catatJejakKas, JEJAK_KAS } from "@/lib/finance/kas/jejak";
import { AWALAN_KUNCI_TANDAI_LUNAS, kunciTandaiLunas, STATUS_PEMBAYARAN } from "./pembayaran-aturan";
import { generasiTandaiLunas } from "./supplier-payment-journal";

/**
 * Tombol lama "Tandai lunas" PO sebagai SATU pembayaran penuh (rancangan D2).
 *
 * Jurnal tombol itu tetap ditulis oleh `postSupplierPaymentJournal` dengan
 * sumbernya sendiri (`SUPPLIER_PAYMENT`, `<poId>#<generasi>`) — semua kode
 * penolakan dan balapan lamanya tetap bekerja persis. Yang ditambahkan di sini
 * hanya CERMIN-nya di daftar pembayaran: satu `SupplierPayment` bernomor BYR/…
 * berkunci `tandai-lunas:<poId>#<generasi>`, beralokasi `PO` sebesar jurnal
 * yang berdiri. Cermin TIDAK dijurnal lagi (jurnalnya sudah ada) dan tidak
 * dihitung sebagai alokasi oleh buku pembantu hutang (yang membaca jurnal tombol
 * lama langsung), jadi kehilangan cermin tidak pernah mengubah angka hutang.
 *
 * `selaraskanCerminTandaiLunas` idempoten: membuat cermin untuk jurnal yang
 * berdiri tanpa cermin, dan membatalkan cermin yang jurnalnya sudah dibalik.
 * Dipanggil SESUDAH commit tombol (best-effort, tidak pernah melempar ke
 * pemanggil) dan oleh skrip isi-ulang untuk riwayat lama.
 */

type Klien = Prisma.TransactionClient;

async function jurnalGenerasi(tx: Klien, poId: string) {
  const semua = await tx.journal.findMany({
    where: { sourceType: { in: ["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"] }, sourceId: { startsWith: `${poId}#` } },
    select: { sourceType: true, sourceId: true, date: true, lines: { select: { chartAccountId: true, debit: true, credit: true } } },
  });
  const dibalik = new Set(semua.filter((j) => j.sourceType === "SUPPLIER_PAYMENT_REVERSAL").map((j) => j.sourceId));
  return semua.filter((j) => j.sourceType === "SUPPLIER_PAYMENT").map((j) => ({ ...j, berdiri: !dibalik.has(j.sourceId) }));
}

export type HasilCermin = { dibuat: number; dibatalkan: number };

export async function selaraskanCerminTandaiLunasDalam(tx: Klien, poId: string, olehUserId: string): Promise<HasilCermin> {
  const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { id: true, docNumber: true, supplierId: true } });
  if (!po) return { dibuat: 0, dibatalkan: 0 };
  const jurnal = await jurnalGenerasi(tx, poId);
  const cermin = await tx.supplierPayment.findMany({
    where: { idempotencyKey: { startsWith: `${AWALAN_KUNCI_TANDAI_LUNAS}${poId}#` } },
    select: { id: true, idempotencyKey: true, status: true },
  });
  const perKunci = new Map(cermin.map((c) => [c.idempotencyKey as string, c]));
  let dibuat = 0;
  let dibatalkan = 0;
  for (const j of jurnal) {
    const kunci = `${AWALAN_KUNCI_TANDAI_LUNAS}${j.sourceId}`;
    const c = perKunci.get(kunci);
    if (!j.berdiri) {
      if (c && c.status === STATUS_PEMBAYARAN.BERLAKU) {
        await tx.supplierPayment.update({
          where: { id: c.id },
          data: { status: STATUS_PEMBAYARAN.BATAL, cancelledAt: new Date(), cancelledById: olehUserId, cancelReason: "Tanda lunas PO dibatalkan" },
        });
        dibatalkan++;
      }
      continue;
    }
    if (c) continue;
    const nilai = j.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
    if (nilai <= 0) continue;
    const rekening = j.lines.find((l) => Number(l.credit) > 0)?.chartAccountId ?? null;
    const nomor = await generateDocNumber("SUPPAY", tx, { tanggal: j.date });
    const p = await tx.supplierPayment.create({
      data: {
        docNumber: nomor,
        supplierId: po.supplierId,
        date: j.date,
        method: "TRANSFER",
        cashAccountId: rekening,
        grossAmount: nilai / 100,
        withholdingAmount: 0,
        netAmount: nilai / 100,
        isAdvance: false,
        status: STATUS_PEMBAYARAN.BERLAKU,
        note: `Tandai lunas PO ${po.docNumber}`,
        idempotencyKey: kunci,
        createdById: olehUserId,
        allocations: { create: [{ targetType: "PO", targetId: poId, amount: nilai / 100, note: po.docNumber }] },
      },
      select: { id: true },
    });
    await catatJejakKas(tx, {
      userId: olehUserId,
      action: JEJAK_KAS.PEMBAYARAN_DICATAT,
      entityType: "SupplierPayment",
      entityId: p.id,
      changes: { after: { nomor, poId, jumlah: nilai / 100 } },
      metadata: { cerminTandaiLunas: true, jurnal: j.sourceId },
    });
    dibuat++;
  }
  return { dibuat, dibatalkan };
}

/** Pasca-commit tombol "Tandai lunas" / "Posting pembalik". Tidak pernah melempar. */
export async function selaraskanCerminTandaiLunas(poId: string, olehUserId: string): Promise<HasilCermin | null> {
  try {
    return await runSerializable((tx) => selaraskanCerminTandaiLunasDalam(tx, poId, olehUserId));
  } catch (e) {
    console.error(`[selaraskanCerminTandaiLunas] gagal untuk PO ${poId} — angka hutang tidak terpengaruh (dibaca dari jurnalnya), hanya baris di daftar pembayaran yang belum ada.`, e);
    return null;
  }
}

/** Penjaga tombol lama — tinggal di berkas daun, lihat `pembayaran-dokumen-po.ts`. */
export { adaPembayaranDokumenUntukPo } from "./pembayaran-dokumen-po";

/** Kunci cermin untuk generasi yang sekarang berlaku (untuk tes dan layar). */
export async function kunciCerminSekarang(poId: string, tx: Klien | typeof prisma = prisma): Promise<string> {
  return kunciTandaiLunas(poId, await generasiTandaiLunas(poId, tx));
}
