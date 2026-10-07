/**
 * "Hari ini" Ruang KOL — 13 kelompok tugas, murni dan aman untuk klien.
 *
 * Menerima baris yang sudah dibaca (kolaborasi, agenda, campaign) dan
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
import { tahapAktif, type StatusBayar, type StatusDraf, type Tahap } from "./tahap";
import { tenggatKolaborasi, umurHari, type JenisTenggat, type PengirimanTenggat, type Tenggat } from "./tenggat";

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
  | "KOL_DIBLOKIR"
  | "BUDGET_CAMPAIGN";

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
  "KOL_DIBLOKIR",
  "BUDGET_CAMPAIGN",
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
  BELUM_DIBAYAR: "Sudah tayang tapi belum dibayar",
  KIRIM_DOBEL: "Berpotensi kirim dobel",
  DATA_KIRIM_KURANG: "Data kirim belum lengkap",
  KOL_DIBLOKIR: "KOL diblokir tapi kolaborasinya berjalan",
  BUDGET_CAMPAIGN: "Budget campaign hampir habis atau lewat",
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

export type KurangDataKirim = "ALAMAT" | "HP" | "UKURAN";

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
};

export type BarisTugas = {
  jenis: "KOLABORASI" | "AGENDA" | "CAMPAIGN";
  /** Id yang dibuka: kolaborasi, agenda, atau campaign. */
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
    if (bayar) tambah("BELUM_DIBAYAR", barisKolaborasi(c, bayar.sejak, m.hariIni, { tanggal: bayar.tanggal, fee: c.fee }));

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
      const kurang: KurangDataKirim[] = [];
      if (!c.alamat?.trim()) kurang.push("ALAMAT");
      if (!c.waNormal) kurang.push("HP");
      if (!c.ukuranAda) kurang.push("UKURAN");
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
