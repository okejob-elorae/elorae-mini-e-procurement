/**
 * Menyalin teks ke papan klip, dengan jalur cadangan.
 *
 * `navigator.clipboard` hanya tersedia di konteks aman (https atau localhost).
 * ERP lokal juga dibuka dari HP lewat alamat jaringan (`http://192.168.x.x`),
 * dan di sana API itu tidak ada — memanggilnya langsung melempar dan tombol
 * salin diam saja. Jalur cadangannya `execCommand('copy')`: usang, tetapi masih
 * didukung Safari dan Chrome.
 */
export async function salinTeks(teks: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(teks);
      return true;
    } catch {
      // Ditolak izin atau fokus hilang — coba jalur lama di bawah.
    }
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = teks;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
