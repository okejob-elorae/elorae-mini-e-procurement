import { buatKlaimAction } from "@/app/actions/receivables";
import { catatJanjiBayarAction } from "@/app/actions/collections";
import { catatReturTokoAction } from "@/app/actions/store-returns";
import { unggahFoto } from "@/lib/foto/unggah";
import { pwaDb, type FotoTertunda } from "./db";
import { nasibLaporan, nasibUnggah, type NasibKiriman } from "./laporan-classify";

/**
 * Kirim laporan lapangan yang tertahan di HP: pelunasan (BKM), retur (NRT),
 * lalu janji bayar.
 *
 * Urutan per laporan: unggah fotonya (bila masih berupa berkas di HP), simpan
 * URL-nya kembali ke baris antrean, baru panggil aksi server dengan kunci
 * kiriman. Kalau jawabannya hilang di jalan, kiriman berikutnya membawa kunci
 * yang sama dan server mengembalikan laporan yang sudah ada — tidak dua kali.
 */

let berjalan = false;

class GagalUnggah extends Error {
  constructor(readonly nasib: NasibKiriman, readonly kode: string) {
    super(kode);
  }
}

/** Pastikan foto sudah punya URL; unggah kalau masih berkas di HP. */
async function pastikanUrl(foto: FotoTertunda | null, simpan: (f: FotoTertunda) => Promise<void>): Promise<string | null> {
  if (!foto) return null;
  if (foto.url) return foto.url;
  if (!foto.blob) return null;
  try {
    const url = await unggahFoto(new File([foto.blob], foto.nama || "foto.jpg", { type: foto.blob.type || "image/jpeg" }));
    await simpan({ nama: foto.nama, url });
    return url;
  } catch (err) {
    throw new GagalUnggah(nasibUnggah(err), err instanceof Error ? err.message : "GAGAL");
  }
}

export async function flushLaporanTertahan(): Promise<{ terkirim: number; gagal: number }> {
  if (berjalan) return { terkirim: 0, gagal: 0 };
  berjalan = true;
  let terkirim = 0;
  let gagal = 0;
  try {
    // "syncing" ikut diambil: kunci-jalan menjamin tidak ada flush lain, jadi
    // baris "syncing" adalah sisa aplikasi yang ditutup di tengah kiriman.
    const klaim = (await pwaDb.pendingClaims.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort(
      (a, b) => a.capturedAt - b.capturedAt,
    );
    for (const k of klaim) {
      await pwaDb.pendingClaims.update(k.localId, { syncState: "syncing" });
      let nasib: NasibKiriman;
      let alasan = "";
      try {
        const transferPhotoUrl = await pastikanUrl(k.fotoTransfer, (f) =>
          pwaDb.pendingClaims.update(k.localId, { fotoTransfer: f }).then(() => undefined),
        );
        const breakdownPhotoUrl = await pastikanUrl(k.fotoRincian, (f) =>
          pwaDb.pendingClaims.update(k.localId, { fotoRincian: f }).then(() => undefined),
        );
        const hasil = await buatKlaimAction({
          storeId: k.storeId,
          ...k.payload,
          transferPhotoUrl,
          breakdownPhotoUrl,
          idempotencyKey: k.localId,
        });
        nasib = nasibLaporan(hasil);
        if (!hasil.ok) alasan = hasil.kode;
      } catch (err) {
        nasib = err instanceof GagalUnggah ? err.nasib : "retry";
        if (err instanceof GagalUnggah) alasan = `FOTO_${err.kode}`;
      }
      if (nasib === "evict") {
        await pwaDb.pendingClaims.delete(k.localId);
        terkirim += 1;
      } else {
        await pwaDb.pendingClaims.update(k.localId, {
          syncState: nasib === "terminal" ? "failed" : "pending",
          error: alasan || undefined,
          attempts: k.attempts + 1,
        });
        if (nasib === "terminal") gagal += 1;
      }
    }

    const retur = (await pwaDb.pendingReturns.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort(
      (a, b) => a.capturedAt - b.capturedAt,
    );
    for (const r of retur) {
      await pwaDb.pendingReturns.update(r.localId, { syncState: "syncing" });
      let nasib: NasibKiriman;
      let alasan = "";
      try {
        const photoUrl = await pastikanUrl(r.foto, (f) =>
          pwaDb.pendingReturns.update(r.localId, { foto: f }).then(() => undefined),
        );
        const hasil = await catatReturTokoAction({
          storeId: r.storeId,
          ...r.payload,
          photoUrl,
          idempotencyKey: r.localId,
        });
        nasib = nasibLaporan(hasil);
        if (!hasil.ok) alasan = hasil.kode;
      } catch (err) {
        nasib = err instanceof GagalUnggah ? err.nasib : "retry";
        if (err instanceof GagalUnggah) alasan = `FOTO_${err.kode}`;
      }
      if (nasib === "evict") {
        await pwaDb.pendingReturns.delete(r.localId);
        terkirim += 1;
      } else {
        await pwaDb.pendingReturns.update(r.localId, {
          syncState: nasib === "terminal" ? "failed" : "pending",
          error: alasan || undefined,
          attempts: r.attempts + 1,
        });
        if (nasib === "terminal") gagal += 1;
      }
    }

    const janji = (await pwaDb.pendingPromises.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort(
      (a, b) => a.capturedAt - b.capturedAt,
    );
    for (const j of janji) {
      await pwaDb.pendingPromises.update(j.localId, { syncState: "syncing" });
      let nasib: NasibKiriman;
      let alasan = "";
      try {
        const photoUrl = await pastikanUrl(j.foto, (f) =>
          pwaDb.pendingPromises.update(j.localId, { foto: f }).then(() => undefined),
        );
        const hasil = await catatJanjiBayarAction({
          ...j.payload,
          photoUrl,
          idempotencyKey: j.localId,
        });
        nasib = nasibLaporan(hasil);
        if (!hasil.ok) alasan = hasil.kode;
      } catch (err) {
        nasib = err instanceof GagalUnggah ? err.nasib : "retry";
        if (err instanceof GagalUnggah) alasan = `FOTO_${err.kode}`;
      }
      if (nasib === "evict") {
        await pwaDb.pendingPromises.delete(j.localId);
        terkirim += 1;
      } else {
        await pwaDb.pendingPromises.update(j.localId, {
          syncState: nasib === "terminal" ? "failed" : "pending",
          error: alasan || undefined,
          attempts: j.attempts + 1,
        });
        if (nasib === "terminal") gagal += 1;
      }
    }
  } finally {
    berjalan = false;
  }
  return { terkirim, gagal };
}
