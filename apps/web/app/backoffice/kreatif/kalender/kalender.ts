import { bacaTanggal } from "@/lib/tanggal-isian";
import type { JenisAgenda } from "@/lib/creative/tahap";
import type { JenisTenggat } from "@/lib/creative/tenggat";
import type { AgendaKalender, GrupKalender, HariKalender, JenisKejadian } from "@/lib/creative/agenda-queries";
import { bacaBulan, geserBulan, kisiBulan, type HariKisi } from "../../production/follow-up/follow-up";

/*
 * Kalender Ruang KOL — bagian murni halaman. Aman untuk klien (tipe dari
 * `agenda-queries` hanya `import type`). Kisi bulan Senin-di-depan dipinjam
 * dari Follow-up produksi supaya kedua kalender selalu sama bentuknya.
 */

export { bacaBulan, geserBulan, kisiBulan, type HariKisi };

export const RUTE_KALENDER = "/backoffice/kreatif/kalender";

export const PRESET_KALENDER = ["semua", "tenggat", "logistik", "konten", "pembayaran", "agenda"] as const;
export type PresetKalender = (typeof PRESET_KALENDER)[number];

export function bacaPreset(teks: string | null | undefined): PresetKalender | null {
  return (PRESET_KALENDER as readonly string[]).includes(teks ?? "") ? (teks as PresetKalender) : null;
}

/** Kunci localStorage preset per orang (diingat per pengguna, bukan per peramban). */
export const kunciPreset = (userId: string) => `elorae.kreatif.kalender.jenis.${userId}`;

const TENGGAT_LOGISTIK: ReadonlySet<JenisTenggat> = new Set(["KIRIM_SAMPEL", "RESI_NYANGKUT"]);
const TENGGAT_KONTEN: ReadonlySet<JenisTenggat> = new Set(["BATAS_TAYANG", "REVIEW_DRAF", "ANGKA_H1", "ANGKA_H3", "ANGKA_H7"]);
const KEJADIAN_LOGISTIK: ReadonlySet<JenisKejadian> = new Set(["KIRIM", "SAMPAI"]);
const KEJADIAN_KONTEN: ReadonlySet<JenisKejadian> = new Set(["RENCANA_TAYANG", "TAYANG"]);

export function tampilTenggat(p: PresetKalender, j: JenisTenggat): boolean {
  switch (p) {
    case "semua":
    case "tenggat":
      return true;
    case "logistik":
      return TENGGAT_LOGISTIK.has(j);
    case "konten":
      return TENGGAT_KONTEN.has(j);
    case "pembayaran":
      return j === "JATUH_TEMPO_BAYAR";
    case "agenda":
      return false;
  }
}

export function tampilKejadian(p: PresetKalender, j: JenisKejadian): boolean {
  switch (p) {
    case "semua":
      return true;
    case "logistik":
      return KEJADIAN_LOGISTIK.has(j);
    case "konten":
      return KEJADIAN_KONTEN.has(j);
    case "pembayaran":
      return j === "DIBAYAR";
    case "tenggat":
    case "agenda":
      return false;
  }
}

export function tampilAgenda(p: PresetKalender, j: JenisAgenda): boolean {
  switch (p) {
    case "semua":
    case "agenda":
      return true;
    case "logistik":
      return j === "KIRIM";
    case "konten":
      return j === "KONTEN";
    case "pembayaran":
      return j === "BAYAR";
    case "tenggat":
      return false;
  }
}

/** Isi satu hari yang lolos preset. */
export function saringHari(h: HariKalender | undefined, p: PresetKalender): HariKalender {
  if (!h) return { tenggat: [], kejadian: [], agenda: [] };
  return {
    tenggat: h.tenggat.filter((g) => tampilTenggat(p, g.jenis)),
    kejadian: h.kejadian.filter((g) => tampilKejadian(p, g.jenis)),
    agenda: h.agenda.filter((a) => tampilAgenda(p, a.jenis)),
  };
}

