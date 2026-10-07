import { pindahkan } from "@/lib/gerak/seret-urut";
import { computeStepDays } from "@/lib/leadtime/calculations";
import { jumlahHariKerja, kalenderKerja, type KalenderKerja } from "@/lib/production/hari-kerja";
import { mulaiDariTenggat, susunTanggal, totalHariJadwal, type StatusLangkah } from "@/lib/production/jadwal";
import { DURASI_MAKS_HARI, NAMA_LANGKAH_MAKS } from "@/lib/production/jadwal-jejak";
import type { LangkahRuangKerja, RuangKerjaTahap, SumberLeadTime } from "@/lib/production/jadwal-queries";
import { bacaTanggal, jumlahHari, labelTanggal } from "@/lib/tanggal-isian";

/*
 * Ruang kerja tahap — logika murni layar (2026-10-07).
 *
 * Pratinjau tanggal di dialog dihitung di peramban dengan pustaka yang SAMA
 * dengan penulis (`susunTanggal`, `mulaiDariTenggat`, `computeStepDays`, kalender
 * kerja dari server), jadi tanggal yang dilihat sebelum menyimpan = tanggal
 * yang ditulis. Aturan pratinjau mengikuti `tarikJadwalDariLeadTime` dan
 * `aturMulaiJadwal` (lib/production/jadwal-writer.ts) baris demi baris; kalau
 * salah satunya berubah, ubah keduanya.
 *
 * `jadwal-queries.ts` membawa Prisma: berkas ini hanya mengimpor TIPE-nya.
 */

export type ModeJadwal = "MAJU" | "MUNDUR";
export type CaraTarik = "TAMBAH" | "GANTI";

/** Kalender kerja dari data ruang kerja (nama libur tidak dipakai untuk menghitung). */
export function kalenderDariData(data: Pick<RuangKerjaTahap, "hariKerja" | "tanggalMerah">): KalenderKerja {
  return kalenderKerja(
    data.hariKerja,
    data.tanggalMerah.map((tanggal) => ({ tanggal, nama: "" })),
  );
}

/** Sama dengan penjaga penulis: tanggal yang benar-benar ada, tahun 2000–2100. */
export function tanggalJadwalSah(teks: string | null | undefined): teks is string {
  const b = bacaTanggal(teks);
  return !!b && b.tahun >= 2000 && b.tahun <= 2100;
}

// ─── Pilihan pemasok di dialog "Tarik dari Lead Time" ──────────────────────

/** Satu pemasok dalam urutan rantai, dengan langkah yang dicentang (`SupplierProcess.sequence`). */
export type PilihanPemasok = { supplierId: string; sequences: number[] };

/** Tambah pemasok di AKHIR urutan, semua langkahnya tercentang. Pemasok yang sudah ada tidak digandakan. */
export function tambahPemasok(pilihan: readonly PilihanPemasok[], sumber: readonly SumberLeadTime[], supplierId: string): PilihanPemasok[] {
  if (pilihan.some((p) => p.supplierId === supplierId)) return [...pilihan];
  const s = sumber.find((x) => x.supplierId === supplierId);
  if (!s) return [...pilihan];
  return [...pilihan, { supplierId, sequences: s.langkah.map((l) => l.sequence) }];
}

export function hapusPemasok(pilihan: readonly PilihanPemasok[], supplierId: string): PilihanPemasok[] {
  return pilihan.filter((p) => p.supplierId !== supplierId);
}

/** Geser pemasok satu posisi dalam urutan rantai. Di ujung: tidak berubah. */
export function geserPemasok(pilihan: readonly PilihanPemasok[], supplierId: string, arah: -1 | 1): PilihanPemasok[] {
  const hasil = [...pilihan];
  const i = hasil.findIndex((p) => p.supplierId === supplierId);
  const j = i + arah;
  if (i < 0 || j < 0 || j >= hasil.length) return hasil;
  [hasil[i], hasil[j]] = [hasil[j], hasil[i]];
  return hasil;
}

export function centangLangkah(
  pilihan: readonly PilihanPemasok[],
  supplierId: string,
  sequence: number,
  dicentang: boolean,
): PilihanPemasok[] {
  return pilihan.map((p) => {
    if (p.supplierId !== supplierId) return p;
    const tanpa = p.sequences.filter((s) => s !== sequence);
    return { ...p, sequences: dicentang ? [...tanpa, sequence] : tanpa };
  });
}

/**
 * Pilihan → masukan `tarikJadwalAction`: pemasok sesuai urutan pilihan, langkah
 * tiap pemasok sesuai urutan rantainya (bukan urutan dicentang). Pemasok atau
 * langkah yang tidak ada di sumber dilewati.
 */
