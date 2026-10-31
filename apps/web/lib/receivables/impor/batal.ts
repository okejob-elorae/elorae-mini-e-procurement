import { prisma, Prisma } from '@elorae/db';
import { runSerializable } from '@/lib/db/tx-retry';
import { catatJejak, JEJAK } from '../jejak';

/**
 * Pembatalan satu batch impor faktur.
 *
 * Impor memasukkan puluhan sampai ratusan faktur sekaligus. Satu berkas yang
 * salah — kolom tertukar, periode keliru, berkas yang sama diunggah dua kali —
 * berarti puluhan tagihan palsu, dan sebelum ini satu-satunya cara
 * membersihkannya adalah menghapus baris demi baris lewat basis data.
 *
 * Bisa dilakukan karena jejak impornya SUDAH menyimpan setiap id yang dibuat.
 * Jadi ini bukan tebakan "faktur mana yang kira-kira dari batch itu" — daftarnya
 * memang tercatat sejak awal.
 */

/**
 * Sisanya masih persis seperti saat diimpor: nilai faktur dikurangi bagian yang
 * sudah dibayar sebelum impor. Yang berbeda berarti ada yang menyentuhnya.
 */
function sisaUtuh(r: { amount: Prisma.Decimal; outstanding: Prisma.Decimal; paidBeforeImport: Prisma.Decimal }) {
  return r.outstanding.equals(r.amount.minus(r.paidBeforeImport));
}

type AlasanGagalBatal =
  | 'TIDAK_DITEMUKAN'
  | 'BUKAN_IMPOR'
  | 'SUDAH_DIBATALKAN'
  | 'ALASAN_WAJIB'
  | 'SUDAH_DIPAKAI';

export type HasilBatalImpor =
  | { ok: true; dihapus: number }
  | { ok: false; alasan: AlasanGagalBatal; dipakai?: string[] };

/**
 * Batalkan sebuah batch impor.
 *
 * MENOLAK kalau ada satu saja faktur dari batch itu yang sudah disentuh —
 * masuk kontrabon, dilunasi klaim, atau sudah tidak penuh lagi sisanya.
 *
 * Penolakan itu inti keamanannya. Relasi di modul ini `relationMode = "prisma"`,
 * jadi TIDAK ADA foreign key di basis data yang akan menghentikan penghapusan:
 * menghapus faktur yang ditunjuk sebuah klaim tidak gagal, ia berhasil, dan
 * yang tersisa adalah klaim yang melunasi sesuatu yang tidak ada lagi. Angkanya
 * tetap terhitung, tapi tidak ada yang bisa menelusurinya. Lebih baik menolak
 * dan menyebut faktur mana yang menghalangi.
 */
