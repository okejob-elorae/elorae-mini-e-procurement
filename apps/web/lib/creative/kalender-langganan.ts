import { geserHari } from "@/lib/tanggal-isian";
import type { AgendaKalender, BarisKalender, GrupKalender, JenisKejadian, KalenderKreatif } from "./agenda-queries";
import { angkaTitik } from "./angka-konten";
import type { AcaraIcs, KalenderIcs } from "./ical";
import type { JenisAgenda } from "./tahap";
import type { JenisTenggat } from "./tenggat";

/*
 * Langganan Kalender Kreatif di Google Calendar / Apple Calendar — bagian murni.
 *
 * Isi kalender langganan = isi Kalender Kreatif orang itu (`kalenderKreatif`,
 * sumber yang sama dengan halaman Kalender): tenggat turunan, kejadian, dan
 * agenda pribadinya, 30 hari ke belakang sampai 90 hari ke depan. Satu acara per
 * baris, UID tetap per barang (tenggat/kejadian/agenda yang sama di bacaan
 * berikutnya MEMPERBARUI acaranya, tidak menggandakan). Teks selalu bahasa
 * Indonesia — kalender di ponsel tidak punya penerjemah Elorae.
 *
 * `agenda-queries` hanya `import type`, jadi berkas ini aman untuk klien.
 */

export const RENTANG_LANGGANAN = { mundur: 30, maju: 90 } as const;

/** Bacaan per tautan per jam (memori proses, seperti portal toko). */
export const MAKS_BACA_LANGGANAN_PER_JAM = 60;
export const JENDELA_BACA_LANGGANAN_MS = 3_600_000;

/** `lastUsedAt` paling sering diperbarui sekali per 10 menit. */
export const JEDA_CATAT_DIPAKAI_MS = 10 * 60_000;

export const RUTE_LANGGANAN = "/api/kreatif/kalender";

export const KALENDER_LANGGANAN: KalenderIcs = {
  nama: "Elorae · Kreatif",
  zonaWaktu: "Asia/Jakarta",
  segarkan: "PT1H",
  prodId: "-//Elorae//Kalender Kreatif//ID",
};

/** Skema + host (+ port), tanpa jalur — origin halaman yang membuat tautan. */
export const ASAL_SAH = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export const LABEL_TENGGAT: Record<JenisTenggat, string> = {
  FOLLOW_UP: "Follow-up",
  KIRIM_SAMPEL: "Kirim sampel",
  RESI_NYANGKUT: "Resi nyangkut",
  BATAS_TAYANG: "Batas tayang",
  REVIEW_DRAF: "Review draf",
  JATUH_TEMPO_BAYAR: "Jatuh tempo bayar",
  ANGKA_H1: "Angka H+1",
  ANGKA_H3: "Angka H+3",
  ANGKA_H7: "Angka H+7",
};

export const LABEL_KEJADIAN: Record<JenisKejadian, string> = {
  KIRIM: "Paket dikirim",
  SAMPAI: "Paket sampai",
  RENCANA_TAYANG: "Rencana tayang",
  TAYANG: "Konten tayang",
  DIBAYAR: "Dibayar",
  CAMPAIGN_MULAI: "Campaign mulai",
  CAMPAIGN_SELESAI: "Campaign selesai",
};

export const LABEL_JENIS_AGENDA: Record<JenisAgenda, string> = {
  TUGAS: "Tugas",
  MEETING: "Meeting / call",
  DEADLINE: "Deadline",
  KIRIM: "Rencana kirim",
  KONTEN: "Rencana konten",
  BAYAR: "Jadwal bayar",
  LAINNYA: "Lainnya",
};

/** Tab rincian kolaborasi yang paling dekat dengan isi acaranya. */
const TAB_TENGGAT: Partial<Record<JenisTenggat, string>> = {
  KIRIM_SAMPEL: "pengiriman",
  RESI_NYANGKUT: "pengiriman",
  BATAS_TAYANG: "konten",
  REVIEW_DRAF: "konten",
  ANGKA_H1: "konten",
  ANGKA_H3: "konten",
  ANGKA_H7: "konten",
  JATUH_TEMPO_BAYAR: "pembayaran",
};

const TAB_KEJADIAN: Partial<Record<JenisKejadian, string>> = {
  KIRIM: "pengiriman",
  SAMPAI: "pengiriman",
  RENCANA_TAYANG: "konten",
  TAYANG: "konten",
  DIBAYAR: "pembayaran",
};

const DOMAIN_UID = "elorae-kreatif";

export function rentangLangganan(hariIni: string): { dari: string; sampai: string } {
  return { dari: geserHari(hariIni, -RENTANG_LANGGANAN.mundur), sampai: geserHari(hariIni, RENTANG_LANGGANAN.maju) };
}

