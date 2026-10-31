/**
 * "Hari ini" Ruang KOL — 15 kelompok tugas, murni dan aman untuk klien.
 *
 * Menerima baris yang sudah dibaca (kolaborasi, agenda, campaign, dan —
 * sejak pantau KOL 2026-10-08 — anomali akun serta perangkat pemantau) dan
 * mengembalikan kelompok {kunci, jumlah, baris[]} dalam urutan tetap, baris
 * diurut dari yang paling lama menunggu. Kelompok bernilai nol TETAP
 * dikembalikan; layar yang memutuskan menyembunyikannya.
 *
 * Tenggatnya tidak dihitung ulang di sini: kelompok yang berbasis waktu
 * memakai `tenggatKolaborasi`, jadi kalender dan Hari ini tidak bisa berbeda
 * pendapat soal kapan sesuatu terlambat.
 */

import type { AmbangKreatif } from "./ambang";
import { keadaanBudget } from "./angka-konten";
import type { PerubahanAnomali } from "./pantau-anomali";
import { tahapAktif, type StatusBayar, type StatusDraf, type Tahap } from "./tahap";
import { tenggatKolaborasi, umurHari, type JenisTenggat, type PengirimanTenggat, type Tenggat, type TerminTenggat } from "./tenggat";

export type KunciTugas =
  | "AGENDA"
  | "DEAL_BELUM_KIRIM"
  | "RESI_NYANGKUT"
  | "DITERIMA_BELUM_TAYANG"
  | "DRAF_MENUNGGU"
  | "JADWAL_TAYANG_LEWAT"
  | "BELUM_DIBALAS"
  | "ANGKA_BELUM_ADA"
  | "BELUM_DIBAYAR"
  | "KIRIM_DOBEL"
  | "DATA_KIRIM_KURANG"
  | "DATA_DARI_KOL"
  | "KOL_DIBLOKIR"
  | "BUDGET_CAMPAIGN"
  | "ANOMALI_AKUN"
  | "PERANGKAT_BERHENTI";

export const URUTAN_TUGAS: readonly KunciTugas[] = [
  "AGENDA",
  "DEAL_BELUM_KIRIM",
  "RESI_NYANGKUT",
  "DITERIMA_BELUM_TAYANG",
  "DRAF_MENUNGGU",
  "JADWAL_TAYANG_LEWAT",
  "BELUM_DIBALAS",
  "ANGKA_BELUM_ADA",
  "BELUM_DIBAYAR",
  "KIRIM_DOBEL",
  "DATA_KIRIM_KURANG",
  "DATA_DARI_KOL",
  "KOL_DIBLOKIR",
  "BUDGET_CAMPAIGN",
  "ANOMALI_AKUN",
  "PERANGKAT_BERHENTI",
];

/**
 * Judul bahasa Indonesia untuk teks yang dibuat mesin (rekap). Layar memakai
 * i18n `kreatifRuang.tugas.<KUNCI>`.
 */
export const JUDUL_TUGAS: Record<KunciTugas, string> = {
  AGENDA: "Agenda hari ini & yang terlewat",
  DEAL_BELUM_KIRIM: "Sudah deal tapi sampel belum dikirim",
  RESI_NYANGKUT: "Sampel dikirim tapi belum diterima",
  DITERIMA_BELUM_TAYANG: "Sampel diterima tapi belum tayang",
  DRAF_MENUNGGU: "Draf menunggu review",
  JADWAL_TAYANG_LEWAT: "Jadwal tayang lewat, konten belum ada",
  BELUM_DIBALAS: "Belum dibalas, perlu follow-up",
  ANGKA_BELUM_ADA: "Sudah tayang tapi angka belum diisi",
  BELUM_DIBAYAR: "Termin jatuh tempo, belum dibayar",
  KIRIM_DOBEL: "Berpotensi kirim dobel",
  DATA_KIRIM_KURANG: "Data kirim belum lengkap",
  DATA_DARI_KOL: "Data dari KOL, belum dicek",
  KOL_DIBLOKIR: "KOL diblokir tapi kolaborasinya berjalan",
  BUDGET_CAMPAIGN: "Budget campaign hampir habis atau lewat",
  ANOMALI_AKUN: "Anomali akun",
  PERANGKAT_BERHENTI: "Perangkat pemantau berhenti",
};

export type PengirimanTugas = PengirimanTenggat & { courier?: string | null };

