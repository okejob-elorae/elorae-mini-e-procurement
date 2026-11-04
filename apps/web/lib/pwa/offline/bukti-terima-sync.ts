import { catatBuktiTerimaAction } from "@/app/actions/bukti-terima";
import { unggahFoto } from "@/lib/foto/unggah";
import { pwaDb, type FotoTertunda } from "./db";
import { AWALAN_UNGGAH, nasibBuktiTerima } from "./bukti-terima-classify";
import { nasibUnggah, type NasibKiriman } from "./laporan-classify";

/**
 * Kirim bukti terima yang tertahan di HP.
 *
 * Urutan per bukti: unggah gambarnya (bila masih berkas di HP), simpan URL-nya
 * kembali ke baris antrean supaya percobaan berikutnya tidak mengunggah ulang,
 * baru panggil aksi dengan kunci kiriman. Jawaban yang hilang di jalan aman:
 * kiriman berikutnya membawa kunci yang sama dan server menjawab "sudah ada".
 */

let berjalan = false;

class GagalUnggah extends Error {
  constructor(readonly nasib: NasibKiriman, readonly kode: string) {
    super(kode);
  }
}

/** Salinan kecil dari pola `laporan-sync.ts` — gambar → URL, unggah bila masih berkas. */
async function pastikanUrl(foto: FotoTertunda | null, simpan: (f: FotoTertunda) => Promise<void>): Promise<string | null> {
  if (!foto) return null;
  if (foto.url) return foto.url;
  if (!foto.blob) return null;
  try {
    const url = await unggahFoto(new File([foto.blob], foto.nama || "bukti-terima.jpg", { type: foto.blob.type || "image/jpeg" }));
    await simpan({ nama: foto.nama, url });
    return url;
  } catch (err) {
    throw new GagalUnggah(nasibUnggah(err), err instanceof Error ? err.message : "GAGAL");
  }
}

export async function flushBuktiTerimaTertahan(): Promise<{ terkirim: number; gagal: number }> {
  if (berjalan) return { terkirim: 0, gagal: 0 };
  berjalan = true;
  let terkirim = 0;
  let gagal = 0;
  try {
    // "syncing" ikut diambil: kunci-jalan menjamin tidak ada flush lain, jadi
    // baris "syncing" adalah sisa aplikasi yang ditutup di tengah kiriman.
    const daftar = (await pwaDb.pendingBuktiTerima.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort(
      (a, b) => a.capturedAt - b.capturedAt,
    );
    for (const b of daftar) {
      await pwaDb.pendingBuktiTerima.update(b.localId, { syncState: "syncing" });
      let nasib: NasibKiriman;
      let alasan = "";
      try {
        const podPhotoUrl = await pastikanUrl(b.foto, (f) =>
          pwaDb.pendingBuktiTerima.update(b.localId, { foto: f }).then(() => undefined),
        );
        const hasil = await catatBuktiTerimaAction({
          deliveryId: b.deliveryId,
          ...b.payload,
          podPhotoUrl,
          idempotencyKey: b.localId,
        });
        nasib = nasibBuktiTerima(hasil);
        if (!hasil.ok) alasan = hasil.kode;
      } catch (err) {
        nasib = err instanceof GagalUnggah ? err.nasib : "retry";
        if (err instanceof GagalUnggah) alasan = `${AWALAN_UNGGAH}${err.kode}`;
      }
      if (nasib === "evict") {
        await pwaDb.pendingBuktiTerima.delete(b.localId);
        terkirim += 1;
      } else {
        await pwaDb.pendingBuktiTerima.update(b.localId, {
          syncState: nasib === "terminal" ? "failed" : "pending",
          error: alasan || undefined,
          attempts: b.attempts + 1,
        });
        if (nasib === "terminal") gagal += 1;
      }
    }
  } finally {
    berjalan = false;
  }
  return { terkirim, gagal };
}
