/**
 * Jadwal kerja dan shift SPG — aturan murni, tanpa basis data, supaya bisa
 * dites dan dipakai di layar kantor maupun HP.
 *
 * Satu baris `SpgShift` = satu SPG × satu hari WIB (`day` "YYYY-MM-DD", unik
 * per orang). `kind` KERJA membawa salinan jenis shiftnya (`shiftCode`,
 * `startTime`, `endTime`) yang DISALIN saat disimpan: jam shift yang diubah
 * pemilik di Pengaturan → SPG sesudahnya tidak menggeser jadwal yang sudah
 * tersusun. `kind` LIBUR = hari libur yang ditetapkan. Tidak ada baris = belum
 * dijadwalkan.
 *
 * Kantor menyusun jadwal per toko per minggu (Senin–Minggu WIB). Hari yang
 * sudah lewat tidak bisa diubah — jadwal hari lalu adalah dasar membaca
 * kenyataan (jam masuk, terlambat, tidak masuk). Hari ini masih boleh.
 *
 * Tukar shift: SPG mengajukan ke rekan setoko → rekan setuju → kantor
 * menyetujui. Yang ditukar adalah ISI SEL kedua orang di setiap hari yang
 * terlibat (hari pengaju, dan bila diisi, hari rekan yang ditukar balik).
 */

import { kunciHariWib } from "@/lib/dashboard/tren";
import { bacaMinggu, geserHari, hariKeMinggu, hariSeminggu, kunciHariSah, seninDari } from "@/lib/salesman/jadwal";
import type { AturanShift, JenisShift } from "./pengaturan";
import { shiftSah } from "./pengaturan";

export { bacaMinggu, geserHari, hariKeMinggu, hariSeminggu, kunciHariSah, seninDari };

// ─── Nama di jejak, notifikasi ───────────────────────────────────────────────

/** `AuditLog.action` — label di `auditActions.actions.<KODE>`. */
export const JEJAK_SHIFT = {
  /** Satu simpan jadwal satu toko; `entityId` = id toko, `changes` = daftar sel yang berubah. */
  DIUBAH: "SPG_SHIFT_UPDATED",
  TUKAR_DIAJUKAN: "SPG_SHIFT_SWAP_REQUESTED",
  TUKAR_DISETUJUI_REKAN: "SPG_SHIFT_SWAP_PARTNER_ACCEPTED",
  TUKAR_DITOLAK_REKAN: "SPG_SHIFT_SWAP_PARTNER_DECLINED",
  TUKAR_DISETUJUI: "SPG_SHIFT_SWAP_APPROVED",
  TUKAR_DITOLAK: "SPG_SHIFT_SWAP_REJECTED",
  TUKAR_DIBATALKAN: "SPG_SHIFT_SWAP_CANCELLED",
} as const;

/** `AuditLog.entityType` simpan jadwal; `entityId` = id toko. */
export const ENTITAS_JADWAL_SPG = "SpgShift";
/** `AuditLog.entityType` tukar shift; `entityId` = id ajuan. */
export const ENTITAS_TUKAR_SHIFT = "SpgShiftSwap";
/** Kategori `AdminNotification` untuk ajuan yang sudah disetujui rekan. */
export const KATEGORI_NOTIF_TUKAR_SHIFT = "SPG_SHIFT_SWAP";

/** Satu simpan menyentuh paling banyak seminggu × SPG satu toko, plus kelonggaran. */
export const MAKS_ISIAN_JADWAL = 500;

// ─── Isi sel ─────────────────────────────────────────────────────────────────

/** Pilihan di satu sel kisi kantor. `null` = kosong (belum dijadwalkan). */
export type IsiSel = { jenis: "KERJA"; kode: string } | { jenis: "LIBUR" } | null;

/** Bentuk baris di basis data yang dibutuhkan aturan di sini. */
export type BarisShift = {
  userId: string;
  day: string;
  kind: string;
  shiftCode: string | null;
  startTime: string | null;
  endTime: string | null;
};

/** Isi sel yang ditulis — salinan jenis shift saat disimpan. */
export type SelShift =
  | { kind: "KERJA"; shiftCode: string; startTime: string; endTime: string }
  | { kind: "LIBUR"; shiftCode: null; startTime: null; endTime: null };

export const SEL_LIBUR: SelShift = { kind: "LIBUR", shiftCode: null, startTime: null, endTime: null };

