import { formatDateOnlyJakarta, formatDisplayDateTime } from "@/lib/date-only";
import { getNotificationHref } from "@/lib/notifications/navigation";

/** Satu baris layar Kabar — semua teks waktu sudah jadi, klien tidak memformat tanggal. */
export type BarisKabar = {
  id: string;
  jenis: string;
  judul: string;
  isi: string;
  /** `data` notifikasi apa adanya — bahan terjemahan judul/isi kalimat kantor (`tampilanLonceng`). */
  data: unknown;
  /** Jam saja ("14.30") kalau `hariIni`, selain itu tanggal + jam ("26 Sep 2026, 14.30"). */
  waktu: string;
  hariIni: boolean;
  dibaca: boolean;
  href: string | null;
  /** Saat dibuat (ISO) — hanya untuk mengurutkan halaman yang dimuat belakangan, tidak ditampilkan. */
  dibuat: string;
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
 *
 * Tautan memakai tujuan HP (`getNotificationHref(…, "pwa")`): kabar Max dan jenis-jenis tim
 * sama-sama dibawa ke layar HP-nya, dan pekerjaan kantor yang tidak punya layar di HP → `null`
 * (ketukannya hanya menandai dibaca). Tidak pernah halaman backoffice.
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
      data: r.data,
      waktu: hariIni ? JAM.format(r.createdAt) : formatDisplayDateTime(r.createdAt),
      hariIni,
      dibaca: r.readAt !== null,
      href: getNotificationHref(r.type, r.data, "pwa"),
      dibuat: r.createdAt.toISOString(),
    };
  });
}

/**
 * Gabungan beberapa daftar baris tanpa kembar, terbaru di atas — urutan yang sama dengan halaman
 * `fetchNotificationPage` (dibuat menurun, lalu id menurun). Baris yang muncul di lebih dari satu
 * daftar diambil dari daftar PERTAMA yang memuatnya: taruh daftar yang paling segar di depan
 * (halaman pertama dari server), supaya status dibacanya yang berlaku.
 */
export function gabungBaris(...daftar: readonly (readonly BarisKabar[])[]): BarisKabar[] {
  const terlihat = new Set<string>();
  const hasil: BarisKabar[] = [];
  for (const baris of daftar) {
    for (const b of baris) {
      if (terlihat.has(b.id)) continue;
      terlihat.add(b.id);
      hasil.push(b);
    }
  }
  return hasil.sort((a, b) => urutTurun(a.dibuat, b.dibuat) || urutTurun(a.id, b.id));
}

function urutTurun(a: string, b: string): number {
  return a === b ? 0 : a < b ? 1 : -1;
}