export async function batalkanImpor(input: {
  auditLogId: string;
  alasan: string;
  olehUserId: string;
}): Promise<HasilBatalImpor> {
  if (!input.alasan?.trim()) return { ok: false, alasan: 'ALASAN_WAJIB' };

  return runSerializable(async (tx) => {
    const jejak = await tx.auditLog.findUnique({
      where: { id: input.auditLogId },
      select: { id: true, action: true, metadata: true, createdAt: true },
    });
    if (!jejak) return { ok: false as const, alasan: 'TIDAK_DITEMUKAN' as const };
    if (jejak.action !== JEJAK.FAKTUR_IMPOR) {
      return { ok: false as const, alasan: 'BUKAN_IMPOR' as const };
    }

    const meta = (jejak.metadata ?? {}) as { receivableIds?: unknown };
    const ids = Array.isArray(meta.receivableIds)
      ? meta.receivableIds.filter((x): x is string => typeof x === 'string')
      : [];
    /*
     * Daftar kosong berarti tidak ada yang bisa dihapus, dan itu harus keluar
     * di sini. Diteruskan ke bawah, `{ id: { in: [] } }` memang aman — tapi
     * pemeriksaan "sudah dipakai"-nya jadi kosong juga dan hasilnya melaporkan
     * keberhasilan yang tidak menghapus apa-apa.
     */
    if (ids.length === 0) return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };

    // Yang sudah dihapus sebelumnya tidak akan terbaca lagi di sini.
    const masihAda = await tx.receivable.findMany({
      where: { id: { in: ids } },
      select: { id: true, invoiceNo: true, amount: true, outstanding: true, paidBeforeImport: true },
    });
    if (masihAda.length === 0) return { ok: false as const, alasan: 'SUDAH_DIBATALKAN' as const };

    const [klaim, kontrabon] = await Promise.all([
      tx.paymentClaimReceivable.findMany({
        where: { receivableId: { in: ids } },
        select: { receivableId: true },
      }),
      tx.collectionNoteReceivable.findMany({
        where: { receivableId: { in: ids } },
        select: { receivableId: true },
      }),
    ]);

    const tersentuh = new Set<string>([
      ...klaim.map((k) => k.receivableId),
      ...kontrabon.map((k) => k.receivableId),
      // Sisa yang tidak lagi penuh berarti ada sesuatu yang menyentuhnya,
      // walau tautannya sudah tidak terbaca.
      // "Penuh" berarti sisa saat diimpor: nilai dikurangi yang sudah dibayar
      // sebelum impor — faktur yang diimpor bersisa sebagian belum disentuh.
      ...masihAda.filter((r) => !sisaUtuh(r)).map((r) => r.id),
    ]);

    if (tersentuh.size > 0) {
      return {
        ok: false as const,
        alasan: 'SUDAH_DIPAKAI' as const,
        dipakai: masihAda.filter((r) => tersentuh.has(r.id)).map((r) => r.invoiceNo),
      };
    }

    const idHidup = masihAda.map((r) => r.id);
    // Baris rinciannya lebih dulu: menghapus induknya duluan meninggalkan baris
    // rincian menggantung, karena tidak ada foreign key yang ikut membersihkan.
    await tx.receivableItem.deleteMany({ where: { receivableId: { in: idHidup } } });
    await tx.receivable.deleteMany({ where: { id: { in: idHidup } } });

    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.IMPOR_DIBATALKAN,
      entityType: 'Receivable',
      entityId: input.auditLogId,
      changes: { before: { faktur: masihAda.length }, after: { faktur: 0 } },
      metadata: {
        auditLogImpor: input.auditLogId,
        diimporPada: jejak.createdAt.toISOString(),
        noFaktur: masihAda.map((r) => r.invoiceNo),
        // Sejajar dengan `noFaktur`: jurnal faktur yang sudah dibalik tetap bisa
        // menyebut nomor fakturnya sesudah barisnya dihapus (`fakturImporDibatalkan`).
        receivableIds: masihAda.map((r) => r.id),
      },
      reason: input.alasan,
    });

    return { ok: true as const, dihapus: idHidup.length };
  });
}

export type BatchImpor = {
  auditLogId: string;
  saat: string;
  oleh: string | null;
  masuk: number;
  dilewati: number;
  /** Berapa yang masih ada — sisanya sudah dibatalkan atau dihapus. */
  tersisa: number;
  bisaDibatalkan: boolean;
};

/**
 * Daftar batch impor terakhir, beserta apakah masing-masing masih bisa dibatalkan.
 *
 * Tanpa daftar ini, pembatalan di atas menuntut seseorang mencari id baris jejak
 * lewat basis data — pintu keluar yang hanya bisa dibuka orang yang tidak
 * membutuhkannya.
 */