export const kunciSel = (userId: string, day: string) => `${userId}|${day}`;

/** Baris tersimpan → pilihan sel. Baris KERJA tanpa kode (rusak) dibaca kosong. */
export function isiDariBaris(b: Pick<BarisShift, "kind" | "shiftCode"> | null | undefined): IsiSel {
  if (!b) return null;
  if (b.kind === "LIBUR") return { jenis: "LIBUR" };
  if (b.kind === "KERJA" && b.shiftCode) return { jenis: "KERJA", kode: b.shiftCode };
  return null;
}

export function samaIsi(a: IsiSel, b: IsiSel): boolean {
  if (a === null || b === null) return a === b;
  if (a.jenis !== b.jenis) return false;
  return a.jenis === "LIBUR" || (b.jenis === "KERJA" && a.kode === b.kode);
}

/** Pilihan → isi yang ditulis, dari daftar shift SAAT INI. Kode yang tidak ada → null. */
export function selDariIsi(isi: Exclude<IsiSel, null>, aturan: AturanShift): SelShift | null {
  if (isi.jenis === "LIBUR") return SEL_LIBUR;
  const s = aturan.daftar.find((x) => x.kode === isi.kode);
  return s ? { kind: "KERJA", shiftCode: s.kode, startTime: s.mulai, endTime: s.selesai } : null;
}

/** Label shift dari daftar sekarang; kode yang sudah dihapus dari pengaturan tampil apa adanya. */
export function labelShift(kode: string | null, aturan: AturanShift): string {
  if (!kode) return "";
  return aturan.daftar.find((s) => s.kode === kode)?.label ?? kode;
}

/** Ringkasan satu sel di jejak — bentuk yang sama di sebelum dan sesudah. */
export type RingkasSel = { kind: string; shiftCode: string | null; startTime: string | null; endTime: string | null };

const ringkas = (b: Pick<BarisShift, "kind" | "shiftCode" | "startTime" | "endTime"> | SelShift | null): RingkasSel | null =>
  b ? { kind: b.kind, shiftCode: b.shiftCode, startTime: b.startTime, endTime: b.endTime } : null;

const samaRingkas = (a: RingkasSel | null, b: RingkasSel | null) =>
  a === null || b === null
    ? a === b
    : a.kind === b.kind && a.shiftCode === b.shiftCode && a.startTime === b.startTime && a.endTime === b.endTime;

export type PerubahanSel = { userId: string; day: string; sebelum: RingkasSel | null; sesudah: RingkasSel | null };

// ─── Isian dari klien ────────────────────────────────────────────────────────

export type IsianSel = { userId: string; day: string; isi: IsiSel };

/**
 * Isian aksi simpan dirapikan: bentuk aneh → null (seluruh simpan ditolak),
 * bukan ditebak. Isian ganda untuk sel yang sama: yang terakhir menang.
 */
export function rapikanIsianSel(x: unknown): IsianSel[] | null {
  if (!Array.isArray(x) || x.length > MAKS_ISIAN_JADWAL) return null;
  const peta = new Map<string, IsianSel>();
  for (const v of x) {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.userId !== "string" || !o.userId || typeof o.day !== "string") return null;
    let isi: IsiSel;
    if (o.isi === null || o.isi === undefined) isi = null;
    else if (typeof o.isi === "object") {
      const i = o.isi as Record<string, unknown>;
      if (i.jenis === "LIBUR") isi = { jenis: "LIBUR" };
      else if (i.jenis === "KERJA" && typeof i.kode === "string" && i.kode) isi = { jenis: "KERJA", kode: i.kode };
      else return null;
    } else return null;
    peta.set(kunciSel(o.userId, o.day), { userId: o.userId, day: o.day, isi });
  }
  return [...peta.values()];
}

// ─── Merencanakan satu simpan jadwal ─────────────────────────────────────────

export type KodeTolakJadwalSpg = "KOSONG" | "TANGGAL_TIDAK_SAH" | "HARI_LEWAT" | "BUKAN_SPG_TOKO" | "SHIFT_TIDAK_DIKENAL";

export type TolakJadwalSpg =
  | { ok: false; kode: "KOSONG" }
  | { ok: false; kode: "TANGGAL_TIDAK_SAH" | "HARI_LEWAT"; day: string }
  | { ok: false; kode: "BUKAN_SPG_TOKO"; userId: string }
  | { ok: false; kode: "SHIFT_TIDAK_DIKENAL"; shiftCode: string };