export function langkahTerpilih(
  pilihan: readonly PilihanPemasok[],
  sumber: readonly SumberLeadTime[],
): { supplierId: string; sequence: number }[] {
  return pilihan.flatMap((p) => {
    const s = sumber.find((x) => x.supplierId === p.supplierId);
    if (!s) return [];
    const centang = new Set(p.sequences);
    return s.langkah.filter((l) => centang.has(l.sequence)).map((l) => ({ supplierId: p.supplierId, sequence: l.sequence }));
  });
}

/** Lama satu langkah Lead Time untuk qty tahap — persis yang dihitung penulis. */
export function hariLangkahUntukQty(l: SumberLeadTime["langkah"][number], targetQty: number): number {
  return Math.min(
    DURASI_MAKS_HARI,
    computeStepDays({ seq: l.sequence, name: l.name, type: l.type, days: l.days, rateQty: l.rateQty }, targetQty),
  );
}

/**
 * Isian awal dialog tarik: tahap yang punya tenggat disusun mundur dari
 * tenggat itu; selain itu maju dari tanggal mulai tahap (atau hari ini).
 * Penjahit tahap yang punya rantai Lead Time langsung terpilih bila jadwal
 * masih kosong — itu rantai yang hampir selalu dipakai.
 */
export function isianAwalTarik(data: Pick<RuangKerjaTahap, "tahap" | "langkah" | "sumberLeadTime" | "hariIni">): {
  mode: ModeJadwal;
  tanggal: string;
  cara: CaraTarik;
  pilihan: PilihanPemasok[];
} {
  const { tahap } = data;
  const mode: ModeJadwal = tahap.deadline ? "MUNDUR" : "MAJU";
  const tanggal = tahap.deadline ?? tahap.scheduleStart ?? data.hariIni;
  const penjahit = tahap.penjahit?.id;
  const pilihan =
    data.langkah.length === 0 && penjahit ? tambahPemasok([], data.sumberLeadTime, penjahit) : [];
  return { mode, tanggal, cara: "TAMBAH", pilihan };
}

/** GANTI hanya boleh bila semua langkah lama masih BELUM (penulis: `ADA_LANGKAH_BERJALAN`). */
export function bolehGanti(langkah: readonly Pick<LangkahRuangKerja, "status">[]): boolean {
  return langkah.every((l) => l.status === "BELUM");
}

// ─── Pratinjau ──────────────────────────────────────────────────────────────

export type BarisPratinjau = {
  kunci: string;
  name: string;
  pemasok: string | null;
  durationDays: number;
  targetDate: string;
  status: StatusLangkah;
  /** Langkah yang akan dibuat oleh tarikan ini. */
  baru: boolean;
};

export type HasilPratinjau =
  | {
      ok: true;
      baris: BarisPratinjau[];
      mulai: string;
      tenggat: string | null;
      selesaiPada: string | null;
      totalHari: number;
      jumlahBaru: number;
      /**
       * MAJU + TAMBAH ke jadwal yang sudah berisi: langkah baru menyambung di
       * akhir dan tanggal mulai lama tetap — tanggal yang dipilih tidak dipakai.
       */
      menyambung: boolean;
      /** Tanggal yang dikirim ke server (saat menyambung = tanggal mulai lama, supaya lolos validasi). */
      tanggalKirim: string;
    }
  | { ok: false; code: "TANGGAL_TIDAK_SAH" | "TANPA_LANGKAH_LEAD_TIME" | "ADA_LANGKAH_BERJALAN" };

type LangkahLama = Pick<LangkahRuangKerja, "id" | "name" | "durationDays" | "status" | "doneDate" | "pemasok">;