export type KontenTugas = {
  id: string;
  link: string | null;
  liveAt: string | null;
  plannedAt: string | null;
  draftStatus: StatusDraf | null;
  draftAt: string | null;
  draftLink: string | null;
  angkaTerakhirHari: string | null;
};

/** Satu kolaborasi, sudah dibaca dan tanggalnya hari WIB "YYYY-MM-DD". */
export type KolaborasiTugas = {
  id: string;
  docNo: string;
  kolId: string;
  kolNama: string;
  kolHandle: string | null;
  platform: string | null;
  /** `Kol.waNormal`. */
  waNormal: string | null;
  /** `Kol.address`. */
  alamat: string | null;
  /** `Kol.sizeProfile` terisi. */
  ukuranAda: boolean;
  /** `Kol.blockedAt` terisi. */
  kolDiblokir: boolean;
  campaignId: string | null;
  tahap: Tahap;
  tahapAt: string;
  dealAt: string | null;
  lastContactAt: string | null;
  plannedLiveAt: string | null;
  liveAt: string | null;
  fee: number;
  payStatus: StatusBayar;
  pengiriman: PengirimanTugas[];
  konten: KontenTugas[];
  /** Termin pembayaran; jumlah dalam basis fee. Tanpa termin: tenggat bayar cara lama. */
  termin?: (TerminTenggat & { jumlah: number })[];
};

export type AgendaTugas = {
  id: string;
  title: string;
  date: string;
  time: string | null;
  remindDaysBefore: number;
  doneAt: string | null;
  /** Banyak butir persiapan yang belum dicentang. */
  checklistBelum: number;
};

export type CampaignTugas = { id: string; name: string; budget: number | null; terpakai: number; archivedAt: string | null };

/** Akun TikTok yang catatan terbarunya anomali (`cekAnomaliAkun`, keputusan P6). */
export type AnomaliTugas = {
  akunId: string;
  kolId: string;
  kolNama: string;
  handle: string;
  /** Hari WIB catatan terbaru. */
  hari: string;
  pengikut: PerubahanAnomali | null;
  er: PerubahanAnomali | null;
};

/** Perangkat pemantau yang dijeda otomatis (captcha, login, gagal beruntun) atau lama tidak melapor. */
export type PerangkatTugas = {
  id: string;
  nama: string;
  /** Hari WIB sejak berhenti. */
  sejak: string;
  alasan: "CAPTCHA" | "LOGIN" | "GAGAL_BERUNTUN" | "DIBLOKIR_TIKTOK" | "TIDAK_LAPOR";
  /** Jeda otomatis berakhir (ISO); null untuk yang tidak melapor. */
  sampai: string | null;
};

/** Kiriman formulir data KOL (link WhatsApp) yang belum ditandai dicek kantor. */
export type FormulirTugas = {
  id: string;
  kolId: string;
  kolNama: string;
  handle: string | null;
  waNormal: string | null;
  /** Hari WIB kiriman masuk. */
  hari: string;
  jumlahKolom: number;
  menimpa: number;
  npwpBaru: boolean;
};

export type KurangDataKirim = "ALAMAT" | "HP" | "UKURAN";

/**
 * Data kirim yang masih kosong — SATU aturan untuk tugas "Data kirim belum
 * lengkap" di Hari ini dan kartu alamat di rincian kolaborasi, supaya
 * keduanya menyebut kolom yang sama (audit ulang 2026-10-08).
 */
export function kurangDataKirim(c: { alamat: string | null | undefined; waNormal: string | null | undefined; ukuranAda: boolean }): KurangDataKirim[] {
  const kurang: KurangDataKirim[] = [];
  if (!c.alamat?.trim()) kurang.push("ALAMAT");
  if (!c.waNormal?.trim()) kurang.push("HP");
  if (!c.ukuranAda) kurang.push("UKURAN");
  return kurang;
}

