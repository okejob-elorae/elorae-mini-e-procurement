import { pwaDb, type PendingPhoto } from "./db";
import { bacaCatatanTerkirim, KUNCI_KUNJUNGAN_TERKIRIM } from "./luring-kunjungan";
export { newLocalId } from "./queue";

/**
 * Foto di antrean. Foto kunjungan yang check-in-nya masih di HP (dicatat tanpa
 * sinyal) belum punya id kunjungan server: `visitId` KOSONG dan
 * `visitClientId` = id check-in buatan HP. Foto itu baru diunggah sesudah
 * check-in-nya sampai; server mencari kunjungannya dari id HP itu.
 */
export type FotoAntrean = PendingPhoto & { visitClientId?: string | null };

export async function enqueuePhoto(o: Omit<FotoAntrean, "capturedAt" | "syncState" | "attempts"> & { capturedAt?: number }): Promise<void> {
  await pwaDb.pendingPhotos.put({
    ...o,
    capturedAt: o.capturedAt ?? Date.now(),
    syncState: "pending",
    attempts: 0,
  });
}

export async function listPendingPhotosForVisit(visitId: string): Promise<PendingPhoto[]> {
  return (await pwaDb.pendingPhotos.where("visitId").equals(visitId).toArray()).sort((a, b) => a.capturedAt - b.capturedAt);
}

/** Id check-in HP dari kunjungan server ini, bila kunjungan itu dulu dicatat tanpa sinyal. */
function clientIdDariCatatan(visitId: string | null): string | null {
  if (!visitId || typeof window === "undefined") return null;
  try {
    const c = bacaCatatanTerkirim(window.localStorage.getItem(KUNCI_KUNJUNGAN_TERKIRIM));
    return c && c.visitId === visitId ? c.clientId : null;
  } catch {
    return null;
  }
}

/** Murni: foto mana yang milik kunjungan ini — lewat id server ATAU id check-in HP-nya. */
export function fotoMilikKunjungan<T extends { visitId: string; visitClientId?: string | null }>(
  foto: readonly T[],
  k: { visitId: string | null; visitClientId: string | null },
): T[] {
  return foto.filter((f) => (k.visitId && f.visitId === k.visitId) || (k.visitClientId && f.visitClientId === k.visitClientId));
}

/**
 * Foto yang masih di antrean untuk satu kunjungan: kunjungan server, check-in
 * yang masih di HP, atau kunjungan server yang dulu check-in-nya dicatat tanpa
 * sinyal (fotonya diantrekan dengan id HP sebelum kunjungannya dikenal).
 */
export async function listPendingPhotosForKunjungan(k: { visitId: string | null; visitClientId?: string | null }): Promise<FotoAntrean[]> {
  const kunci = { visitId: k.visitId, visitClientId: k.visitClientId ?? clientIdDariCatatan(k.visitId) };
  if (!kunci.visitId && !kunci.visitClientId) return [];
  const semua = (await pwaDb.pendingPhotos.toArray()) as FotoAntrean[];
  return fotoMilikKunjungan(semua, kunci).sort((a, b) => a.capturedAt - b.capturedAt);
}

/** Semua foto kunjungan yang masih tertahan di HP ini, yang paling lama dulu — untuk layar "Belum terkirim". */
export async function listPendingPhotos(): Promise<PendingPhoto[]> {
  return pwaDb.pendingPhotos.orderBy("capturedAt").toArray();
}

export async function deletePendingPhoto(localId: string): Promise<void> {
  await pwaDb.pendingPhotos.delete(localId);
}

export async function retryPendingPhoto(localId: string): Promise<void> {
  await pwaDb.pendingPhotos.update(localId, { syncState: "pending", error: undefined });
}
