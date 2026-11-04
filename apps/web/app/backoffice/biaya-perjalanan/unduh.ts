/**
 * Unduh berkas Excel yang dikirim aksi server sebagai base64 — dipakai layar
 * biaya perjalanan dan absensi (pola yang sama dengan tombol ekspor laporan
 * keuangan).
 */
export function unduhExcel(base64: string, filename: string): void {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
