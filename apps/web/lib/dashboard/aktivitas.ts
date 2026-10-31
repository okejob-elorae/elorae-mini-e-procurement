/**
 * Aktivitas terkini di beranda, dikelompokkan.
 *
 * Jejak audit mencatat SETIAP tindakan, jadi sepuluh baris terakhirnya bisa
 * berisi satu tindakan yang sama sepuluh kali — "Rencana konten ditukar ·
 * oleh Administrator", berulang, memenuhi separuh beranda tanpa memberi tahu
 * apa pun yang baru. Deret berurutan dari tindakan yang sama, pada jenis
 * catatan yang sama, oleh orang yang sama dilipat jadi satu baris dengan
 * jumlahnya.
 *
 * Hanya yang BERURUTAN yang dilipat: tindakan lain yang terjadi di antaranya
 * tetap di tempatnya, jadi urutan kejadiannya tidak berbohong.
 */

export type Aktivitas = {
  id: string;
  action: string;
  entityType: string;
  userName: string | null;
  /** ISO — datang dari server lewat serialisasi. */
  createdAt: string;
};

export type KelompokAktivitas = Aktivitas & {
  /** Berapa tindakan yang dilipat ke baris ini. */
  jumlah: number;
  /** Waktu tindakan PERTAMA dalam deret (daftarnya terbaru di atas). */
  terlama: string;
};

export function kelompokkanAktivitas(daftar: readonly Aktivitas[], maks: number): KelompokAktivitas[] {
  const hasil: KelompokAktivitas[] = [];
  for (const a of daftar) {
    const akhir = hasil[hasil.length - 1];
    if (
      akhir &&
      akhir.action === a.action &&
      akhir.entityType === a.entityType &&
      akhir.userName === a.userName
    ) {
      akhir.jumlah += 1;
      akhir.terlama = a.createdAt;
      continue;
    }
    if (hasil.length === maks) break;
    hasil.push({ ...a, jumlah: 1, terlama: a.createdAt });
  }
  return hasil;
}
