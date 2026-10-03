import {
  pwaDb,
  type PendingCheckin,
  type PendingCheckout,
  type PendingMutasiAjuan,
  type PendingMutasiKirim,
  type PendingSpgReturn,
  type PendingStoreOpname,
  type PendingStoreReceipt,
} from "./db";
import { PERISTIWA_ANTREAN } from "./hitung";
import { AJUAN_MUTASI_DITOLAK } from "./luring-klasifikasi";
import type { CheckinBaru, CheckoutBaru, MutasiAjuanBaru, MutasiKirimBaru, OpnameBaru, ReturPembeliBaru, TerimaBaru } from "./luring-muatan";

/**
 * Antrean "tanpa sinyal" untuk kunjungan (check-in, check-out) dan pekerjaan
 * stok SPG (terima kiriman, opname, barang kembali dari pembeli, mutasi antar
 * toko: ajuan dan tanda dikirim).
 *
 * `localId` setiap baris = kunci kiriman ke server, dibuat SEKALI per
 * formulir (check-in: sekali per ketukan) — kiriman ulang tidak pernah
 * mencatat dua kali. Setiap perubahan memberi tahu layar lewat
 * `PERISTIWA_ANTREAN`, supaya hitungan "belum terkirim" dan kartu kunjungan
 * di HP langsung berubah.
 */

const awal = { syncState: "pending" as const, attempts: 0 };

function kabari(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PERISTIWA_ANTREAN));
}

export async function antreCheckin(c: CheckinBaru): Promise<void> {
  await pwaDb.pendingCheckins.put({ ...c, capturedAt: Date.now(), ...awal });
  kabari();
}

export async function antreCheckout(c: CheckoutBaru): Promise<void> {
  await pwaDb.pendingCheckouts.put({ ...c, capturedAt: Date.now(), ...awal });
  kabari();
}

export async function antreTerima(r: TerimaBaru): Promise<void> {
  await pwaDb.pendingStoreReceipts.put({ ...r, capturedAt: Date.now(), ...awal });
  kabari();
}

export async function antreOpname(r: OpnameBaru): Promise<void> {
  await pwaDb.pendingStoreOpnames.put({ ...r, capturedAt: Date.now(), ...awal });
  kabari();
}

export async function antreReturPembeli(r: ReturPembeliBaru): Promise<void> {
  await pwaDb.pendingSpgReturns.put({ ...r, capturedAt: Date.now(), ...awal });
  kabari();
}

export async function antreAjuanMutasi(r: MutasiAjuanBaru): Promise<void> {
  await pwaDb.pendingMutasiAjuan.put({ ...r, capturedAt: Date.now(), ...awal });
  kabari();
}

export async function antreKirimMutasi(r: MutasiKirimBaru): Promise<void> {
  await pwaDb.pendingMutasiKirim.put({ ...r, capturedAt: Date.now(), ...awal });
  kabari();
}

export type MutasiDiHp = { ajuan: PendingMutasiAjuan[]; kirim: PendingMutasiKirim[] };

/**
 * Mutasi toko ini yang masih di HP: ajuan yang belum sampai, dan tanda
 * dikirim yang belum sampai — yang tertua dulu. Tak terbaca = kosong.
 */
export async function mutasiDiHp(storeId: string): Promise<MutasiDiHp> {
  try {
    const [ajuan, kirim] = await Promise.all([
      pwaDb.pendingMutasiAjuan.where("storeId").equals(storeId).toArray(),
      pwaDb.pendingMutasiKirim.orderBy("capturedAt").toArray(),
    ]);
    return {
      ajuan: ajuan.sort((a, b) => a.capturedAt - b.capturedAt),
      kirim: kirim.filter((k) => k.storeId === storeId),
    };
  } catch {
    return { ajuan: [], kirim: [] };
  }
}

/** Tanda terima kiriman ini yang masih di HP — formulirnya tidak boleh mengantre yang kedua. */
export async function terimaTertahanUntuk(sourceType: string, sourceId: string): Promise<PendingStoreReceipt | null> {
  try {
    const baris = await pwaDb.pendingStoreReceipts.where("sourceId").equals(sourceId).toArray();
    return baris.find((r) => r.sourceType === sourceType) ?? null;
  } catch {
    return null;
  }
}

