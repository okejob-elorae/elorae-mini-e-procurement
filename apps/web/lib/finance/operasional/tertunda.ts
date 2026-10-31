import { JournalError, prisma, type AdminNotification } from "@elorae/db";
import { dokumenJurnal, metadataNotifikasi, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { bacaIdKomisiSpg, JENIS_TERTUNDA_OPERASIONAL, NAMA_SUMBER_OPERASIONAL, SUMBER_OPERASIONAL, type SumberOperasional } from "./aturan";
import { jurnalOperasional, KODE_BUKAN_GAGAL_OPERASIONAL, type HasilJurnalOperasional, type KodeGagalOperasional } from "./jurnal";

/*
 * Posting jurnal operasional yang TIDAK PERNAH menggagalkan dokumennya —
 * KHUSUS SERVER. Dokumennya sudah di-commit saat ini dipanggil; masalah
 * keuangan (peran belum dipetakan, akun bukan daun) menjadi notifikasi
 * `JOURNAL_PENDING` yang bisa diposting ulang dari Keuangan → Rekonsiliasi
 * persediaan. Keberhasilan menandai notifikasinya selesai.
 */

export type KodeGagalPostingOperasional = KodeGagalOperasional | "NON_POSTABLE_ACCOUNT" | "ERROR";

export type HasilPostingOperasional =
  | { ok: true; journalId: string | null; created: boolean }
  | { ok: false; code: KodeGagalPostingOperasional; role?: string; detail?: string };

/** Nomor/nama dokumen untuk kalimat notifikasi — notifikasi tanpa nomor dokumen tidak bisa ditindaklanjuti. */
export async function nomorDokumenOperasional(sumber: SumberOperasional, id: string): Promise<string | null> {
  try {
    switch (sumber) {
      case SUMBER_OPERASIONAL.KIRIM_KONSI:
        return (await prisma.consignmentShipment.findUnique({ where: { id }, select: { noKirim: true } }))?.noKirim ?? null;
      case SUMBER_OPERASIONAL.PESANAN_KONSI:
        return (await prisma.fieldSalesOrder.findUnique({ where: { id }, select: { orderNo: true } }))?.orderNo ?? null;
      case SUMBER_OPERASIONAL.RETUR_KONSI:
        return (await prisma.warehouseReturn.findUnique({ where: { id }, select: { noNri: true } }))?.noNri ?? null;
      case SUMBER_OPERASIONAL.SIKLUS_KONSI:
      case SUMBER_OPERASIONAL.KOMISI_KONSI:
        return (await prisma.consignmentCycle.findUnique({ where: { id }, select: { noKonsi: true } }))?.noKonsi ?? null;
      case SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI: {
        const k = await prisma.consignmentCommission.findUnique({ where: { id }, select: { cycle: { select: { noKonsi: true } }, spgUser: { select: { name: true } } } });
        return k ? `${k.cycle.noKonsi} · ${k.spgUser.name ?? "SPG"}` : null;
      }
      case SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI: {
        const p = await prisma.consignmentPayment.findUnique({ where: { id }, select: { cycle: { select: { noKonsi: true } } } });
        return p?.cycle.noKonsi ?? null;
      }
      case SUMBER_OPERASIONAL.KOMISI_SPG: {
        const k = bacaIdKomisiSpg(id);
        if (!k) return null;
        const toko = await prisma.store.findUnique({ where: { id: k.storeId }, select: { name: true } });
        return `${toko?.name ?? k.storeId} ${k.periode}`;
      }
      case SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG: {
        const k = await prisma.spgCommission.findUnique({ where: { id }, select: { period: true, storeId: true } });
        if (!k) return null;
        const toko = await prisma.store.findUnique({ where: { id: k.storeId }, select: { name: true } });
        return `${toko?.name ?? k.storeId} ${k.period}`;
      }
      case SUMBER_OPERASIONAL.BARANG_HILANG: {
        const l = await prisma.stockLoss.findUnique({ where: { id }, select: { sourceDocNo: true, storeId: true } });
        if (!l) return null;
        const toko = l.storeId ? await prisma.store.findUnique({ where: { id: l.storeId }, select: { name: true } }) : null;
        return [toko?.name, l.sourceDocNo].filter(Boolean).join(" · ") || null;
      }
      case SUMBER_OPERASIONAL.POTONG_SALES:
        return null;
      case SUMBER_OPERASIONAL.GUDANG_RUSAK:
        return (await prisma.damagedStockMovement.findUnique({ where: { id }, select: { productName: true } }))?.productName ?? null;
      case SUMBER_OPERASIONAL.STOK_MANUAL:
        return (await prisma.stockAdjustment.findUnique({ where: { id }, select: { docNumber: true } }))?.docNumber ?? null;
      case SUMBER_OPERASIONAL.RETUR_PEMASOK:
        return (await prisma.vendorReturn.findUnique({ where: { id }, select: { docNumber: true } }))?.docNumber ?? null;
      case SUMBER_OPERASIONAL.BIAYA_PERJALANAN:
      case SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN: {
        const k = await prisma.expenseClaim.findUnique({ where: { id }, select: { userId: true, category: true } });
        if (!k) return null;
        const orang = await prisma.user.findUnique({ where: { id: k.userId }, select: { name: true } });
        return `${orang?.name ?? "Salesman"} · ${k.category.toLowerCase()}`;
      }
    }
  } catch {
    return null;
  }
}

/** Satu notifikasi belum dibaca per (dokumen, jenis, sebab). JSON-path tidak andal di MariaDB — dicocokkan di JS. */
async function sudahDitandai(kind: string, docId: string, sebab: string): Promise<boolean> {
  const baru = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { metadata: true },
  });
  return baru.some((n) => {
    const m = metadataNotifikasi(n.metadata);
    return m.docId === docId && m.kind === kind && m.reason === sebab;
  });
}

