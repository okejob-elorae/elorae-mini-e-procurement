import { JournalError, prisma, type AdminNotification } from "@elorae/db";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { JENIS_TERTUNDA_LAPANGAN, SUMBER_LAPANGAN, type SumberLapangan } from "./aturan";
import { jurnalLapangan, KODE_BUKAN_GAGAL, type HasilJurnalLapangan, type KodeGagalLapangan } from "./jurnal";

/*
 * Posting jurnal lapangan yang TIDAK PERNAH menggagalkan dokumennya — KHUSUS
 * SERVER. Dokumen (nota, BKM, hitungan retur, tukar barang) sudah di-commit
 * saat ini dipanggil; masalah keuangan (peran belum dipetakan, akun bukan daun)
 * menjadi notifikasi `JOURNAL_PENDING` yang bisa diposting ulang dari
 * Keuangan → Rekonsiliasi piutang. Keberhasilan menandai notifikasinya selesai.
 */

export type KodeGagalPosting = KodeGagalLapangan | "NON_POSTABLE_ACCOUNT" | "ERROR";

export type HasilPostingLapangan =
  | { ok: true; journalId: string | null; created: boolean }
  | { ok: false; code: KodeGagalPosting; role?: string; detail?: string };

const NAMA_SUMBER: Readonly<Record<SumberLapangan, string>> = {
  FIELD_DELIVERY: "nota tagihan",
  FIELD_COLLECTION: "pelunasan",
  STORE_RETURN: "retur toko",
  STORE_EXCHANGE: "tukar barang",
};

/** Nomor dokumen untuk kalimat notifikasi — notifikasi tanpa nomor dokumen tidak bisa ditindaklanjuti. */
export async function nomorDokumenLapangan(sumber: SumberLapangan, id: string): Promise<string | null> {
  try {
    switch (sumber) {
      case SUMBER_LAPANGAN.NOTA:
        return (await prisma.fieldSalesDelivery.findUnique({ where: { id }, select: { docNo: true } }))?.docNo ?? null;
      case SUMBER_LAPANGAN.BKM:
        return (await prisma.paymentClaim.findUnique({ where: { id }, select: { docNo: true } }))?.docNo ?? null;
      case SUMBER_LAPANGAN.RETUR:
        return (await prisma.warehouseReturn.findUnique({ where: { id }, select: { noNri: true } }))?.noNri ?? null;
      case SUMBER_LAPANGAN.TUKAR:
        return (await prisma.storeExchange.findUnique({ where: { id }, select: { docNo: true } }))?.docNo ?? null;
    }
  } catch {
    return null;
  }
}

/**
 * Satu notifikasi belum dibaca per (dokumen, jenis, sebab). JSON-path tidak
 * andal di adaptor MariaDB — dicocokkan di JS, seperti penulis lain.
 */
async function sudahDitandai(kind: string, docId: string, sebab: string): Promise<boolean> {
  const baru = await prisma.adminNotification.findMany({
    where: { category: "JOURNAL_PENDING", readAt: null },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { metadata: true },
  });
  return baru.some((n) => {
    const m = (typeof n.metadata === "string" ? safeParse(n.metadata) : n.metadata) as Record<string, unknown> | null;
    return m?.docId === docId && m?.kind === kind && m?.reason === sebab;
  });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function catatTertunda(sumber: SumberLapangan, docId: string, sebab: string, peran: string | null, detail?: string): Promise<void> {
  const kind = JENIS_TERTUNDA_LAPANGAN[sumber];
  let baris: AdminNotification | null = null;
  try {
    if (await sudahDitandai(kind, docId, sebab)) return;
    const nomor = (await nomorDokumenLapangan(sumber, docId)) ?? docId;
    const nama = NAMA_SUMBER[sumber];
    baris = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: `Jurnal ${nama} ${nomor} belum diposting`,
        message:
          `Jurnal ${nama} ${nomor} gagal diposting (${sebab}${peran ? `: ${peran}` : ""}${detail ? `: ${detail}` : ""}). ` +
          "Perbaiki pemetaan akunnya, lalu posting ulang dari Keuangan → Rekonsiliasi piutang.",
        metadata: { docId, kind, reason: sebab, role: peran, docNo: nomor },
      },
    });
  } catch (e) {
    console.error(`[jurnal-lapangan] GAGAL MENCATAT JOURNAL_PENDING untuk ${sumber} ${docId} — dokumen ini tanpa jurnal dan tanpa tanda`, e);
  }
  if (baris) void fanOutAdminNotification(baris);
}

/** Posting/selaraskan jurnal satu dokumen lapangan. Tidak pernah melempar. */
export async function postingJurnalLapanganAman(sumber: SumberLapangan, docId: string, olehUserId: string): Promise<HasilPostingLapangan> {
  let r: HasilJurnalLapangan;
  try {
    r = await jurnalLapangan(sumber, docId, olehUserId);
  } catch (e) {
    const code: KodeGagalPosting = e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT" ? "NON_POSTABLE_ACCOUNT" : "ERROR";
    const detail = code === "ERROR" && e instanceof Error ? e.message : undefined;
    console.error(`[jurnal-lapangan] ${sumber} ${docId} gagal`, e);
    await catatTertunda(sumber, docId, code, null, detail);
    return { ok: false, code, ...(detail ? { detail } : {}) };
  }
  if (r.ok) {
    await tandaiJurnalTertundaSelesai([dokumenJurnal(sumber, docId)]);
    return r;
  }
  if (!KODE_BUKAN_GAGAL.has(r.code)) await catatTertunda(sumber, docId, r.code, r.role ?? null, r.detail);
  return r;
}
