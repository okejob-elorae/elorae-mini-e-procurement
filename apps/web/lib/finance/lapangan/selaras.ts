import { Prisma, prisma, type PrismaClient } from "@elorae/db";
import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateAutoJournal } from "@/lib/finance/journal";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { bacaKanalJurnal } from "@/lib/finance/journals/kanal";
import { peranDariMemo } from "@/lib/finance/pajak/jurnal-ppn";
import { generasiBerikutnya, generasiSourceId, idGenerasi, keBarisJurnal, keSen, selisihBaris, type BarisBertanda } from "./aturan";

/*
 * Penyelaras jurnal bergenerasi — KHUSUS SERVER.
 *
 * Jurnal sebuah dokumen yang keadaannya bisa berubah sesudah dijurnal (BKM
 * dibatalkan, potongan ditautkan ulang, beban retur diputuskan, hitungan gudang
 * dipindah toko) TIDAK pernah diubah atau dihapus. Penyelaras membaca keadaan
 * dokumen sekarang, menyusun SASARAN jurnalnya, menjumlah jurnal yang sudah
 * berdiri per peran (memo baris) + toko + kanal, lalu memposting SELISIHNYA
 * sebagai generasi berikutnya: `<id>`, `<id>#2`, `<id>#3`, …
 *
 * Dijalankan dua kali tidak menggandakan apa pun (selisih kedua = nol). Semua
 * pembacaan dan penulisannya di SATU transaksi serializable: dua penyelaras
 * yang berpacu atas dokumen yang sama tidak bisa sama-sama memposting selisih
 * dari bacaan yang sama — basis data menolak salah satunya, percobaan ulangnya
 * membaca jurnal yang sudah ditulis pemenangnya.
 */

type Klien = PrismaClient | Prisma.TransactionClient;

const PERAN = new Set<string>(POSTING_ROLES);

export type JurnalTerposting = {
  sourceIds: string[];
  baris: BarisBertanda[];
  /** Jurnal generasi terakhir, atau null bila belum ada sama sekali. */
  terakhirId: string | null;
};

/** Jurnal yang sudah berdiri untuk satu dokumen bergenerasi, dijumlah per peran + toko + kanal. */
export async function bacaJurnalTerposting(client: Klien, sourceType: string, entityId: string): Promise<JurnalTerposting> {
  const jurnal = await client.journal.findMany({
    where: {
      sourceType,
      OR: [{ sourceId: entityId }, { sourceId: { startsWith: `${entityId}#` } }],
      ...SARING_JURNAL_BERLAKU,
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sourceId: true,
      lines: { select: { memo: true, debit: true, credit: true, channel: true, storeId: true } },
    },
  });
  const milik = jurnal.filter((j) => j.sourceId != null && generasiSourceId(entityId, j.sourceId) != null);
  const baris: BarisBertanda[] = [];
  for (const j of milik) {
    for (const l of j.lines) {
      // Memo = nama peran, atau "PERAN · DPP n" pada baris PPN (`memoPeranDpp`).
      const peran = peranDariMemo(l.memo);
      if (!peran || !PERAN.has(peran)) {
        // Hanya penyelaras ini yang menulis sumber bergenerasi, dan setiap barisnya bermemo peran.
        console.warn(`[selaras] baris jurnal ${j.id} tanpa memo peran — dilewati`);
        continue;
      }
      baris.push({
        role: peran as PostingRole,
        sen: keSen(Number(l.debit)) - keSen(Number(l.credit)),
        channel: bacaKanalJurnal(l.channel),
        storeId: l.storeId ?? null,
      });
    }
  }
  let terakhir: (typeof milik)[number] | null = null;
  for (const j of milik) {
    if (!terakhir || (generasiSourceId(entityId, j.sourceId!) ?? 0) > (generasiSourceId(entityId, terakhir.sourceId!) ?? 0)) terakhir = j;
  }
  return { sourceIds: milik.map((j) => j.sourceId!), baris, terakhirId: terakhir?.id ?? null };
}

export type SasaranDokumen = {
  sasaran: BarisBertanda[];
  /**
   * Boleh memposting generasi PERTAMA? (Tanggal mulai buku besar ditetapkan dan
   * dokumennya tidak sebelum tanggal itu.) Sesudah ada jurnal, penyelarasan
   * selalu berjalan — tanggal mulai yang digeser kemudian tidak membalik
   * jurnal yang sudah diposting.
   */
  bolehMulai: boolean;
  /** Tanggal generasi pertama (tanggal dokumen). Generasi berikutnya = saat penyesuaian. */
  tanggal: Date;
  deskripsi: string;
};

export type HasilSelaras =
  | { ok: true; berubah: boolean; journalId: string | null; ke: number }
  | { ok: false; code: "UNMAPPED_ROLE" | "UNBALANCED"; role?: string }
  /** Belum ada jurnal dan dokumennya belum boleh dijurnal (tanggal mulai, keadaan). */
  | { ok: false; code: "BELUM_BERLAKU" };

function bentrokSumber(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Selaraskan jurnal satu dokumen. `susun` membaca dokumennya DI DALAM transaksi
 * (memakai `tx`) dan menerima baris yang sudah terposting — untuk nilai yang
 * dibekukan pada jurnal pertama (mis. biaya barang rusak).
 */
export async function selaraskanJurnal(input: {
  sourceType: string;
  entityId: string;
  postedById: string;
  sekarang?: Date;
  susun: (tx: Prisma.TransactionClient, terposting: BarisBertanda[]) => Promise<SasaranDokumen>;
}): Promise<HasilSelaras> {
  const jalan = () =>
    runSerializable(async (tx): Promise<HasilSelaras> => {
      const ada = await bacaJurnalTerposting(tx, input.sourceType, input.entityId);
      const s = await input.susun(tx, ada.baris);
      if (ada.sourceIds.length === 0 && !s.bolehMulai) return { ok: false, code: "BELUM_BERLAKU" };
      const selisih = selisihBaris(s.sasaran, ada.baris);
      const ke = generasiBerikutnya(input.entityId, ada.sourceIds);
      if (selisih.length === 0) return { ok: true, berubah: false, journalId: ada.terakhirId, ke: ke - 1 };
      const pertama = ke === 1;
      const r = await generateAutoJournal(tx, input.sourceType, idGenerasi(input.entityId, ke), keBarisJurnal(selisih), {
        date: pertama ? s.tanggal : (input.sekarang ?? new Date()),
        description: pertama ? s.deskripsi : `${s.deskripsi} — penyesuaian ${ke}`,
        postedById: input.postedById,
      });
      if (!r.ok) {
        if (r.code === "NOTHING_TO_POST") return { ok: true, berubah: false, journalId: ada.terakhirId, ke: ke - 1 };
        return { ok: false, code: r.code, ...(r.role ? { role: r.role } : {}) };
      }
      return { ok: true, berubah: r.created, journalId: r.journalId, ke };
    });
  try {
    return await jalan();
  } catch (e) {
    // Dua penyelaras menyisipkan generasi yang sama: yang kalah membaca ulang dan menghitung selisih dari pemenangnya.
    if (bentrokSumber(e)) return jalan();
    throw e;
  }
}

/** Untuk pemanggil di luar transaksi (layar rekonsiliasi). */
export function bacaJurnalTerpostingDb(sourceType: string, entityId: string): Promise<JurnalTerposting> {
  return bacaJurnalTerposting(prisma, sourceType, entityId);
}
