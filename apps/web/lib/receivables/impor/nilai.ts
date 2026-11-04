/**
 * Pembacaan angka dan tanggal dari sel Excel.
 *
 * Keduanya ditulis manusia dengan kebiasaan yang berbeda-beda, dan menebaknya
 * salah berarti angka uang atau tanggal tagih yang salah — bukan sekadar tampilan.
 */

/**
 * Baca nilai rupiah.
 *
 * Menerima `1.250.000`, `1250000,50`, `Rp 1.250.000`, dan angka Excel asli.
 *
 * Aturan pemisah desimal: tanda baca PALING BELAKANG dianggap desimal **hanya
 * kalau** diikuti satu atau dua angka. `1.250.000` titik terakhirnya diikuti
 * tiga angka, jadi ia pemisah ribuan; `1250000,50` diikuti dua, jadi desimal.
 * Tanpa aturan ini `1.250.000` terbaca 1,25 — salah seribu kali lipat.
 */
export function keRupiah(nilai: unknown): number | null {
  if (typeof nilai === 'number') return Number.isFinite(nilai) ? nilai : null;

  const teks = String(nilai ?? '').trim();
  if (teks === '') return null;

  const bersih = teks.replace(/[^\d.,-]/g, '');
  if (bersih === '' || bersih === '-') return null;

  const negatif = bersih.startsWith('-');
  const angka = bersih.replace(/-/g, '');

  const titikTerakhir = Math.max(angka.lastIndexOf('.'), angka.lastIndexOf(','));
  let hasil: number;
  if (titikTerakhir === -1) {
    hasil = Number(angka);
  } else {
    const ekor = angka.length - titikTerakhir - 1;
    if (ekor >= 1 && ekor <= 2) {
      const utuh = angka.slice(0, titikTerakhir).replace(/[.,]/g, '');
      hasil = Number(`${utuh}.${angka.slice(titikTerakhir + 1)}`);
    } else {
      hasil = Number(angka.replace(/[.,]/g, ''));
    }
  }

  if (!Number.isFinite(hasil)) return null;
  return negatif ? -hasil : hasil;
}

/**
 * Baca tanggal.
 *
 * Menerima `2026-08-21`, `21/08/2026`, `21-08-26`, dan tanggal Excel asli.
 * Tahun dua digit: lebih dari 70 → 19xx, selain itu 20xx.
 *
 * Selalu tengah malam WIB. Tanggal jatuh tempo yang bergeser satu hari karena
 * zona waktu akan menandai faktur lewat tempo sehari lebih cepat.
 */
export function keTanggal(nilai: unknown): Date | null {
  if (nilai instanceof Date) return Number.isNaN(nilai.getTime()) ? null : nilai;

  // Excel menyimpan tanggal sebagai jumlah hari sejak 30 Des 1899.
  if (typeof nilai === 'number' && Number.isFinite(nilai) && nilai > 0) {
    const ms = Math.round((nilai - 25569) * 86_400_000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const teks = String(nilai ?? '').trim();
  if (teks === '') return null;

  const iso = teks.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return rakit(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const lokal = teks.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (lokal) {
    const th = Number(lokal[3]);
    const tahun = lokal[3].length === 4 ? th : th > 70 ? 1900 + th : 2000 + th;
    return rakit(tahun, Number(lokal[2]), Number(lokal[1]));
  }

  const bebas = new Date(teks);
  return Number.isNaN(bebas.getTime()) ? null : bebas;
}

function rakit(tahun: number, bulan: number, hari: number): Date | null {
  if (bulan < 1 || bulan > 12 || hari < 1 || hari > 31) return null;
  const d = new Date(
    `${String(tahun).padStart(4, '0')}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}T00:00:00+07:00`,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