export type RencanaJadwalSpg = {
  ok: true;
  /** Sel yang ditulis (dibuat atau diubah). */
  tulis: (SelShift & { userId: string; day: string })[];
  /** Sel yang dikosongkan. */
  hapus: { userId: string; day: string }[];
  /** Hanya sel yang benar-benar berubah; kosong = tidak ada jejak, tidak ada kabar. */
  perubahan: PerubahanSel[];
  /** Per SPG: hari pertama yang berubah — tujuan tautan kabarnya. */
  hariPertama: Record<string, string>;
};

/**
 * Rencanakan satu simpan: apa yang ditulis dan dihapus, atau alasan menolak.
 * Tidak ada yang ditulis sebelum seluruh isian lolos.
 *
 * - Hari yang sudah lewat tidak bisa diubah sama sekali; hari ini masih boleh.
 * - Hanya SPG toko ini (`spg`) yang bisa dijadwalkan.
 * - Shift harus ada di daftar pengaturan SAAT INI; jamnya disalin dari sana.
 *   Sel yang memilih ulang kode yang sama tapi jam pengaturannya sudah
 *   berubah dihitung berubah — jamnya ikut diperbarui.
 */
export function rencanakanSimpanJadwalSpg(m: {
  /** Baris yang sudah ada untuk sel-sel yang disentuh isian. */
  sebelum: readonly BarisShift[];
  isian: readonly IsianSel[];
  aturan: AturanShift;
  hariIni: string;
  spg: ReadonlySet<string>;
}): RencanaJadwalSpg | TolakJadwalSpg {
  if (m.isian.length === 0) return { ok: false, kode: "KOSONG" };
  for (const s of m.isian) {
    if (!kunciHariSah(s.day)) return { ok: false, kode: "TANGGAL_TIDAK_SAH", day: String(s.day) };
  }
  const hariUrut = [...new Set(m.isian.map((s) => s.day))].sort();
  for (const day of hariUrut) {
    if (day < m.hariIni) return { ok: false, kode: "HARI_LEWAT", day };
  }
  for (const s of m.isian) {
    if (!m.spg.has(s.userId)) return { ok: false, kode: "BUKAN_SPG_TOKO", userId: s.userId };
  }

  const ada = new Map(m.sebelum.map((b) => [kunciSel(b.userId, b.day), b]));
  const tulis: RencanaJadwalSpg["tulis"] = [];
  const hapus: RencanaJadwalSpg["hapus"] = [];
  const perubahan: PerubahanSel[] = [];
  for (const s of m.isian) {
    const lama = ada.get(kunciSel(s.userId, s.day)) ?? null;
    let baru: SelShift | null = null;
    if (s.isi) {
      baru = selDariIsi(s.isi, m.aturan);
      if (!baru) return { ok: false, kode: "SHIFT_TIDAK_DIKENAL", shiftCode: s.isi.jenis === "KERJA" ? s.isi.kode : "" };
    }
    const sebelum = ringkas(lama);
    const sesudah = ringkas(baru);
    if (samaRingkas(sebelum, sesudah)) continue;
    perubahan.push({ userId: s.userId, day: s.day, sebelum, sesudah });
    if (baru) tulis.push({ ...baru, userId: s.userId, day: s.day });
    else hapus.push({ userId: s.userId, day: s.day });
  }
  perubahan.sort((a, b) => (a.day === b.day ? (a.userId < b.userId ? -1 : 1) : a.day < b.day ? -1 : 1));
  const hariPertama: Record<string, string> = {};
  for (const p of perubahan) if (!hariPertama[p.userId] || p.day < hariPertama[p.userId]) hariPertama[p.userId] = p.day;
  return { ok: true, tulis, hapus, perubahan, hariPertama };
}

// ─── Draf kisi kantor: salin minggu lalu, isi hari kerja ─────────────────────

/** Keadaan kisi di layar: `kunciSel(userId, day)` → isi. Kunci yang tidak ada = kosong. */
export type DrafJadwal = Record<string, IsiSel>;

