import { perkecil } from './perkecil';

/**
 * Unggah satu foto, kembalikan URL-nya.
 *
 * Jalur unggah yang sama untuk formulir maupun ubin grid. Sebelumnya logika ini
 * hanya hidup di dalam komponen `UnggahFoto`, jadi tempat lain yang mau
 * mengunggah harus menyalinnya — dan salinan yang menyimpang berarti foto yang
 * naik lewat jalur berbeda diperlakukan berbeda.
 */
export async function unggahFoto(file: File): Promise<string> {
  const kecil = await perkecil(file);
  const form = new FormData();
  // Ekstensi disamakan ke .jpg karena `perkecil` mengeluarkan JPEG; nama asli
  // yang berakhiran .png pada isi JPEG membingungkan siapa pun yang mengunduhnya.
  form.append('file', kecil, file.name.replace(/\.[^.]+$/, '') + '.jpg');

  const res = await fetch('/api/foto', { method: 'POST', body: form });
  if (!res.ok) {
    // Kode galatnya diteruskan apa adanya supaya pemanggil bisa menerjemahkannya
    // — "gagal unggah" tanpa sebab memaksa orang menebak berkasnya kenapa.
    const isi = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(isi?.error ?? 'GAGAL');
  }
  const { url } = (await res.json()) as { url: string };
  return url;
}
