import { pwaDb, type PendingClaim, type PendingPromise, type PendingReturn } from "./db";

/**
 * Antrean laporan lapangan di HP: pelunasan (BKM), nota retur (NRT), dan janji
 * bayar / tukar faktur.
 *
 * `localId` dipakai sebagai kunci kiriman ke server (`idempotencyKey`), jadi
 * wajib dibuat SEKALI per laporan — saat formulir dibuka, bukan saat tombol
 * kirim ditekan — supaya dua ketukan kirim tetap satu laporan.
 */

type Baru<T> = Omit<T, "capturedAt" | "syncState" | "attempts">;

export async function antreKlaim(k: Baru<PendingClaim>): Promise<void> {
  await pwaDb.pendingClaims.put({ ...k, capturedAt: Date.now(), syncState: "pending", attempts: 0 });
}

export async function antreRetur(r: Baru<PendingReturn>): Promise<void> {
  await pwaDb.pendingReturns.put({ ...r, capturedAt: Date.now(), syncState: "pending", attempts: 0 });
}

export async function daftarKlaimTertahan(): Promise<PendingClaim[]> {
  return pwaDb.pendingClaims.orderBy("capturedAt").toArray();
}

export async function daftarReturTertahan(): Promise<PendingReturn[]> {
  return pwaDb.pendingReturns.orderBy("capturedAt").toArray();
}

export async function hapusKlaimTertahan(localId: string): Promise<void> {
  await pwaDb.pendingClaims.delete(localId);
}

export async function hapusReturTertahan(localId: string): Promise<void> {
  await pwaDb.pendingReturns.delete(localId);
}

export async function ulangKlaimTertahan(localId: string): Promise<void> {
  await pwaDb.pendingClaims.update(localId, { syncState: "pending", error: undefined });
}

export async function ulangReturTertahan(localId: string): Promise<void> {
  await pwaDb.pendingReturns.update(localId, { syncState: "pending", error: undefined });
}

/**
 * Kirim ulang nota retur yang ditolak `ADA_SELISIH_DITEMUKAN` sebagai retur LAIN: pelapor
 * menyatakan barangnya bukan barang selisih nota lain yang sedang dikirim balik. Pernyataan itu
 * tersimpan di muatannya (`returLain`), jadi kiriman berikutnya membawanya — kunci kiriman tetap
 * sama, server tetap tidak mencatat dua kali.
 */
export async function ulangReturSebagaiReturLain(localId: string): Promise<void> {
  await pwaDb.pendingReturns
    .where("localId")
    .equals(localId)
    .modify((r) => {
      r.payload = { ...r.payload, returLain: true };
      r.syncState = "pending";
      r.error = undefined;
      r.noNrtSelisih = undefined;
    });
}

export async function antreJanji(j: Baru<PendingPromise>): Promise<void> {
  await pwaDb.pendingPromises.put({ ...j, capturedAt: Date.now(), syncState: "pending", attempts: 0 });
}

export async function daftarJanjiTertahan(): Promise<PendingPromise[]> {
  return pwaDb.pendingPromises.orderBy("capturedAt").toArray();
}

export async function hapusJanjiTertahan(localId: string): Promise<void> {
  await pwaDb.pendingPromises.delete(localId);
}

export async function ulangJanjiTertahan(localId: string): Promise<void> {
  await pwaDb.pendingPromises.update(localId, { syncState: "pending", error: undefined });
}
