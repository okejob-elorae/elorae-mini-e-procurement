/**
 * Nilai isian tanggal di formulir: teks "YYYY-MM-DD" (dan "YYYY-MM-DDTHH:mm"
 * untuk tanggal-dan-jam) — bentuk yang sama dengan `<input type="date">`, jadi
 * seluruh formulir dan filter yang sudah ada tidak perlu tahu isiannya diganti.
 *
 * Kalender (react-day-picker) bekerja dengan `Date` lokal peramban. Teks
 * tanggal dipetakan ke tengah malam LOKAL dan kembali lewat getter lokal,
 * jadi zona waktu peramban tidak pernah menggeser harinya — berbeda dengan
 * `new Date("2026-10-01")`, yang dibaca UTC dan di Amerika jatuh 30 September.
 *
 * Aman untuk komponen klien: tanpa Prisma, tanpa `next-intl/server`.
 */

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;
const POLA_JAM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type BagianTanggal = { tahun: number; bulan: number; hari: number };

/** "2026-10-01" → bagian-bagiannya; `null` untuk teks kosong atau tanggal yang tidak ada (2026-02-31). */
export function bacaTanggal(teks: string | null | undefined): BagianTanggal | null {
  const m = POLA_TANGGAL.exec(teks ?? "");
  if (!m) return null;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  const cek = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (cek.getUTCFullYear() !== tahun || cek.getUTCMonth() !== bulan - 1 || cek.getUTCDate() !== hari) return null;
  return { tahun, bulan, hari };
}

/** Teks tanggal → `Date` tengah malam LOKAL, untuk kalender. */
export function keDateLokal(teks: string | null | undefined): Date | undefined {
  const b = bacaTanggal(teks);
  return b ? new Date(b.tahun, b.bulan - 1, b.hari) : undefined;
}

const dua = (n: number) => String(n).padStart(2, "0");

/** `Date` dari kalender → teks tanggal, lewat getter LOKAL. */
export function dariDateLokal(d: Date): string {
  return `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}`;
}

/** Hari ini di WIB — bukan di zona peramban, dan bukan UTC. */
export function hariIniWib(sekarang: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(sekarang);
}

/**
 * Label tampilan "1 Okt 2026" / "1 Oct 2026". Diformat dari tengah hari UTC
 * dengan zona UTC, jadi hari yang tampil selalu hari yang tertulis.
 */
export function labelTanggal(teks: string | null | undefined, locale: string = "id"): string {
  const b = bacaTanggal(teks);
  if (!b) return "";
  const lokal = locale.toLowerCase().startsWith("en") ? "en-GB" : "id-ID";
  return new Intl.DateTimeFormat(lokal, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari, 12)),
  );
}

/** Apakah teks tanggal berada dalam batas `min`/`max` (keduanya teks tanggal, boleh kosong). */
export function dalamBatas(teks: string, min?: string | null, max?: string | null): boolean {
  if (!bacaTanggal(teks)) return false;
  // Teks "YYYY-MM-DD" bisa dibandingkan sebagai teks.
  if (min && bacaTanggal(min) && teks < min) return false;
  if (max && bacaTanggal(max) && teks > max) return false;
  return true;
}

/** "08:05" → bagiannya; `null` kalau bukan jam yang sah. */
export function bacaJam(teks: string | null | undefined): { jam: number; menit: number } | null {
  const m = POLA_JAM.exec(teks ?? "");
  return m ? { jam: Number(m[1]), menit: Number(m[2]) } : null;
}

export function teksJam(jam: number, menit: number): string {
  return `${dua(jam)}:${dua(menit)}`;
}

/** "2026-10-01T08:05" → { tanggal, jam }. Bagian yang tidak sah menjadi "". */
export function pisahWaktu(teks: string | null | undefined): { tanggal: string; jam: string } {
  const [t = "", j = ""] = (teks ?? "").split("T");
  return { tanggal: bacaTanggal(t) ? t : "", jam: bacaJam(j.slice(0, 5)) ? j.slice(0, 5) : "" };
}

/** Gabungkan kembali; kosong kalau tanggalnya belum dipilih. */
export function gabungWaktu(tanggal: string, jam: string): string {
  if (!bacaTanggal(tanggal)) return "";
  return `${tanggal}T${bacaJam(jam) ? jam : "00:00"}`;
}

/* ---------------------------------------------------------------- rentang */

export type Rentang = { dari: string; sampai: string };

/** Dua tanggal dalam urutan apa pun → rentang yang awalnya tidak sesudah akhirnya. */
export function urutkanRentang(a: string, b: string): Rentang {
  return a <= b ? { dari: a, sampai: b } : { dari: b, sampai: a };
}

