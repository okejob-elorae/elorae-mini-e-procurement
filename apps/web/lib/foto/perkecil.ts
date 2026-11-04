/**
 * Perkecil foto sebelum diunggah.
 *
 * Dipisah dari `UnggahFoto` begitu grid feed ikut mengunggah langsung dari
 * ubinnya: dua salinan aturan kompresi akan menyimpang, lalu foto yang naik
 * lewat jalur berbeda punya ukuran berbeda tanpa ada yang tahu kenapa.
 */
const MAKS_SISI = 1600;
const MUTU = 0.82;

/**
 * Perkecil foto sebelum diunggah.
 *
 * Foto kamera HP hari ini 3–8 MB; nota retur tetap terbaca jelas pada sisi
 * terpanjang 1600 px. Tanpa ini setiap nota memakan berkali-kali lipat ruang
 * database dan menit-menit waktu unggah di jaringan lapangan.
 *
 * Kalau kanvasnya gagal karena alasan apa pun, berkas aslinya dipakai apa
 * adanya — lebih baik lambat daripada tidak bisa mengunggah sama sekali.
 */
export async function perkecil(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const skala = Math.min(1, MAKS_SISI / Math.max(bitmap.width, bitmap.height));
    if (skala === 1 && file.size < 1_500_000) return file;

    const kanvas = document.createElement('canvas');
    kanvas.width = Math.round(bitmap.width * skala);
    kanvas.height = Math.round(bitmap.height * skala);
    const ctx = kanvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, kanvas.width, kanvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      kanvas.toBlob(resolve, 'image/jpeg', MUTU),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