export function drafDariBaris(baris: readonly BarisShift[]): DrafJadwal {
  const d: DrafJadwal = {};
  for (const b of baris) {
    const isi = isiDariBaris(b);
    if (isi) d[kunciSel(b.userId, b.day)] = isi;
  }
  return d;
}

/** Sel yang berbeda antara keadaan awal dan draf — yang dikirim saat Simpan. */
export function bedaDraf(awal: DrafJadwal, draf: DrafJadwal): IsianSel[] {
  const kunci = new Set([...Object.keys(awal), ...Object.keys(draf)]);
  const hasil: IsianSel[] = [];
  for (const k of [...kunci].sort()) {
    const a = awal[k] ?? null;
    const b = draf[k] ?? null;
    if (samaIsi(a, b)) continue;
    const i = k.lastIndexOf("|");
    hasil.push({ userId: k.slice(0, i), day: k.slice(i + 1), isi: b });
  }
  return hasil;
}

export type DilewatiSalinShift = { sudahAda: number; hariLewat: number; shiftTidakAda: number };

/**
 * "Salin minggu lalu" ke DRAF (belum disimpan): setiap sel minggu sumber
 * dipindah ke hari yang sama (Senin ke Senin) di minggu tujuan, hanya untuk
 * SPG yang sekarang di toko ini. Sel tujuan yang sudah berisi TIDAK ditimpa,
 * hari tujuan yang sudah lewat dilewati, dan shift yang sudah dihapus dari
 * pengaturan dilewati — setiap yang dilewati dihitung supaya layar bisa
 * menyebutnya.
 */
export function salinMingguKeDraf(m: {
  sumber: readonly BarisShift[];
  draf: DrafJadwal;
  seninTujuan: string;
  hariIni: string;
  spg: readonly string[];
  aturan: AturanShift;
}): { draf: DrafJadwal; disalin: number; dilewati: DilewatiSalinShift } {
  const draf: DrafJadwal = { ...m.draf };
  const dilewati: DilewatiSalinShift = { sudahAda: 0, hariLewat: 0, shiftTidakAda: 0 };
  const spg = new Set(m.spg);
  let disalin = 0;
  const urut = [...m.sumber].sort((a, b) => (a.day === b.day ? (a.userId < b.userId ? -1 : 1) : a.day < b.day ? -1 : 1));
  for (const s of urut) {
    if (!spg.has(s.userId)) continue;
    const isi = isiDariBaris(s);
    if (!isi) continue;
    const day = geserHari(m.seninTujuan, hariKeMinggu(s.day));
    if (day < m.hariIni) {
      dilewati.hariLewat += 1;
      continue;
    }
    const k = kunciSel(s.userId, day);
    if (draf[k]) {
      dilewati.sudahAda += 1;
      continue;
    }
    if (isi.jenis === "KERJA" && !m.aturan.daftar.some((x) => x.kode === isi.kode)) {
      dilewati.shiftTidakAda += 1;
      continue;
    }
    draf[k] = isi;
    disalin += 1;
  }
  return { draf, disalin, dilewati };
}

/** Izin yang DISETUJUI, cukup untuk mencocokkan hari. */
export type IzinRentang = { userId: string; type: string; startDay: string; endDay: string };

export const izinPada = (izin: readonly IzinRentang[], userId: string, day: string): string | null =>
  izin.find((z) => z.userId === userId && z.startDay <= day && day <= z.endDay)?.type ?? null;

/**
 * "Isi semua hari kerja dengan <shift>" ke DRAF: setiap SPG × hari kerja SPG
 * (`hariKerja`, 0 = Minggu — `spg.hariKerja`) yang belum lewat, masih kosong,
 * dan tidak sedang izin yang disetujui. Sel yang sudah berisi dibiarkan.
 */