/**
 * Label rentang yang dibaca orang: "1–30 Okt 2026", "28 Sep – 3 Okt 2026",
 * "28 Des 2025 – 3 Jan 2026", atau satu tanggal kalau awal = akhir. Kosong
 * kalau salah satunya belum diisi — pemanggil yang memilih kata "Sejak"/"Sampai".
 */
export function labelRentang(
  dari: string,
  sampai: string,
  locale: string = "id",
  { tahun = true }: { tahun?: boolean } = {},
): string {
  const a = bacaTanggal(dari);
  const b = bacaTanggal(sampai);
  if (!a || !b) return "";
  const lokal = locale.toLowerCase().startsWith("en") ? "en-GB" : "id-ID";
  const f = new Intl.DateTimeFormat(lokal, {
    day: "numeric",
    month: "short",
    ...(tahun ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
  const u = urutkanRentang(dari, sampai);
  const keUtc = (t: string) => {
    const x = bacaTanggal(t)!;
    return new Date(Date.UTC(x.tahun, x.bulan - 1, x.hari, 12));
  };
  // ICU memakai spasi tipis di sekitar "–", yang beda-beda per peramban.
  return f.formatRange(keUtc(u.dari), keUtc(u.sampai)).replace(/[\u2009\u202f]/g, " ");
}

/** Banyaknya hari dalam rentang, awal dan akhir ikut dihitung; 0 kalau belum lengkap. */
export function jumlahHari(dari: string, sampai: string): number {
  const a = bacaTanggal(dari);
  const b = bacaTanggal(sampai);
  if (!a || !b) return 0;
  const selisih = Date.UTC(b.tahun, b.bulan - 1, b.hari) - Date.UTC(a.tahun, a.bulan - 1, a.hari);
  return Math.abs(Math.round(selisih / 86_400_000)) + 1;
}

/** Geser teks tanggal sebanyak `hari` (boleh negatif). */
export function geserHari(teks: string, hari: number): string {
  const b = bacaTanggal(teks);
  if (!b) return "";
  const d = new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari + hari));
  return d.toISOString().slice(0, 10);
}

export const PILIHAN_RENTANG = [
  "hariIni",
  "kemarin",
  "mingguIni",
  "mingguLalu",
  "tujuhHari",
  "tigaPuluhHari",
  "sembilanPuluhHari",
  "bulanIni",
  "bulanLalu",
  "tahunIni",
] as const;
export type PilihanRentang = (typeof PILIHAN_RENTANG)[number];

/** Rentang pilihan cepat, dihitung dari "hari ini" WIB yang diberikan. */
export function rentangCepat(pilihan: PilihanRentang, hariIni: string): Rentang {
  const [th, bl] = hariIni.split("-");
  const awalBulan = `${th}-${bl}-01`;
  // Minggu dimulai Senin. getUTCDay: 0 = Minggu.
  const b = bacaTanggal(hariIni)!;
  const keSenin = (new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari)).getUTCDay() + 6) % 7;
  const seninIni = geserHari(hariIni, -keSenin);
  switch (pilihan) {
    case "hariIni":
      return { dari: hariIni, sampai: hariIni };
    case "kemarin": {
      const k = geserHari(hariIni, -1);
      return { dari: k, sampai: k };
    }
    case "mingguIni":
      return { dari: seninIni, sampai: hariIni };
    case "mingguLalu":
      return { dari: geserHari(seninIni, -7), sampai: geserHari(seninIni, -1) };
    case "tujuhHari":
      return { dari: geserHari(hariIni, -6), sampai: hariIni };
    case "tigaPuluhHari":
      return { dari: geserHari(hariIni, -29), sampai: hariIni };
    case "sembilanPuluhHari":
      return { dari: geserHari(hariIni, -89), sampai: hariIni };
    case "bulanIni":
      return { dari: awalBulan, sampai: hariIni };
    case "bulanLalu": {
      const akhirLalu = geserHari(awalBulan, -1);
      return { dari: `${akhirLalu.slice(0, 7)}-01`, sampai: akhirLalu };
    }
    case "tahunIni":
      return { dari: `${th}-01-01`, sampai: hariIni };
  }
}

/**
 * Pangkas rentang ke batas `min`/`max`. `null` kalau tidak ada satu hari pun
 * yang tersisa — pilihan cepat itu lalu dimatikan, bukan diam-diam digeser.
 */
export function pangkasRentang(r: Rentang, min?: string | null, max?: string | null): Rentang | null {
  const dari = min && bacaTanggal(min) && r.dari < min ? min : r.dari;
  const sampai = max && bacaTanggal(max) && r.sampai > max ? max : r.sampai;
  return dari <= sampai ? { dari, sampai } : null;
}
