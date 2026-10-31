import { SARINGAN_FOLLOW_UP, type SaringanFollowUp } from "@/lib/production/jadwal-jejak";
import type { KeadaanLangkah, StatusLangkah } from "@/lib/production/jadwal";
import { bacaTanggal, geserHari, labelTanggal } from "@/lib/tanggal-isian";
import type { StatusTone } from "@/components/ui/status-pill";

/*
 * Follow-up produksi — bagian murni halaman (2026-10-07). Aman untuk klien:
 * tanpa Prisma, tanpa next-intl. Halaman server membaca alamatnya lewat
 * `bacaParamFollowUp`; kliennya menulis balik lewat `alamatFollowUp`, jadi
 * tautan Beranda (`?saring=terlambat`) dan tautan yang dibagikan membuka
 * keadaan yang sama.
 */

export const RUTE_FOLLOW_UP = "/backoffice/production/follow-up";

/** Tab yang terbuka bila alamat tidak menyebut `?saring=`. */
export const SARINGAN_BAWAAN: SaringanFollowUp = "hari-ini";

export type TampilanFollowUp = "daftar" | "kalender";

export type ParamFollowUp = {
  saring: SaringanFollowUp;
  /** `?pemasok=<supplierId>`; null = semua pemasok. */
  pemasok: string | null;
  halaman: number;
  tampilan: TampilanFollowUp;
  /** "YYYY-MM" — bulan kalender yang dibuka. */
  bulan: string;
};

type IsiAlamat = Record<string, string | string[] | undefined>;

const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" yang sah (tahun 2000–2100), atau null. */
export function bacaBulan(teks: string | null | undefined): { tahun: number; bulan: number } | null {
  const m = POLA_BULAN.exec(teks ?? "");
  if (!m) return null;
  const tahun = Number(m[1]);
  if (tahun < 2000 || tahun > 2100) return null;
  return { tahun, bulan: Number(m[2]) };
}

export function bacaParamFollowUp(sp: IsiAlamat, hariIni: string): ParamFollowUp {
  const saringMentah = satu(sp.saring);
  const saring = (SARINGAN_FOLLOW_UP as readonly string[]).includes(saringMentah ?? "")
    ? (saringMentah as SaringanFollowUp)
    : SARINGAN_BAWAAN;
  const pemasokMentah = satu(sp.pemasok)?.trim() ?? "";
  const pemasok = pemasokMentah && pemasokMentah.length <= 64 ? pemasokMentah : null;
  const halamanMentah = Number(satu(sp.halaman));
  const halaman = Number.isInteger(halamanMentah) && halamanMentah >= 1 && halamanMentah <= 10_000 ? halamanMentah : 1;
  const tampilan: TampilanFollowUp = satu(sp.tampilan) === "kalender" ? "kalender" : "daftar";
  const bulanMentah = satu(sp.bulan);
  const bulan = bacaBulan(bulanMentah) ? (bulanMentah as string) : hariIni.slice(0, 7);
  return { saring, pemasok, halaman, tampilan, bulan };
}

/** Alamat untuk keadaan `p`; nilai bawaan tidak ditulis supaya alamatnya pendek. */
export function alamatFollowUp(p: ParamFollowUp, hariIni: string): string {
  const q = new URLSearchParams();
  if (p.tampilan === "kalender") {
    q.set("tampilan", "kalender");
    if (p.bulan !== hariIni.slice(0, 7)) q.set("bulan", p.bulan);
  } else {
    if (p.saring !== SARINGAN_BAWAAN) q.set("saring", p.saring);
    if (p.halaman > 1) q.set("halaman", String(p.halaman));
  }
  if (p.pemasok) q.set("pemasok", p.pemasok);
  const qs = q.toString();
  return qs ? `${RUTE_FOLLOW_UP}?${qs}` : RUTE_FOLLOW_UP;
}

/** Geser "YYYY-MM" sebanyak `n` bulan (boleh negatif). */
export function geserBulan(bulan: string, n: number): string {
  const b = bacaBulan(bulan);
  if (!b) return bulan;
  const indeks = b.tahun * 12 + (b.bulan - 1) + n;
  const tahun = Math.floor(indeks / 12);
  return `${tahun}-${String((indeks % 12) + 1).padStart(2, "0")}`;
}

export type HariKisi = { tanggal: string; diBulan: boolean };

/** Hari dalam minggu (0 = Minggu) dari teks tanggal. */
export function hariDalamMinggu(teks: string): number {
  const b = bacaTanggal(teks);
  return b ? new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari)).getUTCDay() : -1;
}

/**
 * Kisi kalender satu bulan, minggu dimulai SENIN. Hari dari bulan sebelum/
 * sesudahnya ikut mengisi minggu pertama dan terakhir (`diBulan: false`).
 */
export function kisiBulan(bulan: string): HariKisi[][] {
  const b = bacaBulan(bulan);
  if (!b) return [];
  const awal = `${bulan}-01`;
  const mulai = geserHari(awal, -((hariDalamMinggu(awal) + 6) % 7));
  const minggu: HariKisi[][] = [];
  let kursor = mulai;
  for (let i = 0; i < 6; i++) {
    const baris: HariKisi[] = [];
    for (let j = 0; j < 7; j++) {
      baris.push({ tanggal: kursor, diBulan: kursor.slice(0, 7) === bulan });
      kursor = geserHari(kursor, 1);
    }
    minggu.push(baris);
    if (kursor.slice(0, 7) !== bulan) break;
  }
  return minggu;
}

/** Selisih hari kalender `tanggal − hariIni` (negatif = sudah lewat). */
export function selisihHari(tanggal: string, hariIni: string): number {
  const a = bacaTanggal(hariIni);
  const b = bacaTanggal(tanggal);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.tahun, b.bulan - 1, b.hari) - Date.UTC(a.tahun, a.bulan - 1, a.hari)) / 86_400_000);
}

/**
 * Pesan WhatsApp ke pemasok. SELALU Bahasa Indonesia, tidak lewat next-intl:
 * pembacanya pemasok. Hanya membuka WhatsApp — tim yang membaca dan menekan kirim.
 */
export function pesanWaFollowUp(b: { pemasok: string; langkah: string; tahap: string; target: string }): string {
  return `Halo ${b.pemasok}, menanyakan proses ${b.langkah} untuk ${b.tahap} — target ${labelTanggal(b.target, "id")}.`;
}

/** Tautan `https://wa.me/<n>` dari server + pesan terisi; null bila pemasok tanpa nomor WhatsApp. */
export function tautanWaFollowUp(wa: string | null | undefined, pesan: string): string | null {
  if (!wa || !/^https:\/\/wa\.me\/\d+$/.test(wa)) return null;
  return `${wa}?text=${encodeURIComponent(pesan)}`;
}

export const NADA_STATUS: Record<StatusLangkah, StatusTone> = {
  BELUM: "inactive",
  PROSES: "progress",
  SELESAI: "settled",
};

export const NADA_KEADAAN: Record<KeadaanLangkah, StatusTone> = {
  TELAT: "attention",
  HARI_INI: "waiting",
  MENDATANG: "inactive",
  SELESAI: "settled",
};

/** Status yang wajar dipilih berikutnya di dialog ubah status. */
export function statusBerikutnya(status: StatusLangkah): StatusLangkah {
  return status === "BELUM" ? "PROSES" : "SELESAI";
}

export const RUANG_KERJA_TAHAP = (tahapId: string) => `/backoffice/production/planning/tahap/${tahapId}`;