export function pratinjauTarik(masukan: {
  langkahLama: readonly LangkahLama[];
  scheduleStart: string | null;
  deadline: string | null;
  targetQty: number;
  sumber: readonly SumberLeadTime[];
  pilihan: readonly PilihanPemasok[];
  mode: ModeJadwal;
  tanggal: string;
  cara: CaraTarik;
  kal: KalenderKerja;
}): HasilPratinjau {
  const { langkahLama, scheduleStart, targetQty, sumber, pilihan, mode, cara, kal } = masukan;
  const tersisaAwal = cara === "GANTI" ? [] : langkahLama;
  const menyambung = mode === "MAJU" && cara === "TAMBAH" && tersisaAwal.length > 0 && !!scheduleStart;
  const tanggalKirim = menyambung && scheduleStart ? scheduleStart : masukan.tanggal;
  if (!tanggalJadwalSah(tanggalKirim)) return { ok: false, code: "TANGGAL_TIDAK_SAH" };

  const terpilih = langkahTerpilih(pilihan, sumber);
  if (terpilih.length === 0) return { ok: false, code: "TANPA_LANGKAH_LEAD_TIME" };
  if (cara === "GANTI" && !bolehGanti(langkahLama)) return { ok: false, code: "ADA_LANGKAH_BERJALAN" };

  const baru: BarisPratinjau[] = terpilih.map((t, i) => {
    const s = sumber.find((x) => x.supplierId === t.supplierId)!;
    const l = s.langkah.find((x) => x.sequence === t.sequence)!;
    return {
      kunci: `baru-${i}-${t.supplierId}-${t.sequence}`,
      name: l.name.slice(0, NAMA_LANGKAH_MAKS),
      pemasok: s.supplierName,
      durationDays: hariLangkahUntukQty(l, targetQty),
      targetDate: "",
      status: "BELUM",
      baru: true,
    };
  });
  const lama: BarisPratinjau[] = tersisaAwal.map((l) => ({
    kunci: l.id,
    name: l.name,
    pemasok: l.pemasok?.name ?? null,
    durationDays: l.durationDays,
    targetDate: "",
    status: l.status,
    baru: false,
  }));
  const semua = [...lama, ...baru];
  const doneLama = new Map(tersisaAwal.map((l) => [l.id, l.doneDate]));

  let mulai: string;
  let tenggat: string | null = masukan.deadline;
  if (mode === "MAJU") {
    if (menyambung && scheduleStart) {
      mulai = scheduleStart;
    } else {
      mulai = tanggalKirim;
      tenggat = null;
    }
  } else {
    tenggat = tanggalKirim;
    mulai = mulaiDariTenggat(totalHariJadwal(semua), tanggalKirim, kal);
  }

  const tanggal = susunTanggal(
    semua.map((b) => ({
      durationDays: b.durationDays,
      status: b.status,
      doneDate: b.baru ? null : (doneLama.get(b.kunci) ?? null),
    })),
    mulai,
    kal,
  );
  const baris = semua.map((b, i) => ({ ...b, targetDate: tanggal[i] }));
  return {
    ok: true,
    baris,
    mulai,
    tenggat,
    selesaiPada: baris.length > 0 ? baris[baris.length - 1].targetDate : null,
    totalHari: totalHariJadwal(semua),
    jumlahBaru: baru.length,
    menyambung,
    tanggalKirim,
  };
}

/** Pratinjau "Atur mulai" — sama dengan `aturMulaiJadwal`: semua langkah, mulai dari tanggal atau dari tenggat. */
export function pratinjauMulai(masukan: {
  langkah: readonly Pick<LangkahRuangKerja, "durationDays" | "status" | "doneDate">[];
  mode: ModeJadwal;
  tanggal: string;
  kal: KalenderKerja;
}): { ok: true; mulai: string; tenggat: string | null; selesaiPada: string | null; target: string[] } | { ok: false } {
  const { langkah, mode, tanggal, kal } = masukan;
  if (!tanggalJadwalSah(tanggal)) return { ok: false };
  const mulai = mode === "MAJU" ? tanggal : mulaiDariTenggat(totalHariJadwal(langkah), tanggal, kal);
  const susun = susunTanggal(langkah, mulai, kal);
  return { ok: true, mulai, tenggat: mode === "MUNDUR" ? tanggal : null, selesaiPada: susun.at(-1) ?? null, target: susun };
}

export type PeringatanJadwal =
  | { jenis: "LEWAT_TENGGAT"; selesai: string; hari: number }
  | { jenis: "MULAI_LEWAT"; langkah: string; mulai: string; hari: number };

/**
 * Peringatan sebelum menyimpan jadwal (dipakai mode mundur):
 *  - LEWAT_TENGGAT: perkiraan selesai jatuh sesudah tenggat — terjadi bila
 *    langkah yang sudah selesai berjangkar lebih lambat dari rencana;
 *  - MULAI_LEWAT: langkah pertama yang belum selesai seharusnya sudah mulai
 *    (mulai = target langkah sebelumnya, atau mulai tahap) sebelum hari ini.
 * Langkah yang sudah selesai tidak pernah dihitung terlambat.
 */