/** Tiga bentuk tautan untuk satu token: unduhan langsung, webcal (Apple), dan "tambah" Google Calendar. */
export function alamatLangganan(asal: string, token: string): { https: string; webcal: string; google: string } {
  const https = `${asal}${RUTE_LANGGANAN}/${token}`;
  const webcal = https.replace(/^https?:/, "webcal:");
  return { https, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
}

/** Segmen alamat → token. Beberapa aplikasi kalender lebih suka alamat berakhiran ".ics", jadi itu diterima juga. */
export function tokenDariSegmen(segmen: string): string {
  return segmen.replace(/\.ics$/i, "");
}

const nilaiPertama = (v: string | null): string => (v ?? "").split(",")[0]?.trim() ?? "";

/**
 * Origin yang dilihat pembaca untuk tautan di dalam acara. Di VPS, Caddy
 * meneruskan `X-Forwarded-Proto`/`X-Forwarded-Host`; tanpanya `Host` dengan
 * skema cadangan. Nilai yang tidak berbentuk host → `cadangan` utuh.
 */
export function asalPermintaan(kepala: (nama: string) => string | null, cadangan: string): string {
  const skemaCadangan = /^https:/i.test(cadangan) ? "https" : "http";
  const skema = nilaiPertama(kepala("x-forwarded-proto")).toLowerCase() || skemaCadangan;
  const host = nilaiPertama(kepala("x-forwarded-host")) || nilaiPertama(kepala("host"));
  if ((skema !== "http" && skema !== "https") || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return cadangan;
  return `${skema}://${host}`;
}

const amanUid = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-");
const uid = (awalan: string, id: string) => `${awalan}-${amanUid(id)}@${DOMAIN_UID}`;
const rupiah = (n: number) => `Rp ${angkaTitik(n)}`;

function tautanKolaborasi(asal: string, id: string, tab: string | undefined): string {
  return `${asal}/backoffice/kreatif/kolaborasi/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ""}`;
}

function tautanHari(asal: string, tanggal: string, agendaId?: string): string {
  const q = new URLSearchParams({ bulan: tanggal.slice(0, 7), tanggal });
  if (agendaId) q.set("agenda", agendaId);
  return `${asal}/backoffice/kreatif/kalender?${q.toString()}`;
}

function tautanBaris(asal: string, b: BarisKalender, tab: string | undefined, tanggal: string): string {
  if (b.kolaborasiId) return tautanKolaborasi(asal, b.kolaborasiId, tab);
  if (b.campaignId) return `${asal}/backoffice/kreatif/campaign/${encodeURIComponent(b.campaignId)}`;
  return tautanHari(asal, tanggal);
}

const keterangan = (baris: (string | null | undefined)[], url: string) => [...baris.filter((x): x is string => Boolean(x)), `Buka di Elorae: ${url}`].join("\n");

function acaraGrup<J extends string>(
  macam: "tenggat" | "kejadian",
  tanggal: string,
  g: GrupKalender<J>,
  label: string,
  tab: string | undefined,
  nilaiTeks: (n: number) => string,
  asal: string,
): AcaraIcs[] {
  const awal = macam === "tenggat" ? "⚠ " : "";
  const hasil: AcaraIcs[] = g.baris.map((b) => {
    const url = tautanBaris(asal, b, tab, tanggal);
    return {
      uid: uid(macam, b.id),
      ringkasan: `${awal}${label} · ${b.judul}${b.lewat ? " (lewat)" : ""}`,
      keterangan: keterangan([b.sub, b.nilai !== null ? nilaiTeks(b.nilai) : null], url),
      url,
      mulai: { tanggal },
      kategori: macam === "tenggat" ? "Tenggat" : "Kejadian",
    };
  });
  const sisa = g.jumlah - g.baris.length;
  if (sisa > 0) {
    const url = tautanHari(asal, tanggal);
    hasil.push({
      uid: uid(`lainnya-${macam}`, `${g.jenis}-${tanggal}`),
      ringkasan: `${awal}${label} · ${sisa} lainnya`,
      keterangan: keterangan([], url),
      url,
      mulai: { tanggal },
      kategori: macam === "tenggat" ? "Tenggat" : "Kejadian",
    });
  }
  return hasil;
}

/** "10:30" pada hari WIB → instan; jam yang tidak sah → null (acaranya jadi sepanjang hari). */
function waktuAgenda(tanggal: string, jam: string | null): Date | null {
  const m = /^(\d{2}):(\d{2})$/.exec(jam ?? "");
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(`${tanggal}T${m[1]}:${m[2]}:00.000+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function acaraAgenda(a: AgendaKalender, asal: string): AcaraIcs {
  const url = tautanHari(asal, a.tanggal, a.id);
  const waktu = waktuAgenda(a.tanggal, a.jam);
  return {
    uid: uid("agenda", a.id),
    ringkasan: `${a.selesai ? "✓ " : ""}${a.judul}`,
    keterangan: keterangan(
      [
        `Agenda · ${LABEL_JENIS_AGENDA[a.jenis] ?? a.jenis}`,
        ...a.checklist.map((c) => `${c.selesai ? "☑" : "☐"} ${c.teks}`),
        a.catatan,
        a.campaignNama ? `Campaign: ${a.campaignNama}` : null,
        a.kolNama ? `KOL: ${a.kolNama}` : null,
        a.kolaborasiDocNo ? `Kolaborasi: ${a.kolaborasiDocNo}` : null,
      ],
      url,
    ),
    url,
    mulai: waktu ? { waktu } : { tanggal: a.tanggal },
    kategori: "Agenda",
  };
}

/** Isi `kalenderKreatif` → acara kalender langganan. `asal` = origin untuk tautan "Buka di Elorae". */
export function acaraKalenderKreatif(data: KalenderKreatif, o: { asal: string }): AcaraIcs[] {
  const hasil: AcaraIcs[] = [];
  for (const [tanggal, h] of Object.entries(data.hari)) {
    for (const g of h.tenggat) {
      hasil.push(...acaraGrup("tenggat", tanggal, g, LABEL_TENGGAT[g.jenis] ?? g.jenis, TAB_TENGGAT[g.jenis], rupiah, o.asal));
    }
    for (const g of h.kejadian) {
      const nilai = g.jenis === "TAYANG" ? (n: number) => `${angkaTitik(n)} views` : rupiah;
      hasil.push(...acaraGrup("kejadian", tanggal, g, LABEL_KEJADIAN[g.jenis] ?? g.jenis, TAB_KEJADIAN[g.jenis], nilai, o.asal));
    }
    for (const a of h.agenda) hasil.push(acaraAgenda(a, o.asal));
  }
  return hasil;
}
