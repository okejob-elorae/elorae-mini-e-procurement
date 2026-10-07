import { Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import { dariSen, keSen } from "./angka-konten";
import { rencanaPembayaran, type KodeTolakBayar } from "./bayar-aturan";
import { terapkanMajuOtomatis } from "./maju-otomatis";
import type { StatusBayar, Tahap } from "./tahap";

/**
 * Penulis pembayaran fee KOL (`KolBrief.payStatus/paidAmount/paidAt/payNote`).
 *
 * Aturannya di `bayar-aturan.ts` (dipakai juga dialog layar). Setiap catatan
 * menulis jejak `PEMBAYARAN_KOL_DICATAT` dengan pasangan sebelum/sesudah di
 * transaksi yang sama — barisnya hanya menyimpan keadaan terakhir, jadi
 * pembayaran yang dibetulkan hanya hidup di jejak. Sesudah fakta bayar
 * ditulis, tahap dimajukan lewat `terapkanMajuOtomatis` (LUNAS → DIBAYAR
 * hanya bila kontennya sudah tayang; aturannya di sana, bukan di sini).
 *
 * Mengembalikan kode, tidak pernah melempar ke layar.
 */

type Klien = Prisma.TransactionClient;

export const BATAS_CATATAN_BAYAR = 1000;
export const BATAS_BAYAR_MASSAL = 500;

export type KodeGagalBayar = KodeTolakBayar | "TIDAK_DITEMUKAN" | "TERLALU_PANJANG" | "KOSONG" | "TERLALU_BANYAK";

export type Perpindahan = { dari: Tahap; ke: Tahap };

export type HasilBayar =
  | { ok: true; berubah: boolean; payStatus: StatusBayar; paidAmount: number; tahap: Perpindahan | null }
  | { ok: false; kode: KodeGagalBayar };

type Isian = {
  kolaborasiId: string;
  status: string;
  jumlah?: number | null;
  /** Hari WIB "YYYY-MM-DD". Kosong: tanggal lama bila statusnya tetap, selain itu hari ini. */
  tanggal?: string | null;
  /** `undefined` = catatan lama dipertahankan; teks kosong = dihapus. */
  catatan?: string | null;
};

const hariDari = (d: Date | null): string | null => (d ? formatDateOnlyJakarta(d) : null);

/** Inti bersama satu dan massal — DI DALAM transaksi pemanggil. */
async function terapkan(tx: Klien, isi: Isian, olehUserId: string, hariIni: string): Promise<HasilBayar> {
  const c = await tx.kolBrief.findUnique({
    where: { id: isi.kolaborasiId },
    select: { id: true, docNo: true, fee: true, payStatus: true, paidAmount: true, paidAt: true, payNote: true, kol: { select: { name: true } } },
  });
  if (!c) return { ok: false, kode: "TIDAK_DITEMUKAN" };

  const catatanBaru = isi.catatan === undefined ? c.payNote : isi.catatan?.trim() || null;
  if (catatanBaru && catatanBaru.length > BATAS_CATATAN_BAYAR) return { ok: false, kode: "TERLALU_PANJANG" };

  const statusLama = c.payStatus as StatusBayar;
  const hariLama = hariDari(c.paidAt);
  // Status yang sama tanpa tanggal: tanggal lama tetap — menyimpan ulang
  // "Lunas" tidak boleh diam-diam memindah tanggal bayarnya ke hari ini.
  const tanggal = isi.tanggal?.trim() || (isi.status === statusLama && hariLama ? hariLama : null);
  const r = rencanaPembayaran({ fee: Number(c.fee), status: isi.status, jumlah: isi.jumlah, tanggal, hariIni });
  if (!r.ok) return r;

  const sebelum = { payStatus: statusLama, paidAmount: Number(c.paidAmount), paidAt: hariLama, payNote: c.payNote };
  const sesudah = { payStatus: r.payStatus, paidAmount: r.paidAmount, paidAt: r.paidAtHari, payNote: catatanBaru };
  const sama =
    sebelum.payStatus === sesudah.payStatus &&
    keSen(sebelum.paidAmount) === keSen(sesudah.paidAmount) &&
    sebelum.paidAt === sesudah.paidAt &&
    (sebelum.payNote ?? null) === (sesudah.payNote ?? null);
  if (sama) return { ok: true, berubah: false, payStatus: r.payStatus, paidAmount: r.paidAmount, tahap: null };

  await tx.kolBrief.update({
    where: { id: c.id },
    data: {
      payStatus: r.payStatus,
      paidAmount: new Prisma.Decimal(r.paidAmount),
      paidAt: r.paidAtHari ? (parseDateOnly(r.paidAtHari) ?? null) : null,
      payNote: catatanBaru,
    },
  });
  await catatJejak(tx, {
    userId: olehUserId,
    action: JEJAK.PEMBAYARAN_KOL_DICATAT,
    entityType: "KolBrief",
    entityId: c.id,
    changes: { before: sebelum, after: sesudah },
    metadata: { docNo: c.docNo, kol: c.kol.name, fee: Number(c.fee) },
  });

  const tahap = await terapkanMajuOtomatis(tx, {
    kolaborasiId: c.id,
    olehUserId,
    sebab: `Pembayaran: ${r.payStatus}`,
  });
  return { ok: true, berubah: true, payStatus: r.payStatus, paidAmount: r.paidAmount, tahap };
}

/** Catat pembayaran satu kolaborasi. */
export async function catatPembayaran(input: Isian & { olehUserId: string }): Promise<HasilBayar> {
  const hariIni = hariIniWib();
  return runSerializable((tx) => terapkan(tx, input, input.olehUserId, hariIni));
}

export type HasilBayarBanyak =
  | {
      ok: true;
      jumlah: number;
      berubah: number;
      /** Total sudah dibayar seluruh kolaborasi itu sesudah disimpan. */
      totalDibayar: number;
      perpindahan: ({ kolaborasiId: string } & Perpindahan)[];
    }
  | { ok: false; kode: KodeGagalBayar; kolaborasiId?: string };

class GagalBaris extends Error {
  constructor(
    readonly kode: KodeGagalBayar,
    readonly kolaborasiId: string,
  ) {
    super(kode);
  }
}

/**
 * Catat pembayaran banyak kolaborasi sekaligus — SATU transaksi serializable,
 * utuh atau tidak sama sekali: satu baris yang ditolak membatalkan semuanya,
 * supaya layar tidak perlu menebak mana yang sudah tersimpan. Setiap
 * kolaborasi tetap mendapat jejaknya sendiri. Untuk SEBAGIAN tiap baris
 * membawa jumlahnya sendiri (bug KOL Manager: "sebagian" massal tidak bisa
 * memasukkan nominal).
 */
export async function catatPembayaranBanyak(input: {
  items: readonly { kolaborasiId: string; jumlah?: number | null }[];
  status: string;
  tanggal?: string | null;
  catatan?: string | null;
  olehUserId: string;
}): Promise<HasilBayarBanyak> {
  const unik = new Map<string, { kolaborasiId: string; jumlah?: number | null }>();
  for (const it of input.items) {
    const id = String(it?.kolaborasiId ?? "").trim();
    if (id && !unik.has(id)) unik.set(id, { kolaborasiId: id, jumlah: it.jumlah });
  }
  if (unik.size === 0) return { ok: false, kode: "KOSONG" };
  if (unik.size > BATAS_BAYAR_MASSAL) return { ok: false, kode: "TERLALU_BANYAK" };
  const hariIni = hariIniWib();

  try {
    return await runSerializable(async (tx) => {
      let berubah = 0;
      let total = 0;
      const perpindahan: ({ kolaborasiId: string } & Perpindahan)[] = [];
      for (const it of unik.values()) {
        const r = await terapkan(
          tx,
          { kolaborasiId: it.kolaborasiId, status: input.status, jumlah: it.jumlah, tanggal: input.tanggal, catatan: input.catatan },
          input.olehUserId,
          hariIni,
        );
        // Melempar membatalkan transaksinya; ditangkap di bawah dan dikembalikan sebagai kode.
        if (!r.ok) throw new GagalBaris(r.kode, it.kolaborasiId);
        if (r.berubah) berubah++;
        total += keSen(r.paidAmount);
        if (r.tahap) perpindahan.push({ kolaborasiId: it.kolaborasiId, ...r.tahap });
      }
      return { ok: true as const, jumlah: unik.size, berubah, totalDibayar: dariSen(total), perpindahan };
    });
  } catch (e) {
    if (e instanceof GagalBaris) return { ok: false, kode: e.kode, kolaborasiId: e.kolaborasiId };
    throw e;
  }
}
