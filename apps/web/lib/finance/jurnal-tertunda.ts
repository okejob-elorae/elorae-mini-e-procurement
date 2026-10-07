import { prisma } from "@elorae/db";

/*
 * Notifikasi `JOURNAL_PENDING` adalah penanda keadaan per dokumen: "jurnal
 * dokumen ini gagal diposting". Modul ini menjawab dua hal yang dulu tidak
 * dijawab siapa pun, sehingga baris "Jurnal gagal" di Beranda tidak pernah
 * hilang:
 *  - notifikasi mana yang sudah beres — ditandai `readAt` oleh tempat yang
 *    berhasil memposting jurnal dokumennya (`tandaiJurnalTertundaSelesai`);
 *  - berapa yang masih tertunda — belum ditandai DAN jurnal dokumennya memang
 *    belum ada (`hitungJurnalTertunda`, pertahanan berlapis bila penandaan
 *    terlewat).
 *
 * Notifikasi TIDAK pernah dihapus: pembaca tombol "Post journal" van
 * (`lib/canvassing/journal-pending.ts`) memakai keberadaan barisnya, tanpa
 * melihat `readAt`, sebagai bukti posting pernah dicoba untuk dokumen itu.
 *
 * Pencocokan metadata dilakukan di JS, bukan JSON-path: penyaringan JSON-path
 * tidak andal di adaptor MariaDB (sama seperti pembaca lain di modul ini).
 */

export type SumberNotifikasiJurnal =
  | { tipe: "dokumen"; sourceType: string; sourceId: string }
  /*
   * Jurnal pembayaran pemasok ber-`sourceId` `poId#generasi`, jadi dicocokkan
   * per PO dan arah, bukan per pasangan sumber.
   */
  | { tipe: "pembayaranPemasok"; arah: "payment" | "reversal"; poId: string }
  /*
   * Jurnal fee/pembayaran KOL satu kolaborasi (`lib/creative/jurnal-kol.ts`)
   * diselaraskan sekaligus — beberapa jurnal per kolaborasi, ber-sourceId
   * `<kolaborasi>#…`. Selesai HANYA bila penyelarasnya berhasil penuh dan
   * menandainya (`readAt`): keberadaan satu jurnal tidak membuktikan yang lain.
   */
  | { tipe: "kolaborasiKol"; kolaborasiId: string };

export function dokumenJurnal(sourceType: string, sourceId: string): SumberNotifikasiJurnal {
  return { tipe: "dokumen", sourceType, sourceId };
}

const JENIS_VAN = new Map([
  ["van_load", "VAN_LOAD"],
  ["van_sale", "VAN_SALE"],
  ["van_reconcile", "VAN_RECONCILE"],
]);