/** Keterangan per baris; kunci yang terisi bergantung kelompoknya. */
export type InfoTugas = {
  /** Id pengiriman/konten sumber tenggatnya. */
  refId?: string | null;
  resi?: string | null;
  kurir?: string | null;
  /** Tanggal tenggat/rencana (hari WIB). */
  tanggal?: string | null;
  link?: string | null;
  draftLink?: string | null;
  titik?: Extract<JenisTenggat, "ANGKA_H3" | "ANGKA_H7">;
  kurang?: KurangDataKirim[];
  dobelDengan?: { id: string; kolNama: string; docNo: string }[];
  jam?: string | null;
  adaPersiapanBelum?: boolean;
  persen?: number | null;
  lewatBudget?: boolean;
  sisa?: number | null;
  fee?: number;
  /** `fee` adalah jumlah SATU termin (basis fee), bukan fee kolaborasi utuh — ditulis "Termin …". */
  feeTermin?: boolean;
  /** Anomali akun: perubahan pengikut dan/atau ER. */
  anomali?: { pengikut: PerubahanAnomali | null; er: PerubahanAnomali | null };
  /** Perangkat pemantau: kenapa berhenti, dan sampai kapan jeda otomatisnya. */
  alasanJeda?: PerangkatTugas["alasan"];
  sampai?: string | null;
  /** Kiriman formulir data KOL: berapa kolom diisi, berapa menimpa isian kantor, NPWP baru. */
  formulir?: { jumlahKolom: number; menimpa: number; npwpBaru: boolean };
};

export type BarisTugas = {
  jenis: "KOLABORASI" | "AGENDA" | "CAMPAIGN" | "AKUN" | "PERANGKAT" | "FORMULIR";
  /** Id yang dibuka: kolaborasi, agenda, campaign, akun KOL, perangkat pemantau, atau kiriman formulir. */
  id: string;
  /** Nama KOL, judul agenda, atau nama campaign. */
  judul: string;
  /** Handle KOL atau nomor dokumen. */
  sub: string | null;
  kolId: string | null;
  docNo: string | null;
  waNormal: string | null;
  platform: string | null;
  tahap: Tahap | null;
  /** Hari WIB jam hitungnya mulai. */
  sejak: string;
  /** Hari sejak `sejak`; negatif untuk agenda yang akan datang ("H-n"). */
  umurHari: number;
  saranGhosting: boolean;
  info: InfoTugas;
};

export type KelompokTugas = { kunci: KunciTugas; jumlah: number; baris: BarisTugas[] };

export type MasukanTugas = {
  kolaborasi: readonly KolaborasiTugas[];
  /** Agenda yang mau ditampilkan — biasanya milik orang yang melihat. */
  agenda: readonly AgendaTugas[];
  campaign: readonly CampaignTugas[];
  /** Anomali akun dari pantau KOL; kosong bila tidak dibaca. */
  anomali?: readonly AnomaliTugas[];
  /** Perangkat pemantau yang berhenti; kosong bila tidak dibaca. */
  perangkat?: readonly PerangkatTugas[];
  /** Kiriman formulir data KOL yang belum dicek; kosong bila tidak dibaca. */
  formulir?: readonly FormulirTugas[];
  hariIni: string;
  ambang: AmbangKreatif;
};

const TAHAP_SEBELUM_KIRIM: ReadonlySet<Tahap> = new Set(["DEAL", "BRIEF_DIKIRIM"]);
const TAHAP_RAWAN_DOBEL: ReadonlySet<Tahap> = new Set(["DEAL", "BRIEF_DIKIRIM", "SAMPEL_DIKIRIM"]);

const berangkat = (p: PengirimanTenggat) => Boolean(p.sentAt) || Boolean(p.trackingNo?.trim());

function barisKolaborasi(c: KolaborasiTugas, sejak: string, hariIni: string, info: InfoTugas = {}): BarisTugas {
  return {
    jenis: "KOLABORASI",
    id: c.id,
    judul: c.kolNama,
    sub: c.kolHandle,
    kolId: c.kolId,
    docNo: c.docNo,
    waNormal: c.waNormal,
    platform: c.platform,
    tahap: c.tahap,
    sejak,
    umurHari: umurHari(sejak, hariIni),
    saranGhosting: false,
    info,
  };
}

const lebihLama = (a: BarisTugas, b: BarisTugas) => b.umurHari - a.umurHari || a.judul.localeCompare(b.judul) || a.id.localeCompare(b.id);