export type BarisSel =
  | { macam: "tenggat"; grup: GrupKalender<JenisTenggat> }
  | { macam: "agenda"; agenda: AgendaKalender }
  | { macam: "kejadian"; grup: GrupKalender<JenisKejadian> };

/** Baris per sel sebelum "+N lagi". */
export const BARIS_PER_SEL = 4;
/** Agenda yang boleh mengisi sel sebelum kejadian mendapat giliran. */
const AGENDA_PER_SEL = 2;

/**
 * Baris sel kisi: tenggat dulu (yang mendesak), lalu agenda (paling banyak
 * dua), lalu kejadian, lalu sisa agenda. Paling banyak `BARIS_PER_SEL`;
 * `sisa` = banyak baris yang tidak muat.
 */
export function barisSel(h: HariKalender): { tampil: BarisSel[]; sisa: number } {
  const semua: BarisSel[] = [
    ...h.tenggat.map((grup) => ({ macam: "tenggat" as const, grup })),
    ...h.agenda.slice(0, AGENDA_PER_SEL).map((agenda) => ({ macam: "agenda" as const, agenda })),
    ...h.kejadian.map((grup) => ({ macam: "kejadian" as const, grup })),
    ...h.agenda.slice(AGENDA_PER_SEL).map((agenda) => ({ macam: "agenda" as const, agenda })),
  ];
  return { tampil: semua.slice(0, BARIS_PER_SEL), sisa: Math.max(0, semua.length - BARIS_PER_SEL) };
}

/** Banyak agenda belum selesai — pil merah di sel. */
export function agendaTerbuka(h: HariKalender | undefined): number {
  return h ? h.agenda.filter((a) => !a.selesai).length : 0;
}

/** Banyak hal di satu hari (untuk ringkasan "N kejadian" di kepala bulan). */
export function jumlahIsi(h: HariKalender): number {
  return h.tenggat.reduce((s, g) => s + g.jumlah, 0) + h.kejadian.reduce((s, g) => s + g.jumlah, 0) + h.agenda.length;
}

export type ParamKalender = {
  /** "YYYY-MM". */
  bulan: string;
  /** Hari yang dipilih (panel). */
  tanggal: string;
  /** Preset di alamat; null = pakai yang diingat. */
  jenis: PresetKalender | null;
  /** Agenda yang dibuka langsung (tautan dari Hari ini). */
  agenda: string | null;
};

type IsiAlamat = Record<string, string | string[] | undefined>;
const satu = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function bacaParamKalender(sp: IsiAlamat, hariIni: string): ParamKalender {
  const tanggalMentah = satu(sp.tanggal) ?? "";
  const tanggalSah = bacaTanggal(tanggalMentah) ? tanggalMentah : null;
  const bulanMentah = satu(sp.bulan) ?? "";
  const bulan = bacaBulan(bulanMentah) ? bulanMentah : (tanggalSah ?? hariIni).slice(0, 7);
  const tanggal = tanggalSah && tanggalSah.slice(0, 7) === bulan ? tanggalSah : hariIni.slice(0, 7) === bulan ? hariIni : `${bulan}-01`;
  const agendaMentah = satu(sp.agenda)?.trim() ?? "";
  return { bulan, tanggal, jenis: bacaPreset(satu(sp.jenis)), agenda: agendaMentah && agendaMentah.length <= 64 ? agendaMentah : null };
}

/** Alamat keadaan kalender. Agenda yang dibuka tidak ikut ditulis (sekali buka). */
export function alamatKalender(p: Omit<ParamKalender, "agenda">): string {
  const q = new URLSearchParams({ bulan: p.bulan, tanggal: p.tanggal });
  if (p.jenis && p.jenis !== "semua") q.set("jenis", p.jenis);
  return `${RUTE_KALENDER}?${q.toString()}`;
}

/** Rentang hari yang tampil di kisi bulan (termasuk hari tetangga). */
export function rentangKisi(bulan: string): { dari: string; sampai: string } | null {
  const kisi = kisiBulan(bulan).flat();
  if (!kisi.length) return null;
  return { dari: kisi[0].tanggal, sampai: kisi[kisi.length - 1].tanggal };
}
