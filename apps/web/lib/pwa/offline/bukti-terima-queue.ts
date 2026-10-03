import { pwaDb, type PendingBuktiTerima } from "./db";

/**
 * Antrean bukti terima di HP.
 *
 * `localId` dipakai sebagai kunci kiriman ke server, jadi dibuat SEKALI per
 * lembar bukti — saat lembarnya dibuka, bukan saat tombol kirim ditekan.
 */

type Baru = Omit<PendingBuktiTerima, "capturedAt" | "syncState" | "attempts">;

export async function antreBuktiTerima(b: Baru): Promise<void> {
  await pwaDb.pendingBuktiTerima.put({ ...b, capturedAt: Date.now(), syncState: "pending", attempts: 0 });
}

export async function daftarBuktiTerimaTertahan(): Promise<PendingBuktiTerima[]> {
  return pwaDb.pendingBuktiTerima.orderBy("capturedAt").toArray();
}

/** Bukti yang masih tertahan untuk satu pesanan — layar detail menandai pengirimannya "menunggu sinyal". */
export async function buktiTerimaTertahanPesanan(orderId: string): Promise<PendingBuktiTerima[]> {
  return pwaDb.pendingBuktiTerima.where("orderId").equals(orderId).toArray();
}

export async function hapusBuktiTerimaTertahan(localId: string): Promise<void> {
  await pwaDb.pendingBuktiTerima.delete(localId);
}

export async function ulangBuktiTerimaTertahan(localId: string): Promise<void> {
  await pwaDb.pendingBuktiTerima.update(localId, { syncState: "pending", error: undefined });
}