export function peringatanJadwal(masukan: {
  langkah: readonly { name: string; status: StatusLangkah; targetDate: string }[];
  mulai: string;
  tenggat: string | null;
  hariIni: string;
  kal: KalenderKerja;
}): PeringatanJadwal | null {
  const { langkah, mulai, tenggat, hariIni, kal } = masukan;
  const selesai = langkah.at(-1)?.targetDate ?? null;
  if (tenggat && tanggalJadwalSah(tenggat) && selesai && tanggalJadwalSah(selesai) && selesai > tenggat) {
    return { jenis: "LEWAT_TENGGAT", selesai, hari: jumlahHariKerja(tenggat, selesai, kal) };
  }
  const i = langkah.findIndex((l) => l.status !== "SELESAI");
  if (i < 0) return null;
  const awal = i === 0 ? mulai : langkah[i - 1].targetDate;
  if (!tanggalJadwalSah(awal) || !tanggalJadwalSah(hariIni) || awal >= hariIni) return null;
  return { jenis: "MULAI_LEWAT", langkah: langkah[i].name, mulai: awal, hari: jumlahHariKerja(awal, hariIni, kal) };
}

/**
 * Akibat mengubah status satu langkah pada perkiraan selesai tahap — dihitung
 * seperti `susunUlangTahap` sesudah `ubahStatusLangkah` (SELESAI berjangkar pada
 * tanggal selesai sebenarnya; BELUM/PROSES mengosongkannya).
 */
export function pratinjauStatus(masukan: {
  langkah: readonly Pick<LangkahRuangKerja, "id" | "durationDays" | "status" | "doneDate">[];
  stepId: string;
  status: StatusLangkah;
  doneDate: string | null;
  mulai: string;
  kal: KalenderKerja;
}): { selesaiPadaLama: string | null; selesaiPadaBaru: string | null } {
  const { langkah, stepId, status, doneDate, mulai, kal } = masukan;
  const lama = susunTanggal(langkah, mulai, kal);
  const baru = susunTanggal(
    langkah.map((l) =>
      l.id === stepId ? { durationDays: l.durationDays, status, doneDate: status === "SELESAI" ? doneDate : null } : l,
    ),
    mulai,
    kal,
  );
  return { selesaiPadaLama: lama.at(-1) ?? null, selesaiPadaBaru: baru.at(-1) ?? null };
}

/**
 * Pratinjau seret-lepas di jadwal: urutan dan tanggal target bila langkah ke-`dari`
 * dipindah ke indeks `ke` — `susunTanggal` yang sama dengan `pindahLangkahKe`
 * (lib/production/jadwal-writer.ts), jadi tanggal yang tampil saat menyeret =
 * tanggal yang ditulis sesudah dilepas.
 */
export function pratinjauPindah(masukan: {
  langkah: readonly Pick<LangkahRuangKerja, "id" | "durationDays" | "status" | "doneDate">[];
  dari: number;
  ke: number;
  mulai: string;
  kal: KalenderKerja;
}): { urutan: string[]; target: Record<string, string>; selesaiPadaLama: string | null; selesaiPadaBaru: string | null } {
  const { langkah, dari, ke, mulai, kal } = masukan;
  const baru = pindahkan(langkah, dari, ke);
  const tanggalBaru = susunTanggal(baru, mulai, kal);
  const lama = susunTanggal(langkah, mulai, kal);
  return {
    urutan: baru.map((l) => l.id),
    target: Object.fromEntries(baru.map((l, i) => [l.id, tanggalBaru[i]])),
    selesaiPadaLama: lama.at(-1) ?? null,
    selesaiPadaBaru: tanggalBaru.at(-1) ?? null,
  };
}

// ─── Teks dan keadaan ───────────────────────────────────────────────────────

/** Hari kalender sesudah target (0 bila belum lewat). */
export function hariTerlambat(targetDate: string, hariIni: string): number {
  if (!bacaTanggal(targetDate) || !bacaTanggal(hariIni) || targetDate >= hariIni) return 0;
  return jumlahHari(targetDate, hariIni) - 1;
}

/**
 * Pesan WhatsApp ke pemasok — SELALU bahasa Indonesia (pemasoknya orang
 * Indonesia, apa pun bahasa layar penggunanya), sama bentuknya dengan pesan
 * di Follow-up produksi.
 */
export function pesanWaLangkah(masukan: { pemasok: string; langkah: string; tahap: string; targetDate: string }): string {
  const target = labelTanggal(masukan.targetDate, "id") || masukan.targetDate;
  return `Halo ${masukan.pemasok}, menanyakan proses ${masukan.langkah} untuk ${masukan.tahap} — target ${target}.`;
}

/** Tautan wa.me dengan pesan terisi. `wa` = "https://wa.me/<nomor>" dari server. */
export function tautanWaDenganPesan(wa: string, pesan: string): string {
  return `${wa}?text=${encodeURIComponent(pesan)}`;
}

