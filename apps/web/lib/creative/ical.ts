/**
 * Penyusun berkas iCalendar (RFC 5545) — murni, tanpa Prisma.
 *
 * Dipakai tautan langganan Kalender Kreatif (`/api/kreatif/kalender/<token>`),
 * yang dibaca Google Calendar dan Apple Calendar. Yang dijaga di sini adalah
 * bagian RFC yang membuat aplikasi kalender menolak atau salah membaca berkas:
 *   - setiap baris diakhiri CRLF, tidak pernah LF saja;
 *   - baris lebih dari 75 OKTET (bukan huruf) dilipat, lanjutannya diawali satu
 *     spasi, dan lipatan tidak pernah membelah satu karakter UTF-8;
 *   - teks meloloskan `\`, `,`, `;`, dan baris baru;
 *   - acara sepanjang hari memakai `VALUE=DATE` (tanpa zona), acara berjam
 *     memakai waktu UTC berakhiran `Z` — jadi tidak perlu blok VTIMEZONE.
 */

export type MulaiIcs = { tanggal: string } | { waktu: Date };

export type AcaraIcs = {
  /** Tetap untuk barang yang sama di setiap pembacaan, supaya kalender memperbarui, bukan menggandakan. */
  uid: string;
  ringkasan: string;
  keterangan?: string | null;
  url?: string | null;
  /** `{ tanggal: "YYYY-MM-DD" }` = sepanjang hari; `{ waktu }` = berjam. */
  mulai: MulaiIcs;
  /** Bawaan: hari berikutnya (sepanjang hari) atau satu jam sesudah mulai (berjam). */
  selesai?: MulaiIcs;
  kategori?: string | null;
};

export type KalenderIcs = {
  nama: string;
  zonaWaktu: string;
  /** Durasi ISO 8601, mis. "PT1H". */
  segarkan: string;
  prodId: string;
};

const CRLF = "\r\n";
const MAKS_OKTET = 75;
const SATU_JAM_MS = 3_600_000;

/** Teks bebas → nilai TEXT RFC 5545. Garis miring terbalik lebih dulu, supaya lolosan lain tidak dilolos dua kali. */
export function escapeTeksIcs(teks: string): string {
  return teks
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const oktetHuruf = (c: string): number => {
  const k = c.codePointAt(0) ?? 0;
  if (k < 0x80) return 1;
  if (k < 0x800) return 2;
  if (k < 0x10000) return 3;
  return 4;
};

/**
 * Lipat satu baris konten pada 75 oktet. Lanjutan diawali satu spasi, dan
 * spasi itu ikut dihitung dalam 75 oktet barisnya. Diiterasi per titik kode
 * (`for…of`), jadi pasangan surrogate dan karakter berbyte banyak utuh.
 */
export function lipatBarisIcs(baris: string): string {
  const potong: string[] = [];
  let kini = "";
  let oktet = 0;
  let batas = MAKS_OKTET;
  for (const c of baris) {
    const n = oktetHuruf(c);
    if (oktet + n > batas) {
      potong.push(kini);
      kini = " ";
      oktet = 1;
      batas = MAKS_OKTET;
    }
    kini += c;
    oktet += n;
  }
  potong.push(kini);
  return potong.join(CRLF);
}

/** "2026-10-09" → "20261009". */
export function tanggalIcs(tanggal: string): string {
  return tanggal.replace(/-/g, "");
}

const dua = (n: number) => String(n).padStart(2, "0");

/** Instan → "20261009T023000Z" (detik dibulatkan ke bawah). */
export function waktuUtcIcs(d: Date): string {
  return `${d.getUTCFullYear()}${dua(d.getUTCMonth() + 1)}${dua(d.getUTCDate())}T${dua(d.getUTCHours())}${dua(d.getUTCMinutes())}${dua(d.getUTCSeconds())}Z`;
}

/** "2026-12-31" → "2027-01-01" (kalender, tanpa zona). */
export function hariBerikutIcs(tanggal: string): string {
  const [t, b, h] = tanggal.split("-").map(Number);
  const d = new Date(Date.UTC(t, b - 1, h + 1));
  return `${d.getUTCFullYear()}-${dua(d.getUTCMonth() + 1)}-${dua(d.getUTCDate())}`;
}

/** Kunci urut: sepanjang hari dianggap mulai pukul 00.00 WIB. */
function urutMulai(m: MulaiIcs): number {
  return "tanggal" in m ? Date.parse(`${m.tanggal}T00:00:00.000+07:00`) : m.waktu.getTime();
}

function barisMulaiSelesai(a: AcaraIcs): string[] {
  if ("tanggal" in a.mulai) {
    const selesai = a.selesai && "tanggal" in a.selesai ? a.selesai.tanggal : hariBerikutIcs(a.mulai.tanggal);
    return [`DTSTART;VALUE=DATE:${tanggalIcs(a.mulai.tanggal)}`, `DTEND;VALUE=DATE:${tanggalIcs(selesai)}`];
  }
  const selesai = a.selesai && "waktu" in a.selesai ? a.selesai.waktu : new Date(a.mulai.waktu.getTime() + SATU_JAM_MS);
  return [`DTSTART:${waktuUtcIcs(a.mulai.waktu)}`, `DTEND:${waktuUtcIcs(selesai)}`];
}

/** Satu berkas .ics utuh. `dtstamp` = waktu berkas ini disusun. */
export function bangunIcs(kal: KalenderIcs, acara: readonly AcaraIcs[], dtstamp: Date): string {
  const stamp = waktuUtcIcs(dtstamp);
  const baris: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${kal.prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeTeksIcs(kal.nama)}`,
    `X-WR-TIMEZONE:${kal.zonaWaktu}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${kal.segarkan}`,
    `X-PUBLISHED-TTL:${kal.segarkan}`,
  ];
  const urut = [...acara].sort((a, b) => urutMulai(a.mulai) - urutMulai(b.mulai) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  for (const a of urut) {
    baris.push("BEGIN:VEVENT", `UID:${a.uid}`, `DTSTAMP:${stamp}`, ...barisMulaiSelesai(a), `SUMMARY:${escapeTeksIcs(a.ringkasan)}`);
    if (a.keterangan) baris.push(`DESCRIPTION:${escapeTeksIcs(a.keterangan)}`);
    if (a.url) baris.push(`URL:${a.url.replace(/[\r\n]/g, "")}`);
    if (a.kategori) baris.push(`CATEGORIES:${escapeTeksIcs(a.kategori)}`);
    baris.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  baris.push("END:VCALENDAR");
  return baris.map(lipatBarisIcs).join(CRLF) + CRLF;
}
