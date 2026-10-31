import type { Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import { dariSen, keSen } from "./angka-konten";
import { rencanaPembayaran, type KodeTolakBayar } from "./bayar-aturan";
import { sinkronJurnalKolAman } from "./jurnal-kol";
import { terapkanMajuOtomatis } from "./maju-otomatis";
import type { StatusBayar, Tahap } from "./tahap";
import { GagalTermin, selaraskanTermin, setelTotalDibayar, turunkanDanTulis } from "./termin-writer";

/**
 * "Tandai dibayar" per KOLABORASI (layar Pembayaran, panel lama, massal).
 *
 * Sejak termin pembayaran (2026-10-07) keadaan bayar kolaborasi DITURUNKAN
 * dari terminnya — penulis ini tidak lagi menulis `payStatus/paidAmount`
 * sendiri. Ia menerjemahkan status yang dipilih ke termin
 * (`setelTotalDibayar`): LUNAS membayar semua termin yang belum dibayar;
 * SEBAGIAN membayar termin berurutan sampai total yang diketik (termin yang
 * lebih besar dipecah); BELUM membatalkan pembayarannya. Aturan isiannya
 * tetap `bayar-aturan.ts` (dipakai juga dialog layar).
 *
 * Setiap catatan menulis jejak `PEMBAYARAN_KOL_DICATAT` dengan pasangan
 * sebelum/sesudah di transaksi yang sama, lalu tahap dimajukan lewat
 * `terapkanMajuOtomatis`. Jurnal diposting sesudah commit (`jurnal-kol.ts`).
 *
 * Mengembalikan kode, tidak pernah melempar ke layar.
 */

type Klien = Prisma.TransactionClient;

export const BATAS_CATATAN_BAYAR = 1000;
export const BATAS_BAYAR_MASSAL = 500;

export type KodeGagalBayar =
  | KodeTolakBayar
  | "TIDAK_DITEMUKAN"
  | "TERLALU_PANJANG"
  | "KOSONG"
  | "TERLALU_BANYAK"
  /** Membatalkan pembayaran yang PPh-nya sudah disetor. */
  | "SUDAH_DISETOR";

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

class TolakBayar extends Error {
  constructor(readonly kode: KodeGagalBayar) {
    super(kode);
  }
}

/** Inti bersama satu dan massal — DI DALAM transaksi pemanggil. Penolakan sesudah menulis melempar `TolakBayar`. */
async function terapkan(tx: Klien, isi: Isian, olehUserId: string, hariIni: string): Promise<HasilBayar> {
  const ada = await tx.kolBrief.findUnique({ where: { id: isi.kolaborasiId }, select: { id: true, payNote: true } });
  if (!ada) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  const catatanBaru = isi.catatan === undefined ? ada.payNote : isi.catatan?.trim() || null;
  if (catatanBaru && catatanBaru.length > BATAS_CATATAN_BAYAR) return { ok: false, kode: "TERLALU_PANJANG" };

  // Termin dipastikan ada dan selaras dengan fee sekarang (kolaborasi lama tanpa termin).
  const s = await selaraskanTermin(tx, { kolaborasiId: ada.id, olehUserId, sebab: "Pembayaran dicatat" });
  if (!s.ok) throw new TolakBayar("JUMLAH_TIDAK_VALID");

  const c = await tx.kolBrief.findUniqueOrThrow({
    where: { id: isi.kolaborasiId },
    select: { id: true, docNo: true, fee: true, payStatus: true, paidAmount: true, paidAt: true, payNote: true, kol: { select: { name: true } } },
  });

  const statusLama = c.payStatus as StatusBayar;
  const hariLama = hariDari(c.paidAt);
  // Status yang sama tanpa tanggal: tanggal lama tetap — menyimpan ulang
  // "Lunas" tidak boleh diam-diam memindah tanggal bayarnya ke hari ini.
  const tanggal = isi.tanggal?.trim() || (isi.status === statusLama && hariLama ? hariLama : null);
  const r = rencanaPembayaran({ fee: Number(c.fee), status: isi.status, jumlah: isi.jumlah, tanggal, hariIni });
  if (!r.ok) return r;

  const sebelum = { payStatus: statusLama, paidAmount: Number(c.paidAmount), paidAt: hariLama, payNote: c.payNote };
  const sama =
    sebelum.payStatus === r.payStatus &&
    keSen(sebelum.paidAmount) === keSen(r.paidAmount) &&
    sebelum.paidAt === r.paidAtHari &&
    (sebelum.payNote ?? null) === (catatanBaru ?? null);
  if (sama) return { ok: true, berubah: false, payStatus: r.payStatus, paidAmount: r.paidAmount, tahap: null };

  if (keSen(Number(c.fee)) > 0) {
    const t = await setelTotalDibayar(tx, {
      kolaborasiId: c.id,
      targetSen: keSen(r.paidAmount),
      hari: r.paidAtHari,
      olehUserId,
      alasan: `Ditandai ${r.payStatus.toLowerCase().replace("_", " ")} lewat Pembayaran`,
    });
    if (!t.ok) throw new TolakBayar(t.kode === "SUDAH_DISETOR" ? "SUDAH_DISETOR" : "JUMLAH_TIDAK_VALID");
  }
  if ((catatanBaru ?? null) !== (c.payNote ?? null)) await tx.kolBrief.update({ where: { id: c.id }, data: { payNote: catatanBaru } });
  const turunan = await turunkanDanTulis(tx, c.id);

  const sesudah = { payStatus: turunan.payStatus, paidAmount: turunan.paidAmount, paidAt: turunan.paidAtHari, payNote: catatanBaru };
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
    sebab: `Pembayaran: ${turunan.payStatus}`,
  });
  return { ok: true, berubah: true, payStatus: turunan.payStatus, paidAmount: turunan.paidAmount, tahap };
}