/**
 * Bahan yang sudah di-PO dianggap PAS sampai 5% di atas kebutuhan — kain dan
 * aksesoris dibeli per roll/pak, jadi sedikit lebih adalah pembulatan biasa,
 * bukan salah beli.
 */
export const TOLERANSI_LEBIH_PERSEN = 5;

export type KeadaanKebutuhan = "KURANG" | "PAS" | "LEBIH";

/** Bandingkan yang sudah di-PO dengan kebutuhan (dua desimal). */
export function keadaanKebutuhan(butuh: number, diPo: number): { keadaan: KeadaanKebutuhan; selisih: number } {
  const b = Math.round(butuh * 100);
  const p = Math.round(diPo * 100);
  const selisih = (p - b) / 100;
  if (p < b) return { keadaan: "KURANG", selisih };
  if (p * 100 <= b * (100 + TOLERANSI_LEBIH_PERSEN)) return { keadaan: "PAS", selisih };
  return { keadaan: "LEBIH", selisih };
}

/**
 * Alasan "Buat WO" pasti ditolak, diperiksa dengan urutan yang sama dengan
 * `createWorkOrderFromStage` — tombolnya nonaktif dengan alasan itu. Barang
 * tanpa varian (`BARANG_TANPA_VARIAN`) tidak bisa dilihat dari sini; server
 * yang menolaknya.
 */
export function alasanTidakBisaBuatWo(
  tahap: Pick<RuangKerjaTahap["tahap"], "penjahit" | "barang" | "variantSku">,
): "TANPA_VENDOR" | "TANPA_BARANG_JADI" | "TAHAP_TANPA_VARIAN" | null {
  if (!tahap.penjahit) return "TANPA_VENDOR";
  if (!tahap.barang) return "TANPA_BARANG_JADI";
  if (!(tahap.variantSku ?? "").trim()) return "TAHAP_TANPA_VARIAN";
  return null;
}

/** WO yang dibatalkan tidak menghalangi WO baru (sama dengan server). */
export function bolehWoBaru(wo: RuangKerjaTahap["wo"]): boolean {
  return !wo || wo.status === "CANCELLED";
}

/** Isian lama langkah manual → bilangan bulat 0–3650, atau null bila tidak sah. */
export function bacaDurasi(teks: string): number | null {
  const t = teks.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= DURASI_MAKS_HARI ? n : null;
}

/** Status yang diusulkan saat pil diklik: langkah berikutnya dalam alur Belum → Proses → Selesai. */
export function statusUsulan(status: StatusLangkah): StatusLangkah {
  if (status === "BELUM") return "PROSES";
  return "SELESAI";
}

/** Judul tahap untuk pesan dan tautan: "{kode jenis} · {nama tahap}". */
export function labelTahapRuang(tahap: Pick<RuangKerjaTahap["tahap"], "name" | "kategori">): string {
  const kode = tahap.kategori.code.trim();
  return kode ? `${kode} · ${tahap.name}` : tahap.name;
}

const lokalTampil = (locale: string) => (locale.toLowerCase().startsWith("en") ? "en-GB" : "id-ID");

/**
 * Tanggal pendek "12 Nov"; tahunnya ikut bila bukan tahun `hariIni`
 * ("12 Nov 2027"). Diformat dari tengah hari UTC, jadi harinya tidak bergeser.
 */
export function labelPendek(teks: string | null | undefined, hariIni: string, locale: string): string {
  const b = bacaTanggal(teks);
  if (!b) return "";
  const tahunLain = String(b.tahun) !== hariIni.slice(0, 4);
  return new Intl.DateTimeFormat(lokalTampil(locale), {
    day: "numeric",
    month: "short",
    ...(tahunLain ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(b.tahun, b.bulan - 1, b.hari, 12)));
}

/** "Oktober 2026" untuk bulan target tahap; null bila bulan kosong/tidak sah. */
export function namaBulanTahun(bulan: number | null, tahun: number, locale: string): string | null {
  if (!bulan || !Number.isInteger(bulan) || bulan < 1 || bulan > 12) return null;
  return new Intl.DateTimeFormat(lokalTampil(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(tahun, bulan - 1, 15, 12)),
  );
}

/** Angka bahan/qty: paling banyak dua desimal, pemisah ribuan sesuai bahasa. */
export function angkaTampil(n: number, locale: string): string {
  return new Intl.NumberFormat(lokalTampil(locale), { maximumFractionDigits: 2 }).format(n);
}
