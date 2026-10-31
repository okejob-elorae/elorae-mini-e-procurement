import { formatDateOnlyJakarta, formatDisplayDateTime } from "@/lib/date-only";
import { tautanKabar } from "@/lib/notifications/tautan-kabar";

/** Satu baris layar Kabar — semua teks waktu sudah jadi, klien tidak memformat tanggal. */
export type BarisKabar = {
  id: string;
  jenis: string;
  judul: string;
  isi: string;
  /** Jam saja ("14.30") kalau `hariIni`, selain itu tanggal + jam ("26 Sep 2026, 14.30"). */
  waktu: string;
  hariIni: boolean;
  dibaca: boolean;
  href: string | null;
};

export type BarisAntrean = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
};

const JAM = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/**
 * Baris `NotificationQueue` → baris layar. Dijalankan di SERVER: tanggal yang diformat di klien
 * bisa berbeda dari hasil server (zona dan locale peramban), dan Safari memunculkan galat
 * hidrasi karenanya. "Hari ini" dihitung per hari kalender WIB, bukan 24 jam terakhir.
 */
export function susunBarisKabar(rows: BarisAntrean[], sekarang: Date): BarisKabar[] {
  const hariIniWib = formatDateOnlyJakarta(sekarang);
  return rows.map((r) => {
    const hariIni = formatDateOnlyJakarta(r.createdAt) === hariIniWib;
    return {
      id: r.id,
      jenis: r.type,
      judul: r.title,
      isi: r.body,
      waktu: hariIni ? JAM.format(r.createdAt) : formatDisplayDateTime(r.createdAt),
      hariIni,
      dibaca: r.readAt !== null,
      href: tautanKabar(r.type, r.data),
    };
  });
}