/** Barang kembali dari nota ini yang masih di HP — dijumlahkan ke "sudah kembali" di layar. */
export async function returPembeliTertahanUntuk(spgSaleId: string): Promise<PendingSpgReturn[]> {
  try {
    return await pwaDb.pendingSpgReturns.where("spgSaleId").equals(spgSaleId).toArray();
  } catch {
    return [];
  }
}

export type AntreanLuring = {
  checkin: PendingCheckin[];
  checkout: PendingCheckout[];
  terima: PendingStoreReceipt[];
  opname: PendingStoreOpname[];
  returPembeli: PendingSpgReturn[];
  mutasiAjuan: PendingMutasiAjuan[];
  mutasiKirim: PendingMutasiKirim[];
};

/** Semua antrean kunjungan & stok, yang tertua dulu. Penyimpanan tak terbaca = kosong. */
export async function daftarAntreanLuring(): Promise<AntreanLuring> {
  try {
    const [checkin, checkout, terima, opname, returPembeli, mutasiAjuan, mutasiKirim] = await Promise.all([
      pwaDb.pendingCheckins.orderBy("capturedAt").toArray(),
      pwaDb.pendingCheckouts.orderBy("capturedAt").toArray(),
      pwaDb.pendingStoreReceipts.orderBy("capturedAt").toArray(),
      pwaDb.pendingStoreOpnames.orderBy("capturedAt").toArray(),
      pwaDb.pendingSpgReturns.orderBy("capturedAt").toArray(),
      pwaDb.pendingMutasiAjuan.orderBy("capturedAt").toArray(),
      pwaDb.pendingMutasiKirim.orderBy("capturedAt").toArray(),
    ]);
    return { checkin, checkout, terima, opname, returPembeli, mutasiAjuan, mutasiKirim };
  } catch {
    return { checkin: [], checkout: [], terima: [], opname: [], returPembeli: [], mutasiAjuan: [], mutasiKirim: [] };
  }
}

export type JenisLuring = keyof AntreanLuring;

const TABEL = {
  checkin: () => pwaDb.pendingCheckins,
  checkout: () => pwaDb.pendingCheckouts,
  terima: () => pwaDb.pendingStoreReceipts,
  opname: () => pwaDb.pendingStoreOpnames,
  returPembeli: () => pwaDb.pendingSpgReturns,
  mutasiAjuan: () => pwaDb.pendingMutasiAjuan,
  mutasiKirim: () => pwaDb.pendingMutasiKirim,
} as const;

/**
 * Hapus satu kiriman dari HP — pekerjaannya tidak pernah tercatat. Layar wajib
 * meminta konfirmasi. Ajuan mutasi membawa tanda dikirimnya yang masih
 * menunggu: tanpa ajuan, mutasi itu tidak pernah ada untuk dikirim.
 */
export async function hapusLuring(jenis: JenisLuring, localId: string): Promise<void> {
  if (jenis === "mutasiAjuan") {
    await pwaDb.transaction("rw", pwaDb.pendingMutasiAjuan, pwaDb.pendingMutasiKirim, async () => {
      await pwaDb.pendingMutasiKirim.where("ajuanLocalId").equals(localId).delete();
      await pwaDb.pendingMutasiAjuan.delete(localId);
    });
  } else {
    await TABEL[jenis]().delete(localId);
  }
  kabari();
}

/**
 * Kembalikan ke antrean (setelah ditolak, atau untuk mempercepat). Ajuan mutasi
 * yang dicoba lagi ikut mengembalikan tanda dikirimnya yang berhenti hanya
 * karena ajuan itu ditolak.
 */
export async function ulangLuring(jenis: JenisLuring, localId: string): Promise<void> {
  if (jenis === "mutasiAjuan") {
    await pwaDb.pendingMutasiKirim
      .where("ajuanLocalId")
      .equals(localId)
      .modify((k) => {
        if (k.syncState === "failed" && k.error === AJUAN_MUTASI_DITOLAK) {
          k.syncState = "pending";
          k.error = undefined;
        }
      });
  }
  await TABEL[jenis]().update(localId, { syncState: "pending", error: undefined });
  kabari();
}