export async function daftarImpor(batas = 20): Promise<BatchImpor[]> {
  const rows = await prisma.auditLog.findMany({
    where: { action: JEJAK.FAKTUR_IMPOR },
    orderBy: { createdAt: 'desc' },
    take: batas,
    select: {
      id: true,
      createdAt: true,
      metadata: true,
      changes: true,
      user: { select: { name: true } },
    },
  });

  const semuaId = rows.flatMap((r) => idDari(r.metadata));
  const hidup = semuaId.length
    ? await prisma.receivable.findMany({
        where: { id: { in: semuaId } },
        select: { id: true, amount: true, outstanding: true, paidBeforeImport: true },
      })
    : [];
  const petaHidup = new Map(hidup.map((r) => [r.id, r]));

  const terpakai = new Set<string>();
  if (semuaId.length) {
    const [klaim, kontrabon] = await Promise.all([
      prisma.paymentClaimReceivable.findMany({
        where: { receivableId: { in: semuaId } },
        select: { receivableId: true },
      }),
      prisma.collectionNoteReceivable.findMany({
        where: { receivableId: { in: semuaId } },
        select: { receivableId: true },
      }),
    ]);
    for (const k of klaim) terpakai.add(k.receivableId);
    for (const k of kontrabon) terpakai.add(k.receivableId);
  }

  return rows.map((r) => {
    const ids = idDari(r.metadata);
    const hidupBatch = ids.filter((id) => petaHidup.has(id));
    const ada = (r.changes ?? {}) as { after?: { masuk?: number; dilewati?: number } };
    const disentuh = hidupBatch.some(
      (id) => terpakai.has(id) || !sisaUtuh(petaHidup.get(id)!),
    );
    return {
      auditLogId: r.id,
      saat: r.createdAt.toISOString(),
      oleh: r.user?.name ?? null,
      masuk: ada.after?.masuk ?? ids.length,
      dilewati: ada.after?.dilewati ?? 0,
      tersisa: hidupBatch.length,
      bisaDibatalkan: hidupBatch.length > 0 && !disentuh,
    };
  });
}

function idDari(metadata: Prisma.JsonValue | null): string[] {
  const meta = (metadata ?? {}) as { receivableIds?: unknown };
  return Array.isArray(meta.receivableIds)
    ? meta.receivableIds.filter((x): x is string => typeof x === 'string')
    : [];
}

/**
 * Id faktur sebuah batch impor (dari jejak impornya) — untuk kait jurnal
 * pasca-commit sesudah batch itu dibatalkan. Kosong bila jejaknya bukan impor.
 */
export async function idFakturImpor(auditLogId: string): Promise<string[]> {
  const jejak = await prisma.auditLog.findUnique({ where: { id: auditLogId }, select: { action: true, metadata: true } });
  if (!jejak || jejak.action !== JEJAK.FAKTUR_IMPOR) return [];
  return idDari(jejak.metadata);
}

/**
 * Nomor faktur yang barisnya sudah dihapus karena impornya dibatalkan, per id
 * — dibaca dari jejak pembatalannya (`receivableIds` sejajar `noFaktur`).
 * Faktur yang tidak ditemukan tidak masuk peta.
 */
export async function fakturImporDibatalkan(ids: string[]): Promise<Map<string, string>> {
  const hasil = new Map<string, string>();
  if (ids.length === 0) return hasil;
  const dicari = new Set(ids);
  const jejak = await prisma.auditLog.findMany({
    where: { action: JEJAK.IMPOR_DIBATALKAN },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { metadata: true },
  });
  for (const j of jejak) {
    let m: unknown = j.metadata;
    if (typeof m === "string") {
      try {
        m = JSON.parse(m);
      } catch {
        continue;
      }
    }
    const meta = (m ?? {}) as { receivableIds?: unknown; noFaktur?: unknown };
    if (!Array.isArray(meta.receivableIds) || !Array.isArray(meta.noFaktur)) continue;
    meta.receivableIds.forEach((id, i) => {
      const no = (meta.noFaktur as unknown[])[i];
      if (typeof id === "string" && dicari.has(id) && typeof no === "string" && !hasil.has(id)) hasil.set(id, no);
    });
  }
  return hasil;
}