function teks(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * Dokumen yang dimaksud sebuah notifikasi, dari metadata yang ditulis setiap
 * penulis `JOURNAL_PENDING`. Bentuk yang tidak dikenal → null: notifikasi itu
 * tetap dihitung dan tidak pernah ditandai selesai secara diam-diam.
 */
export function sumberNotifikasiJurnal(metadata: unknown): SumberNotifikasiJurnal | null {
  // Kolom JSON bisa tiba sebagai teks (seperti `Item.variants`); isinya dibaca sama.
  if (typeof metadata === "string") {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  const kind = teks(m.kind);

  const docId = teks(m.docId);
  if (docId && kind) {
    const van = JENIS_VAN.get(kind);
    if (van) return dokumenJurnal(van, docId);
    if (kind === "supplier_payment") return { tipe: "pembayaranPemasok", arah: "payment", poId: docId };
    if (kind === "supplier_payment_reversal") return { tipe: "pembayaranPemasok", arah: "reversal", poId: docId };
    if (kind === "kol_kolaborasi") return { tipe: "kolaborasiKol", kolaborasiId: docId };
    if (kind === "kol_sampel") return dokumenJurnal("KOL_SAMPLE", docId);
    return null;
  }

  const grnId = teks(m.grnId);
  if (grnId) {
    if (kind === "receipt") return dokumenJurnal("GRN", grnId);
    if (kind === "reversal") return dokumenJurnal("GRN_REVERSAL", grnId);
    return null;
  }

  const receiptId = teks(m.receiptId);
  if (receiptId) return kind === "fg_receipt" ? dokumenJurnal("FG_RECEIPT", receiptId) : null;

  const opnameId = teks(m.opnameId);
  if (opnameId) return dokumenJurnal("OPNAME", opnameId);

  const salesReturnId = teks(m.salesReturnId);
  if (salesReturnId) {
    if (kind === "revenue") return dokumenJurnal("SALESRETURN_REVENUE", salesReturnId);
    if (kind === "cogs") return dokumenJurnal("SALESRETURN_COGS", salesReturnId);
    return null;
  }

  const orderId = teks(m.orderId);
  if (orderId) {
    if (kind === "revenue") return dokumenJurnal("SALESORDER_REVENUE", orderId);
    if (kind === "cogs") return dokumenJurnal("SALESORDER_COGS", orderId);
    return null;
  }

  return null;
}

function kunci(s: SumberNotifikasiJurnal): string {
  if (s.tipe === "dokumen") return `d|${s.sourceType}|${s.sourceId}`;
  if (s.tipe === "kolaborasiKol") return `k|${s.kolaborasiId}`;
  return `p|${s.arah}|${s.poId}`;
}

/**
 * Menandai selesai (`readAt`) setiap notifikasi `JOURNAL_PENDING` yang belum
 * selesai untuk dokumen-dokumen ini — dipanggil sesudah jurnalnya berhasil
 * diposting. Semua alasan kegagalan untuk dokumen yang sama ikut selesai.
 *
 * `dibuatSebelum`: hanya notifikasi yang ditulis sebelum waktu itu. Dipakai
 * pembayaran pemasok, yang bisa gagal lagi sesudah berhasil (tandai/batal
 * bayar berulang): tanda kegagalan baru yang ditulis sesudah posting ini
 * dimulai bukan urusan posting ini dan tidak boleh ikut hilang.
 *
 * Tidak pernah melempar: jurnalnya sudah tercatat, dan kegagalan penandaan
 * tertutup oleh `hitungJurnalTertunda` yang memeriksa jurnalnya sendiri.
 * Tidak perlu `runSerializable`: dua penanda yang balapan menulis nilai yang
 * sama dan jumlah barisnya tidak dipakai untuk memutuskan apa pun.
 */
export async function tandaiJurnalTertundaSelesai(
  sumber: SumberNotifikasiJurnal[],
  opts: { dibuatSebelum?: Date } = {},
): Promise<number> {
  if (sumber.length === 0) return 0;
  const dicari = new Set(sumber.map(kunci));
  try {
    const belum = await prisma.adminNotification.findMany({
      where: {
        category: "JOURNAL_PENDING",
        readAt: null,
        ...(opts.dibuatSebelum ? { createdAt: { lte: opts.dibuatSebelum } } : {}),
      },
      select: { id: true, metadata: true },
    });
    const ids = belum
      .filter((n) => {
        const s = sumberNotifikasiJurnal(n.metadata);
        return s != null && dicari.has(kunci(s));
      })
      .map((n) => n.id);
    if (ids.length === 0) return 0;
    const hasil = await prisma.adminNotification.updateMany({
      where: { id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    return hasil.count;
  } catch (e) {
    console.error("[tandaiJurnalTertundaSelesai] gagal menandai JOURNAL_PENDING selesai untuk", [...dicari], e);
    return 0;
  }
}

type BarisNotifikasi = { id: string; metadata: unknown; createdAt: Date };

/**
 * Id notifikasi yang dokumennya ternyata SUDAH berjurnal.
 *
 * Dokumen biasa: jurnalnya unik per (sourceType, sourceId), jadi keberadaannya
 * cukup. Pembayaran pemasok: jurnal PO itu bisa sudah berdiri SEBELUM
 * kegagalannya (`PAYMENT_SUPERSEDED` — jurnal lama beda nilai), jadi hanya
 * jurnal arah yang sama yang diposting SESUDAH notifikasinya ditulis yang
 * dianggap menyelesaikannya.
 */
async function idSudahBerjurnal(baris: BarisNotifikasi[]): Promise<Set<string>> {
  const terpetakan = baris.map((n) => ({ n, s: sumberNotifikasiJurnal(n.metadata) }));
  const perJenis = new Map<string, Set<string>>();
  const poIds = new Set<string>();
  for (const { s } of terpetakan) {
    if (!s) continue;
    if (s.tipe === "dokumen") {
      const ids = perJenis.get(s.sourceType) ?? new Set<string>();
      ids.add(s.sourceId);
      perJenis.set(s.sourceType, ids);
    } else if (s.tipe === "pembayaranPemasok") {
      poIds.add(s.poId);
    }
  }

  const ada = new Set<string>();
  if (perJenis.size > 0) {
    const jurnal = await prisma.journal.findMany({
      where: { OR: [...perJenis].map(([sourceType, ids]) => ({ sourceType, sourceId: { in: [...ids] } })) },
      select: { sourceType: true, sourceId: true },
    });
    for (const j of jurnal) {
      if (j.sourceType && j.sourceId) ada.add(kunci(dokumenJurnal(j.sourceType, j.sourceId)));
    }
  }

  const jurnalPo =
    poIds.size > 0
      ? await prisma.journal.findMany({
          where: {
            sourceType: { in: ["SUPPLIER_PAYMENT", "SUPPLIER_PAYMENT_REVERSAL"] },
            OR: [...poIds].map((poId) => ({ sourceId: { startsWith: `${poId}#` } })),
          },
          select: { sourceType: true, sourceId: true, createdAt: true },
        })
      : [];

  const sudah = new Set<string>();
  for (const { n, s } of terpetakan) {
    if (!s) continue;
    if (s.tipe === "dokumen") {
      if (ada.has(kunci(s))) sudah.add(n.id);
      continue;
    }
    if (s.tipe === "kolaborasiKol") continue;
    const sourceType = s.arah === "payment" ? "SUPPLIER_PAYMENT" : "SUPPLIER_PAYMENT_REVERSAL";
    const awalan = `${s.poId}#`;
    const pulih = jurnalPo.some(
      (j) => j.sourceType === sourceType && j.sourceId?.startsWith(awalan) && j.createdAt > n.createdAt,
    );
    if (pulih) sudah.add(n.id);
  }
  return sudah;
}

/**
 * Jumlah notifikasi `JOURNAL_PENDING` yang masih tertunda: belum ditandai
 * selesai DAN dokumennya memang belum berjurnal. Ini angka baris "Jurnal
 * gagal" di Beranda dan lencana sidebar.
 *
 * `notifikasiIds` membatasi ke notifikasi tertentu (tes di basis data
 * bersama); tanpa itu menghitung seluruhnya.
 */
export async function hitungJurnalTertunda(opts: { notifikasiIds?: string[] } = {}): Promise<number> {
  const belum = await prisma.adminNotification.findMany({
    where: {
      category: "JOURNAL_PENDING",
      readAt: null,
      ...(opts.notifikasiIds !== undefined ? { id: { in: opts.notifikasiIds } } : {}),
    },
    select: { id: true, metadata: true, createdAt: true },
  });
  if (belum.length === 0) return 0;
  const sudah = await idSudahBerjurnal(belum);
  return belum.length - sudah.size;
}

/** Metadata notifikasi sebagai objek. Kolom JSON bisa tiba sebagai teks (MariaDB) — dibaca sama. */
export function metadataNotifikasi(metadata: unknown): Record<string, unknown> {
  let nilai = metadata;
  if (typeof nilai === "string") {
    try {
      nilai = JSON.parse(nilai);
    } catch {
      return {};
    }
  }
  return nilai !== null && typeof nilai === "object" && !Array.isArray(nilai)
    ? (nilai as Record<string, unknown>)
    : {};
}

export type JurnalTertunda = {
  notifikasiId: string;
  dicatatPada: Date;
  /** null = bentuk metadata tidak dikenal; tetap tampil, sama seperti tetap dihitung. */
  sumber: SumberNotifikasiJurnal | null;
  /** Kode kegagalan dari penulisnya (`UNMAPPED_ROLE`, `GRN_JOURNALS_INCOMPLETE`, …). */
  sebab: string | null;
  /** Peran posting yang belum dipetakan, bila penulisnya mencatatnya. */
  peran: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Daftar notifikasi `JOURNAL_PENDING` yang masih tertunda — baris yang SAMA
 * dengan yang dihitung `hitungJurnalTertunda` (belum ditandai selesai DAN
 * dokumennya belum berjurnal), terbaru lebih dulu. Dipakai tab "Tertunda" di
 * halaman Jurnal, tujuan baris "Jurnal gagal" di Beranda.
 *
 * `notifikasiIds` membatasi ke notifikasi tertentu (tes di basis data bersama).
 */
export async function daftarJurnalTertunda(opts: { notifikasiIds?: string[] } = {}): Promise<JurnalTertunda[]> {
  const belum = await prisma.adminNotification.findMany({
    where: {
      category: "JOURNAL_PENDING",
      readAt: null,
      ...(opts.notifikasiIds !== undefined ? { id: { in: opts.notifikasiIds } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: { id: true, metadata: true, createdAt: true },
  });
  if (belum.length === 0) return [];
  const sudah = await idSudahBerjurnal(belum);
  return belum
    .filter((n) => !sudah.has(n.id))
    .map((n) => {
      const metadata = metadataNotifikasi(n.metadata);
      return {
        notifikasiId: n.id,
        dicatatPada: n.createdAt,
        sumber: sumberNotifikasiJurnal(metadata),
        sebab: teks(metadata.reason),
        peran: teks(metadata.role),
        metadata,
      };
    });
}