export function isiHariKerjaKeDraf(m: {
  draf: DrafJadwal;
  senin: string;
  hariIni: string;
  spg: readonly string[];
  hariKerja: readonly number[];
  kode: string;
  izin: readonly IzinRentang[];
}): { draf: DrafJadwal; diisi: number; dilewati: { sudahAda: number; izin: number } } {
  const draf: DrafJadwal = { ...m.draf };
  const dilewati = { sudahAda: 0, izin: 0 };
  let diisi = 0;
  for (const day of hariSeminggu(m.senin)) {
    if (day < m.hariIni) continue;
    if (!m.hariKerja.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
    for (const userId of m.spg) {
      const k = kunciSel(userId, day);
      if (draf[k]) {
        dilewati.sudahAda += 1;
        continue;
      }
      if (izinPada(m.izin, userId, day)) {
        dilewati.izin += 1;
        continue;
      }
      draf[k] = { jenis: "KERJA", kode: m.kode };
      diisi += 1;
    }
  }
  return { draf, diisi, dilewati };
}

// ─── Kenyataan: jam masuk, terlambat, tidak masuk ───────────────────────────

const WIB_MS = 7 * 3_600_000;

/** Jam WIB "HH:mm" dari sebuah saat. */
export function jamWib(d: Date): string {
  return new Date(d.getTime() + WIB_MS).toISOString().slice(11, 16);
}

/** Saat mulai shift: hari WIB + jam WIB. */
export function saatMulai(day: string, jam: string): Date {
  return new Date(`${day}T${jam}:00+07:00`);
}

export type Kenyataan =
  | { status: "HADIR"; jamMasuk: string }
  | { status: "TERLAMBAT"; jamMasuk: string; menit: number }
  /** Check-in di hari yang ditetapkan LIBUR. */
  | { status: "MASUK_SAAT_LIBUR"; jamMasuk: string }
  | { status: "TIDAK_MASUK" }
  /** Hari ini, sudah lewat mulai + toleransi, belum check-in. */
  | { status: "BELUM_MASUK" }
  | { status: "IZIN"; jenis: string };

/**
 * Apa yang benar-benar terjadi di satu sel. Hari depan → null.
 *
 * - Ada check-in (pertama hari itu di toko itu): KERJA → terlambat bila
 *   check-in LEBIH dari mulai + toleransi (menitnya dihitung dari jam mulai),
 *   selain itu hadir; LIBUR → masuk saat libur; tanpa jadwal → hadir. Check-in
 *   di hari izin tetap hadir — orangnya datang.
 * - Tanpa check-in: izin yang disetujui → IZIN; KERJA di hari lalu → TIDAK
 *   MASUK; KERJA hari ini sesudah mulai + toleransi → BELUM MASUK.
 */
export function nilaiKenyataan(m: {
  day: string;
  hariIni: string;
  sekarang: Date;
  sel: Pick<BarisShift, "kind" | "startTime"> | null;
  checkin: Date | null;
  izin: string | null;
  toleransiMenit: number;
}): Kenyataan | null {
  if (m.day > m.hariIni) return null;
  const kerja = m.sel?.kind === "KERJA" && !!m.sel.startTime;
  const batas = kerja ? saatMulai(m.day, m.sel!.startTime!).getTime() + m.toleransiMenit * 60_000 : null;
  if (m.checkin) {
    const jamMasuk = jamWib(m.checkin);
    if (kerja && batas !== null) {
      const menit = Math.floor((m.checkin.getTime() - saatMulai(m.day, m.sel!.startTime!).getTime()) / 60_000);
      return m.checkin.getTime() > batas ? { status: "TERLAMBAT", jamMasuk, menit } : { status: "HADIR", jamMasuk };
    }
    if (m.sel?.kind === "LIBUR") return { status: "MASUK_SAAT_LIBUR", jamMasuk };
    return { status: "HADIR", jamMasuk };
  }
  if (m.izin) return { status: "IZIN", jenis: m.izin };
  if (!kerja) return null;
  if (m.day < m.hariIni) return { status: "TIDAK_MASUK" };
  return batas !== null && m.sekarang.getTime() > batas ? { status: "BELUM_MASUK" } : null;
}

/** Check-in pertama per orang per hari WIB (kunci `kunciSel`). */
export function checkinPertama(kunjungan: readonly { userId: string; checkinAt: Date }[]): Map<string, Date> {
  const peta = new Map<string, Date>();
  for (const k of kunjungan) {
    const kunci = kunciSel(k.userId, kunciHariWib(k.checkinAt));
    const ada = peta.get(kunci);
    if (!ada || k.checkinAt < ada) peta.set(kunci, k.checkinAt);
  }
  return peta;
}

// ─── Pengaturan: daftar jenis shift ──────────────────────────────────────────

export const MAKS_JENIS_SHIFT = 12;
export const MAKS_TOLERANSI_MENIT = 240;

export type KodeTolakAturanShift = "DAFTAR_KOSONG" | "TERLALU_BANYAK" | "SHIFT_TIDAK_SAH" | "KODE_GANDA" | "TOLERANSI_TIDAK_SAH";

/**
 * Untuk MENYIMPAN pengaturan shift: ketat. Paling sedikit satu jenis, kode
 * unik (A–Z, 0–9, _; bukan LIBUR), label terisi, jam "HH:mm" sah
 * (`shiftSah`), toleransi bilangan bulat 0–240 menit. Label dirapikan.
 */
export function periksaAturanShift(x: unknown): { ok: true; nilai: AturanShift } | { ok: false; kode: KodeTolakAturanShift; indeks?: number } {
  if (!x || typeof x !== "object" || Array.isArray(x)) return { ok: false, kode: "DAFTAR_KOSONG" };
  const o = x as Record<string, unknown>;
  const daftar = Array.isArray(o.daftar) ? o.daftar : [];
  if (daftar.length === 0) return { ok: false, kode: "DAFTAR_KOSONG" };
  if (daftar.length > MAKS_JENIS_SHIFT) return { ok: false, kode: "TERLALU_BANYAK" };
  const bersih: JenisShift[] = [];
  for (let i = 0; i < daftar.length; i++) {
    const s = daftar[i] as Record<string, unknown> | null;
    const calon =
      s && typeof s === "object"
        ? {
            kode: typeof s.kode === "string" ? s.kode.trim().toUpperCase() : s.kode,
            label: typeof s.label === "string" ? s.label.trim() : s.label,
            mulai: s.mulai,
            selesai: s.selesai,
          }
        : s;
    if (!shiftSah(calon)) return { ok: false, kode: "SHIFT_TIDAK_SAH", indeks: i };
    if (bersih.some((b) => b.kode === calon.kode)) return { ok: false, kode: "KODE_GANDA", indeks: i };
    bersih.push({ kode: calon.kode, label: calon.label, mulai: calon.mulai, selesai: calon.selesai });
  }
  const tol = o.toleransiTerlambatMenit;
  if (typeof tol !== "number" || !Number.isInteger(tol) || tol < 0 || tol > MAKS_TOLERANSI_MENIT) {
    return { ok: false, kode: "TOLERANSI_TIDAK_SAH" };
  }
  return { ok: true, nilai: { daftar: bersih, toleransiTerlambatMenit: tol } };
}

// ─── Tukar shift ─────────────────────────────────────────────────────────────

export const STATUS_TUKAR = ["MENUNGGU_REKAN", "MENUNGGU_KANTOR", "DISETUJUI", "DITOLAK_REKAN", "DITOLAK", "DIBATALKAN"] as const;
export type StatusTukar = (typeof STATUS_TUKAR)[number];
/** Ajuan yang masih hidup: memegang harinya dan masih bisa dibatalkan pengaju. */
export const STATUS_TUKAR_TERBUKA: readonly StatusTukar[] = ["MENUNGGU_REKAN", "MENUNGGU_KANTOR"];

export const statusTukarDari = (s: string): StatusTukar =>
  (STATUS_TUKAR as readonly string[]).includes(s) ? (s as StatusTukar) : "MENUNGGU_REKAN";

/** Ajuan tukar paling jauh sekian hari ke depan — sama dengan jangkauan jadwal di HP. */
export const JANGKAUAN_TUKAR_HARI = 14;
export const MAKS_ALASAN_TUKAR = 300;
export const MAKS_KUNCI_TUKAR = 100;

/** Spasi dirapatkan; kosong → null. `null` juga untuk bukan teks. */
export function rapikanTeksTukar(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** Hari yang disentuh satu ajuan, urut, tanpa ganda. */
export function hariTukar(s: { day: string; partnerDay: string | null }): string[] {
  return [...new Set([s.day, ...(s.partnerDay ? [s.partnerDay] : [])])].sort();
}

export type KodeTolakTukar =
  | "TANGGAL_TIDAK_SAH"
  | "HARI_LEWAT"
  | "TERLALU_JAUH"
  | "PENGAJU_TIDAK_KERJA"
  | "REKAN_TIDAK_KERJA";

/**
 * Apakah ajuan masih sah terhadap jadwal SEKARANG — diperiksa saat mengajukan,
 * saat rekan setuju, dan saat kantor menyetujui (jadwal bisa diubah kantor di
 * antaranya):
 * - setiap hari sah, tidak lewat (hari ini masih boleh), dan paling jauh
 *   `JANGKAUAN_TUKAR_HARI` ke depan — kecuali `tanpaBatasJauh` (saat
 *   memutuskan: ajuan yang sah saat dibuat tidak menjadi "terlalu jauh");
 * - pengaju BEKERJA di harinya (yang ia serahkan);
 * - bila ditukar balik, rekan BEKERJA di hari rekan.
 */
export function periksaTukar(m: {
  day: string;
  partnerDay: string | null;
  hariIni: string;
  pengaju: ReadonlyMap<string, Pick<BarisShift, "kind">>;
  rekan: ReadonlyMap<string, Pick<BarisShift, "kind">>;
  tanpaBatasJauh?: boolean;
}): KodeTolakTukar | null {
  const hari = [m.day, ...(m.partnerDay ? [m.partnerDay] : [])];
  for (const d of hari) if (!kunciHariSah(d)) return "TANGGAL_TIDAK_SAH";
  for (const d of hari) if (d < m.hariIni) return "HARI_LEWAT";
  if (!m.tanpaBatasJauh) {
    const batas = geserHari(m.hariIni, JANGKAUAN_TUKAR_HARI - 1);
    for (const d of hari) if (d > batas) return "TERLALU_JAUH";
  }
  if (m.pengaju.get(m.day)?.kind !== "KERJA") return "PENGAJU_TIDAK_KERJA";
  if (m.partnerDay && m.rekan.get(m.partnerDay)?.kind !== "KERJA") return "REKAN_TIDAK_KERJA";
  return null;
}

/** Ajuan terbuka lain yang menyentuh orang-hari yang sama — dua tukar di atas satu sel saling meniadakan. */
export function tukarBentrok(
  baru: { requesterId: string; partnerId: string; day: string; partnerDay: string | null },
  terbuka: readonly { id: string; requesterId: string; partnerId: string; day: string; partnerDay: string | null }[],
): string | null {
  const orang = new Set([baru.requesterId, baru.partnerId]);
  const hari = new Set(hariTukar(baru));
  for (const t of terbuka) {
    if (!orang.has(t.requesterId) && !orang.has(t.partnerId)) continue;
    if (hariTukar(t).some((d) => hari.has(d))) return t.id;
  }
  return null;
}

/**
 * Isi sel sesudah tukar disetujui: di setiap hari yang terlibat, isi sel
 * pengaju dan rekan bertukar. Sel kosong dianggap LIBUR — kalau rekan tidak
 * dijadwalkan di hari itu, shift pengaju berpindah kepadanya dan pengaju
 * menjadi libur, tertulis jelas, bukan "belum dijadwalkan".
 */
export function hasilTukar(m: {
  pengajuId: string;
  rekanId: string;
  hari: readonly string[];
  baris: readonly BarisShift[];
}): { tulis: (SelShift & { userId: string; day: string })[]; perubahan: PerubahanSel[] } {
  const peta = new Map(m.baris.map((b) => [kunciSel(b.userId, b.day), b]));
  const sel = (b: BarisShift | undefined): SelShift =>
    b && b.kind === "KERJA" && b.shiftCode && b.startTime && b.endTime
      ? { kind: "KERJA", shiftCode: b.shiftCode, startTime: b.startTime, endTime: b.endTime }
      : SEL_LIBUR;
  const tulis: (SelShift & { userId: string; day: string })[] = [];
  const perubahan: PerubahanSel[] = [];
  for (const day of [...new Set(m.hari)].sort()) {
    const a = peta.get(kunciSel(m.pengajuId, day));
    const b = peta.get(kunciSel(m.rekanId, day));
    const baruA = sel(b);
    const baruB = sel(a);
    for (const [userId, lama, baru] of [
      [m.pengajuId, a, baruA],
      [m.rekanId, b, baruB],
    ] as const) {
      const sebelum = ringkas(lama ?? null);
      const sesudah = ringkas(baru);
      if (samaRingkas(sebelum, sesudah)) continue;
      tulis.push({ ...baru, userId, day });
      perubahan.push({ userId, day, sebelum, sesudah });
    }
  }
  return { tulis, perubahan };
}

/** Hari ini WIB — dipakai pemanggil yang memegang `Date`. */
export const hariIniDari = (d: Date) => kunciHariWib(d);