/** Catat pembayaran satu kolaborasi. */
export async function catatPembayaran(input: Isian & { olehUserId: string }): Promise<HasilBayar> {
  const hariIni = hariIniWib();
  let hasil: HasilBayar;
  try {
    hasil = await runSerializable((tx) => terapkan(tx, input, input.olehUserId, hariIni));
  } catch (e) {
    if (e instanceof TolakBayar) return { ok: false, kode: e.kode };
    if (e instanceof GagalTermin) return { ok: false, kode: "JUMLAH_TIDAK_VALID" };
    throw e;
  }
  if (hasil.ok && hasil.berubah) await sinkronJurnalKolAman([input.kolaborasiId], input.olehUserId);
  return hasil;
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
    const hasil = await runSerializable(async (tx) => {
      let berubah = 0;
      let total = 0;
      const perpindahan: ({ kolaborasiId: string } & Perpindahan)[] = [];
      for (const it of unik.values()) {
        let r: HasilBayar;
        try {
          r = await terapkan(
            tx,
            { kolaborasiId: it.kolaborasiId, status: input.status, jumlah: it.jumlah, tanggal: input.tanggal, catatan: input.catatan },
            input.olehUserId,
            hariIni,
          );
        } catch (e) {
          if (e instanceof TolakBayar) throw new GagalBaris(e.kode, it.kolaborasiId);
          if (e instanceof GagalTermin) throw new GagalBaris("JUMLAH_TIDAK_VALID", it.kolaborasiId);
          throw e;
        }
        // Melempar membatalkan transaksinya; ditangkap di bawah dan dikembalikan sebagai kode.
        if (!r.ok) throw new GagalBaris(r.kode, it.kolaborasiId);
        if (r.berubah) berubah++;
        total += keSen(r.paidAmount);
        if (r.tahap) perpindahan.push({ kolaborasiId: it.kolaborasiId, ...r.tahap });
      }
      return { ok: true as const, jumlah: unik.size, berubah, totalDibayar: dariSen(total), perpindahan };
    });
    if (hasil.berubah > 0) await sinkronJurnalKolAman([...unik.keys()], input.olehUserId);
    return hasil;
  } catch (e) {
    if (e instanceof GagalBaris) return { ok: false, kode: e.kode, kolaborasiId: e.kolaborasiId };
    throw e;
  }
}