async function catatTertunda(sumber: SumberOperasional, docId: string, sebab: string, peran: string | null, detail?: string): Promise<void> {
  const kind = JENIS_TERTUNDA_OPERASIONAL[sumber];
  let baris: AdminNotification | null = null;
  try {
    if (await sudahDitandai(kind, docId, sebab)) return;
    const nomor = await nomorDokumenOperasional(sumber, docId);
    const nama = NAMA_SUMBER_OPERASIONAL[sumber];
    const sebut = nomor ? `${nama} ${nomor}` : nama;
    baris = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `Jurnal ${sebut} belum diposting`,
        message:
          `Jurnal ${sebut} gagal diposting (${sebab}${peran ? `: ${peran}` : ""}${detail ? `: ${detail}` : ""}). ` +
          "Perbaiki pemetaan akunnya, lalu posting ulang dari Keuangan → Rekonsiliasi persediaan.",
        metadata: { docId, kind, reason: sebab, role: peran, ...(nomor ? { docNo: nomor } : {}) },
      },
    });
  } catch (e) {
    console.error(`[jurnal-operasional] GAGAL MENCATAT JOURNAL_PENDING untuk ${sumber} ${docId} — dokumen ini tanpa jurnal dan tanpa tanda`, e);
  }
  if (baris) void fanOutAdminNotification(baris);
}

/** Posting/selaraskan jurnal satu dokumen operasional. Tidak pernah melempar. */
export async function postingJurnalOperasionalAman(sumber: SumberOperasional, docId: string, olehUserId: string): Promise<HasilPostingOperasional> {
  let r: HasilJurnalOperasional;
  try {
    r = await jurnalOperasional(sumber, docId, olehUserId);
  } catch (e) {
    const code: KodeGagalPostingOperasional = e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT" ? "NON_POSTABLE_ACCOUNT" : "ERROR";
    const detail = code === "ERROR" && e instanceof Error ? e.message : undefined;
    console.error(`[jurnal-operasional] ${sumber} ${docId} gagal`, e);
    await catatTertunda(sumber, docId, code, null, detail);
    return { ok: false, code, ...(detail ? { detail } : {}) };
  }
  if (r.ok) {
    await tandaiJurnalTertundaSelesai([dokumenJurnal(sumber, docId)]);
    return r;
  }
  if (!KODE_BUKAN_GAGAL_OPERASIONAL.has(r.code)) await catatTertunda(sumber, docId, r.code, r.role ?? null, r.detail);
  return r;
}