export function susunTugas(m: MasukanTugas): KelompokTugas[] {
  const isi = new Map<KunciTugas, BarisTugas[]>(URUTAN_TUGAS.map((k) => [k, []]));
  const tambah = (k: KunciTugas, b: BarisTugas) => isi.get(k)!.push(b);

  for (const a of m.agenda) {
    if (a.doneAt) continue;
    const umur = umurHari(a.date, m.hariIni);
    if (-umur > Math.max(0, a.remindDaysBefore)) continue;
    tambah("AGENDA", {
      jenis: "AGENDA",
      id: a.id,
      judul: a.title,
      sub: a.time,
      kolId: null,
      docNo: null,
      waNormal: null,
      platform: null,
      tahap: null,
      sejak: a.date,
      umurHari: umur,
      saranGhosting: false,
      info: { tanggal: a.date, jam: a.time, adaPersiapanBelum: a.checklistBelum > 0 },
    });
  }

  // Sudah berangkat: dipakai untuk mencari kiriman dobel.
  const terkirim = m.kolaborasi.filter((c) => c.pengiriman.some(berangkat));

  for (const c of m.kolaborasi) {
    const tenggat = tenggatKolaborasi(c, m.ambang, m.hariIni);
    const lewat = (jenis: JenisTenggat): Tenggat | undefined => tenggat.find((t) => t.jenis === jenis && t.lewat);

    const kirim = lewat("KIRIM_SAMPEL");
    if (kirim) tambah("DEAL_BELUM_KIRIM", barisKolaborasi(c, kirim.sejak, m.hariIni, { tanggal: kirim.tanggal }));

    const resi = lewat("RESI_NYANGKUT");
    if (resi) {
      const p = c.pengiriman.find((x) => x.id === resi.refId);
      tambah(
        "RESI_NYANGKUT",
        barisKolaborasi(c, resi.sejak, m.hariIni, { refId: resi.refId, resi: p?.trackingNo ?? null, kurir: p?.courier ?? null, tanggal: resi.tanggal }),
      );
    }

    const tayang = lewat("BATAS_TAYANG");
    if (tayang) tambah("DITERIMA_BELUM_TAYANG", barisKolaborasi(c, tayang.sejak, m.hariIni, { tanggal: tayang.tanggal }));

    const draf = lewat("REVIEW_DRAF");
    if (draf) {
      const k = c.konten.find((x) => x.id === draf.refId);
      tambah("DRAF_MENUNGGU", barisKolaborasi(c, draf.sejak, m.hariIni, { refId: draf.refId, draftLink: k?.draftLink ?? null, tanggal: draf.tanggal }));
    }

    if (tahapAktif(c.tahap)) {
      const adaLink = c.konten.some((k) => Boolean(k.link?.trim()));
      const rencana = c.konten
        .filter((k) => !k.link?.trim() && k.plannedAt && k.plannedAt < m.hariIni)
        .map((k) => ({ tanggal: k.plannedAt!, refId: k.id }))
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal))[0];
      const rencanaKolaborasi =
        !rencana && !adaLink && !c.konten.some((k) => k.plannedAt) && c.plannedLiveAt && c.plannedLiveAt < m.hariIni
          ? { tanggal: c.plannedLiveAt, refId: null }
          : null;
      const r = rencana ?? rencanaKolaborasi;
      if (r) tambah("JADWAL_TAYANG_LEWAT", barisKolaborasi(c, r.tanggal, m.hariIni, { refId: r.refId, tanggal: r.tanggal }));
    }

    const balas = lewat("FOLLOW_UP");
    if (balas) {
      const b = barisKolaborasi(c, balas.sejak, m.hariIni, { tanggal: balas.tanggal });
      b.saranGhosting = b.umurHari > m.ambang.saranGhostingHari;
      tambah("BELUM_DIBALAS", b);
    }

    const angka = tenggat.filter((t) => t.lewat && (t.jenis === "ANGKA_H3" || t.jenis === "ANGKA_H7")).at(-1);
    if (angka) {
      const k = c.konten.find((x) => x.id === angka.refId);
      tambah(
        "ANGKA_BELUM_ADA",
        barisKolaborasi(c, angka.sejak, m.hariIni, {
          refId: angka.refId,
          titik: angka.jenis as "ANGKA_H3" | "ANGKA_H7",
          link: k?.link ?? null,
          tanggal: angka.tanggal,
        }),
      );
    }

    const bayar = lewat("JATUH_TEMPO_BAYAR");
    if (bayar) {
      const termin = c.termin?.find((t) => t.id === bayar.refId);
      tambah("BELUM_DIBAYAR", barisKolaborasi(c, bayar.sejak, m.hariIni, { tanggal: bayar.tanggal, fee: termin ? termin.jumlah : c.fee, ...(termin ? { feeTermin: true } : {}) }));
    }

    if (TAHAP_RAWAN_DOBEL.has(c.tahap)) {
      const dobel = terkirim.filter(
        (o) =>
          o.id !== c.id &&
          ((o.kolId === c.kolId && o.campaignId === c.campaignId) || (c.waNormal !== null && o.kolId !== c.kolId && o.waNormal === c.waNormal)),
      );
      if (dobel.length) {
        tambah(
          "KIRIM_DOBEL",
          barisKolaborasi(c, c.dealAt ?? c.tahapAt, m.hariIni, {
            dobelDengan: dobel.map((o) => ({ id: o.id, kolNama: o.kolNama, docNo: o.docNo })),
          }),
        );
      }
    }

    if (TAHAP_SEBELUM_KIRIM.has(c.tahap) && !c.pengiriman.some(berangkat)) {
      const kurang = kurangDataKirim(c);
      if (kurang.length) tambah("DATA_KIRIM_KURANG", barisKolaborasi(c, c.dealAt ?? c.tahapAt, m.hariIni, { kurang }));
    }

    if (c.kolDiblokir && tahapAktif(c.tahap)) tambah("KOL_DIBLOKIR", barisKolaborasi(c, c.tahapAt, m.hariIni));
  }

  const budget: BarisTugas[] = [];
  for (const cp of m.campaign) {
    if (cp.archivedAt) continue;
    const b = keadaanBudget(cp.terpakai, cp.budget);
    if (b.keadaan !== "HAMPIR" && b.keadaan !== "LEWAT") continue;
    budget.push({
      jenis: "CAMPAIGN",
      id: cp.id,
      judul: cp.name,
      sub: null,
      kolId: null,
      docNo: null,
      waNormal: null,
      platform: null,
      tahap: null,
      sejak: m.hariIni,
      umurHari: 0,
      saranGhosting: false,
      info: { persen: b.persen, lewatBudget: b.keadaan === "LEWAT", sisa: b.sisa },
    });
  }

  for (const a of m.anomali ?? []) {
    tambah("ANOMALI_AKUN", {
      jenis: "AKUN",
      id: a.akunId,
      judul: a.kolNama,
      sub: a.handle,
      kolId: a.kolId,
      docNo: null,
      waNormal: null,
      platform: "TIKTOK",
      tahap: null,
      sejak: a.hari,
      umurHari: umurHari(a.hari, m.hariIni),
      saranGhosting: false,
      info: { anomali: { pengikut: a.pengikut, er: a.er } },
    });
  }

  for (const p of m.perangkat ?? []) {
    tambah("PERANGKAT_BERHENTI", {
      jenis: "PERANGKAT",
      id: p.id,
      judul: p.nama,
      sub: null,
      kolId: null,
      docNo: null,
      waNormal: null,
      platform: null,
      tahap: null,
      sejak: p.sejak,
      umurHari: umurHari(p.sejak, m.hariIni),
      saranGhosting: false,
      info: { alasanJeda: p.alasan, sampai: p.sampai },
    });
  }

  for (const f of m.formulir ?? []) {
    tambah("DATA_DARI_KOL", {
      jenis: "FORMULIR",
      id: f.id,
      judul: f.kolNama,
      sub: f.handle,
      kolId: f.kolId,
      docNo: null,
      waNormal: f.waNormal,
      platform: null,
      tahap: null,
      sejak: f.hari,
      umurHari: umurHari(f.hari, m.hariIni),
      saranGhosting: false,
      info: { formulir: { jumlahKolom: f.jumlahKolom, menimpa: f.menimpa, npwpBaru: f.npwpBaru } },
    });
  }

  return URUTAN_TUGAS.map((kunci) => {
    const baris =
      kunci === "BUDGET_CAMPAIGN"
        ? budget.sort((a, b) => (b.info.persen ?? 0) - (a.info.persen ?? 0) || a.judul.localeCompare(b.judul))
        : isi.get(kunci)!.sort(lebihLama);
    return { kunci, jumlah: baris.length, baris };
  });
}

/** Total untuk lencana di tab/menu. */
export function jumlahTugas(kelompok: readonly KelompokTugas[]): number {
  return kelompok.reduce((s, k) => s + k.jumlah, 0);
}
