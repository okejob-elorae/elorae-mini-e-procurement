/**
 * Jadwal kunjungan dari kantor — aturan murni, tanpa basis data, supaya bisa
 * dites dan dipakai di layar kantor maupun HP.
 *
 * Satu baris `VisitSchedule` = satu sales × satu toko × satu hari WIB
 * (`dayKey` "YYYY-MM-DD"). Jadwal ini MELENGKAPI rencana kunjungan yang
 * disusun otomatis dari aturan (tagihan, toko menurun, jarak kunjungan),
 * bukan menggantikannya: di HP toko terjadwal tampil paling atas dengan tanda
 * "Dari kantor", rencana otomatis tetap di bawahnya.
 *
 * Kepatuhan = toko terjadwal yang benar-benar didatangi sales itu (check-in
 * apa pun di toko itu pada hari WIB yang sama). Hari yang sudah lewat tanpa
 * kunjungan = TERLEWAT; hari ini dan sesudahnya yang belum = MENUNGGU.
 */

import { kunciHariWib } from "@/lib/dashboard/tren";

/** Batas toko per sales per hari. Lebih dari ini hampir pasti salah pilih, bukan rencana kerja. */
export const MAKS_TOKO_PER_HARI = 60;
/** Panjang catatan kantor untuk satu toko di satu hari. */
export const MAKS_CATATAN_JADWAL = 300;
/** `?tanggal=` di HP hanya diterima sejauh ini dari hari ini (sekitar sembilan minggu ke dua arah). */
export const JANGKAUAN_HARI_HP = 63;

/** Nama tindakan di `AuditLog` — satu baris per simpan, berisi sebelum/sesudah per hari. */
export const AKSI_JADWAL = "VISIT_SCHEDULE_UPDATED";
/** `AuditLog.entityType`; `entityId` = id sales yang jadwalnya diubah. */
export const ENTITAS_JADWAL = "VisitSchedule";

/**
 * IZIN = hari itu sales sedang izin/sakit/cuti yang DISETUJUI dan tidak
 * mendatangi tokonya: bukan "terlewat", dan tidak dihitung dalam penyebut.
 */
export type StatusJadwal = "DIKUNJUNGI" | "TERLEWAT" | "MENUNGGU" | "IZIN";

const HARI_MS = 86_400_000;

// ─── Hari dan minggu (WIB) ────────────────────────────────────────────────────

/** `YYYY-MM-DD` yang benar-benar hari kalender (bukan 30 Februari). */
export function kunciHariSah(x: unknown): x is string {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
}

/** Geser kunci hari sejumlah hari kalender (tanpa zona — kuncinya sudah hari WIB). */
export function geserHari(kunci: string, n: number): string {
  return new Date(Date.parse(`${kunci}T00:00:00Z`) + n * HARI_MS).toISOString().slice(0, 10);
}

/** Selisih hari kalender `b − a`. */
function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / HARI_MS);
}

/** Urutan hari di minggu kerja: Senin = 0 … Minggu = 6. */
export function hariKeMinggu(kunci: string): number {
  return (new Date(`${kunci}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Senin dari minggu yang memuat hari itu. */
export function seninDari(kunci: string): string {
  return geserHari(kunci, -hariKeMinggu(kunci));
}

/** Tujuh kunci hari, Senin sampai Minggu. */
export function hariSeminggu(senin: string): string[] {
  return Array.from({ length: 7 }, (_, i) => geserHari(senin, i));
}

type Param = string | string[] | undefined | null;
const pertama = (x: Param): string | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined));

/** `?minggu=` di layar kantor: hari apa pun di minggu itu → Seninnya; rusak → minggu ini. */
export function bacaMinggu(param: Param, sekarang: Date): string {
  const t = pertama(param);
  return seninDari(kunciHariSah(t) ? t : kunciHariWib(sekarang));
}

/**
 * `?tanggal=` di HP (tautan kabar jadwal membawanya). Hanya hari yang sah dan
 * dalam jangkauan; selain itu hari ini — alamat yang disunting tangan tidak
 * bisa membuka jadwal sepuluh tahun lagi.
 */
export function bacaTanggalJadwal(param: Param, sekarang: Date, jangkauan = JANGKAUAN_HARI_HP): string {
  const hariIni = kunciHariWib(sekarang);
  const t = pertama(param);
  if (!kunciHariSah(t)) return hariIni;
  return Math.abs(selisihHari(hariIni, t)) <= jangkauan ? t : hariIni;
}

// ─── Kepatuhan ───────────────────────────────────────────────────────────────

export function statusJadwal(dayKey: string, hariIni: string, dikunjungi: boolean): StatusJadwal {
  if (dikunjungi) return "DIKUNJUNGI";
  return dayKey < hariIni ? "TERLEWAT" : "MENUNGGU";
}

/** `direncanakan` TIDAK termasuk baris IZIN — penyebut "N dari M dikunjungi". */
export type RingkasJadwal = { direncanakan: number; dikunjungi: number; terlewat: number; menunggu: number; izin: number };

export const ringkasKosong = (): RingkasJadwal => ({ direncanakan: 0, dikunjungi: 0, terlewat: 0, menunggu: 0, izin: 0 });

/** Izin yang disetujui, cukup untuk mencocokkan hari (`izinDisetujuiRentang`). */
export type IzinUntukJadwal = { userId: string; type: string; startDay: string; endDay: string };

const kunciKunjungan = (salesmanId: string, storeId: string, dayKey: string) => `${salesmanId}|${storeId}|${dayKey}`;

/**
 * Setiap baris jadwal diberi status, dan jumlahnya diringkas. Kunjungan
 * dicocokkan per sales × toko × hari WIB — check-in pukul 00.30 WIB adalah
 * hari itu, walau di UTC masih kemarin. Kunjungan yang masih berlangsung juga
 * dihitung: tokonya sudah didatangi.
 */
export function kepatuhanJadwal<T extends { salesmanId: string; storeId: string; dayKey: string }>(
  jadwal: readonly T[],
  kunjungan: readonly { userId: string; storeId: string; checkinAt: Date }[],
  hariIni: string,
  /** Izin/sakit/cuti yang DISETUJUI; kosong = perilaku lama. */
  izin: readonly IzinUntukJadwal[] = [],
): { baris: (T & { status: StatusJadwal })[]; ringkas: RingkasJadwal } {
  const sudah = new Set(kunjungan.map((k) => kunciKunjungan(k.userId, k.storeId, kunciHariWib(k.checkinAt))));
  const sedangIzin = (salesmanId: string, dayKey: string) =>
    izin.some((z) => z.userId === salesmanId && z.startDay <= dayKey && dayKey <= z.endDay);
  const baris = jadwal.map((j) => {
    const dikunjungi = sudah.has(kunciKunjungan(j.salesmanId, j.storeId, j.dayKey));
    // Kunjungan yang tetap terjadi di hari izin tetap DIKUNJUNGI.
    const status: StatusJadwal = !dikunjungi && sedangIzin(j.salesmanId, j.dayKey) ? "IZIN" : statusJadwal(j.dayKey, hariIni, dikunjungi);
    return { ...j, status };
  });
  return { baris, ringkas: ringkasStatus(baris) };
}

/** Hitung baris berstatus menjadi ringkasan. */
export function ringkasStatus(baris: readonly { status: StatusJadwal }[]): RingkasJadwal {
  const r = ringkasKosong();
  for (const b of baris) {
    if (b.status === "IZIN") {
      r.izin += 1;
      continue;
    }
    r.direncanakan += 1;
    if (b.status === "DIKUNJUNGI") r.dikunjungi += 1;
    else if (b.status === "TERLEWAT") r.terlewat += 1;
    else r.menunggu += 1;
  }
  return r;
}

/** Jumlahkan ringkasan beberapa sales (baris total di dasbor atasan). */
export function jumlahkanRingkas(daftar: readonly (RingkasJadwal | null | undefined)[]): RingkasJadwal {
  const t = ringkasKosong();
  for (const r of daftar) {
    if (!r) continue;
    t.direncanakan += r.direncanakan;
    t.dikunjungi += r.dikunjungi;
    t.terlewat += r.terlewat;
    t.menunggu += r.menunggu;
    t.izin += r.izin;
  }
  return t;
}

// ─── Catatan ─────────────────────────────────────────────────────────────────

/** Spasi dan baris baru dirapatkan; kosong → null. Panjangnya diperiksa terpisah. */
export function rapikanCatatanJadwal(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

// ─── Perubahan ───────────────────────────────────────────────────────────────

export type BarisJadwal = { dayKey: string; storeId: string; note: string | null };

/** Toko yang dirujuk perubahan, cukup untuk menilai apakah ia boleh dijadwalkan. */
export type TokoJadwal = { id: string; isActive: boolean; salesmanId: string | null };

export type PerubahanJadwal = {
  /** Tambah toko ke hari itu. Sudah ada → dibiarkan; catatan hanya ditimpa bila diisi. */
  tambah?: { dayKey: string; storeId: string; note?: string | null }[];
  /** Hapus dari hari itu. Tidak ada → tidak terjadi apa-apa. */
  hapus?: { dayKey: string; storeId: string }[];
  /** Ubah catatan toko yang SUDAH terjadwal; kosong menghapus catatannya. */
  catatan?: { dayKey: string; storeId: string; note: string | null }[];
  /** Isi hari itu menjadi persis daftar ini (daftar kosong = kosongkan hari). */
  ganti?: { dayKey: string; toko: { storeId: string; note?: string | null }[] }[];
};

/** Isi jadwal per hari dalam jejak audit: urut id toko supaya dua jejak bisa dibandingkan. */
export type JejakJadwal = {
  before: Record<string, { storeId: string; note: string | null }[]>;
  after: Record<string, { storeId: string; note: string | null }[]>;
};

export type KodeTolakJadwal =
  | "KOSONG"
  | "TANGGAL_TIDAK_SAH"
  | "HARI_LEWAT"
  | "TERLALU_BANYAK"
  | "TOKO_TIDAK_DITEMUKAN"
  | "TOKO_TIDAK_AKTIF"
  | "TOKO_BUKAN_MILIKNYA"
  | "CATATAN_TERLALU_PANJANG"
  | "TIDAK_DITEMUKAN";

export type TolakJadwal =
  | { ok: false; kode: "KOSONG" | "CATATAN_TERLALU_PANJANG" }
  | { ok: false; kode: "TANGGAL_TIDAK_SAH" | "HARI_LEWAT"; dayKey: string }
  | { ok: false; kode: "TERLALU_BANYAK"; dayKey: string; jumlah: number }
  | { ok: false; kode: "TOKO_TIDAK_DITEMUKAN" | "TOKO_TIDAK_AKTIF" | "TOKO_BUKAN_MILIKNYA"; storeIds: string[] }
  | { ok: false; kode: "TIDAK_DITEMUKAN"; dayKey: string; storeId: string };

export type RencanaUbahJadwal = {
  ok: true;
  buat: BarisJadwal[];
  /** Baris yang sudah ada dan catatannya berubah. */
  ubah: BarisJadwal[];
  hapus: { dayKey: string; storeId: string }[];
  /** null = tidak ada yang berubah (tidak ada jejak, tidak ada kabar). */
  jejak: JejakJadwal | null;
  /** Hari yang isinya berubah, urut. */
  hariBerubah: string[];
};

type IsiHari = Map<string, string | null>;

function keIsi(rows: readonly BarisJadwal[]): Map<string, IsiHari> {
  const isi = new Map<string, IsiHari>();
  for (const r of rows) {
    const hari = isi.get(r.dayKey) ?? new Map<string, string | null>();
    hari.set(r.storeId, r.note);
    isi.set(r.dayKey, hari);
  }
  return isi;
}

const daftarHari = (hari: IsiHari | undefined) =>
  [...(hari ?? new Map<string, string | null>()).entries()]
    .map(([storeId, note]) => ({ storeId, note }))
    .sort((a, b) => (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0));

/** Toko yang tidak boleh dijadwalkan untuk sales ini, per alasan. */
function nilaiToko(
  storeId: string,
  toko: ReadonlyMap<string, TokoJadwal>,
  terkunci: boolean,
  salesmanId: string,
): "TOKO_TIDAK_DITEMUKAN" | "TOKO_TIDAK_AKTIF" | "TOKO_BUKAN_MILIKNYA" | null {
  const t = toko.get(storeId);
  if (!t) return "TOKO_TIDAK_DITEMUKAN";
  if (!t.isActive) return "TOKO_TIDAK_AKTIF";
  // Kunci "hanya toko sendiri": sales tidak bisa check-in di toko orang lain,
  // jadi menjadwalkannya ke sana sama dengan menjadwalkan kegagalan.
  if (terkunci && t.salesmanId !== salesmanId) return "TOKO_BUKAN_MILIKNYA";
  return null;
}

/** Bandingkan isi sebelum/sesudah untuk hari-hari tertentu → baris yang ditulis + jejak. */
function bandingkan(
  sebelum: Map<string, IsiHari>,
  sesudah: Map<string, IsiHari>,
  hari: readonly string[],
): Omit<RencanaUbahJadwal, "ok"> {
  const buat: BarisJadwal[] = [];
  const ubah: BarisJadwal[] = [];
  const hapus: { dayKey: string; storeId: string }[] = [];
  const jejak: JejakJadwal = { before: {}, after: {} };
  const hariBerubah: string[] = [];

  for (const dayKey of [...new Set(hari)].sort()) {
    const lama = sebelum.get(dayKey) ?? new Map<string, string | null>();
    const baru = sesudah.get(dayKey) ?? new Map<string, string | null>();
    let berubah = false;
    for (const [storeId, note] of baru) {
      if (!lama.has(storeId)) {
        buat.push({ dayKey, storeId, note });
        berubah = true;
      } else if (lama.get(storeId) !== note) {
        ubah.push({ dayKey, storeId, note });
        berubah = true;
      }
    }
    for (const storeId of lama.keys()) {
      if (!baru.has(storeId)) {
        hapus.push({ dayKey, storeId });
        berubah = true;
      }
    }
    if (berubah) {
      hariBerubah.push(dayKey);
      jejak.before[dayKey] = daftarHari(lama);
      jejak.after[dayKey] = daftarHari(baru);
    }
  }
  return { buat, ubah, hapus, jejak: hariBerubah.length ? jejak : null, hariBerubah };
}

/**
 * Rencanakan satu simpan jadwal satu sales: apa yang dibuat, diubah, dihapus,
 * dan jejaknya — atau alasan menolak. Tidak ada yang ditulis sebelum seluruh
 * perubahan lolos.
 *
 * - Hari yang sudah lewat tidak bisa diubah sama sekali (termasuk menghapus):
 *   jadwal hari lalu adalah dasar penilaian kepatuhan. Hari ini masih boleh.
 * - Hanya toko yang BARU masuk jadwal yang dinilai (ada, aktif, dan saat kunci
 *   "hanya toko sendiri" menyala, dipegang sales itu). Toko yang sudah
 *   terjadwal lalu dinonaktifkan tetap bisa dihapus atau diberi catatan.
 * - Paling banyak `MAKS_TOKO_PER_HARI` per hari — kecuali perubahan yang
 *   justru mengurangi isi hari.
 *
 * Urutan penerapan: ganti, hapus, tambah, catatan.
 */
export function rencanakanUbahJadwal(m: {
  /** Baris jadwal sales itu untuk hari-hari yang disentuh perubahan. */
  sebelum: readonly BarisJadwal[];
  perubahan: PerubahanJadwal;
  hariIni: string;
  /** Toko yang dirujuk `tambah` dan `ganti`. */
  toko: ReadonlyMap<string, TokoJadwal>;
  terkunci: boolean;
  salesmanId: string;
}): RencanaUbahJadwal | TolakJadwal {
  const p = m.perubahan;
  const ganti = p.ganti ?? [];
  const hapus = p.hapus ?? [];
  const tambah = p.tambah ?? [];
  const catatan = p.catatan ?? [];
  const hari = [
    ...ganti.map((g) => g.dayKey),
    ...hapus.map((h) => h.dayKey),
    ...tambah.map((t) => t.dayKey),
    ...catatan.map((c) => c.dayKey),
  ];
  if (hari.length === 0) return { ok: false, kode: "KOSONG" };
  for (const dayKey of hari) {
    if (!kunciHariSah(dayKey)) return { ok: false, kode: "TANGGAL_TIDAK_SAH", dayKey: String(dayKey) };
  }
  for (const dayKey of [...new Set(hari)].sort()) {
    if (dayKey < m.hariIni) return { ok: false, kode: "HARI_LEWAT", dayKey };
  }

  const catatanMasuk = [
    ...ganti.flatMap((g) => g.toko.map((t) => t.note)),
    ...tambah.map((t) => t.note),
    ...catatan.map((c) => c.note),
  ];
  if (catatanMasuk.some((n) => (rapikanCatatanJadwal(n)?.length ?? 0) > MAKS_CATATAN_JADWAL)) {
    return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  }

  const sebelum = keIsi(m.sebelum.filter((r) => hari.includes(r.dayKey)));
  const sesudah = new Map<string, IsiHari>([...sebelum].map(([k, v]) => [k, new Map(v)]));
  const hariDari = (dayKey: string) => {
    const h = sesudah.get(dayKey) ?? new Map<string, string | null>();
    sesudah.set(dayKey, h);
    return h;
  };

  for (const g of ganti) {
    const lama = sebelum.get(g.dayKey);
    const baru = new Map<string, string | null>();
    for (const t of g.toko) {
      if (baru.has(t.storeId)) continue;
      baru.set(t.storeId, t.note === undefined ? (lama?.get(t.storeId) ?? null) : rapikanCatatanJadwal(t.note));
    }
    sesudah.set(g.dayKey, baru);
  }
  for (const h of hapus) hariDari(h.dayKey).delete(h.storeId);
  for (const t of tambah) {
    const h = hariDari(t.dayKey);
    const note = rapikanCatatanJadwal(t.note);
    if (!h.has(t.storeId)) h.set(t.storeId, note);
    else if (note !== null) h.set(t.storeId, note);
  }
  for (const c of catatan) {
    const h = hariDari(c.dayKey);
    if (!h.has(c.storeId)) return { ok: false, kode: "TIDAK_DITEMUKAN", dayKey: c.dayKey, storeId: c.storeId };
    h.set(c.storeId, rapikanCatatanJadwal(c.note));
  }

  // Toko yang baru masuk jadwal: dinilai sekali, semua yang salah disebut sekaligus.
  const salah = new Map<"TOKO_TIDAK_DITEMUKAN" | "TOKO_TIDAK_AKTIF" | "TOKO_BUKAN_MILIKNYA", string[]>();
  for (const [dayKey, isi] of sesudah) {
    const lama = sebelum.get(dayKey);
    for (const storeId of isi.keys()) {
      if (lama?.has(storeId)) continue;
      const kode = nilaiToko(storeId, m.toko, m.terkunci, m.salesmanId);
      if (!kode) continue;
      const daftar = salah.get(kode) ?? [];
      if (!daftar.includes(storeId)) daftar.push(storeId);
      salah.set(kode, daftar);
    }
  }
  for (const kode of ["TOKO_TIDAK_DITEMUKAN", "TOKO_TIDAK_AKTIF", "TOKO_BUKAN_MILIKNYA"] as const) {
    const ids = salah.get(kode);
    if (ids?.length) return { ok: false, kode, storeIds: ids };
  }

  for (const dayKey of [...sesudah.keys()].sort()) {
    const jumlah = sesudah.get(dayKey)?.size ?? 0;
    const lama = sebelum.get(dayKey)?.size ?? 0;
    if (jumlah > MAKS_TOKO_PER_HARI && jumlah > lama) return { ok: false, kode: "TERLALU_BANYAK", dayKey, jumlah };
  }

  return { ok: true, ...bandingkan(sebelum, sesudah, hari) };
}

export type DilewatiSalin = {
  sudahAda: number;
  hariLewat: number;
  tokoTidakAktif: number;
  bukanMiliknya: number;
  penuh: number;
};

/**
 * "Salin minggu lalu": setiap baris minggu sumber dipindah ke hari yang sama
 * (Senin ke Senin) di minggu tujuan. Yang sudah ada di tujuan TIDAK ditimpa
 * (catatannya pun tidak), hari tujuan yang sudah lewat dilewati, toko yang kini
 * nonaktif atau — saat kunci menyala — tidak dipegang sales itu dilewati, dan
 * hari yang penuh tidak ditambah. Setiap yang dilewati dihitung, supaya layar
 * bisa menyebut kenapa tidak semuanya tersalin.
 */
export function rencanakanSalinMinggu(m: {
  sumber: readonly BarisJadwal[];
  /** Baris yang sudah ada di minggu tujuan. */
  ada: readonly BarisJadwal[];
  seninTujuan: string;
  hariIni: string;
  toko: ReadonlyMap<string, TokoJadwal>;
  terkunci: boolean;
  salesmanId: string;
}): {
  buat: BarisJadwal[];
  dilewati: DilewatiSalin;
  jejak: JejakJadwal | null;
  hariBerubah: string[];
} {
  const dilewati: DilewatiSalin = { sudahAda: 0, hariLewat: 0, tokoTidakAktif: 0, bukanMiliknya: 0, penuh: 0 };
  const sebelum = keIsi(m.ada);
  const sesudah = new Map<string, IsiHari>([...sebelum].map(([k, v]) => [k, new Map(v)]));
  const hariTujuan: string[] = [];

  const urut = [...m.sumber].sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  for (const s of urut) {
    const dayKey = geserHari(m.seninTujuan, hariKeMinggu(s.dayKey));
    if (dayKey < m.hariIni) {
      dilewati.hariLewat += 1;
      continue;
    }
    const isi = sesudah.get(dayKey) ?? new Map<string, string | null>();
    if (isi.has(s.storeId)) {
      dilewati.sudahAda += 1;
      continue;
    }
    const kode = nilaiToko(s.storeId, m.toko, m.terkunci, m.salesmanId);
    if (kode === "TOKO_BUKAN_MILIKNYA") {
      dilewati.bukanMiliknya += 1;
      continue;
    }
    if (kode) {
      dilewati.tokoTidakAktif += 1;
      continue;
    }
    if (isi.size >= MAKS_TOKO_PER_HARI) {
      dilewati.penuh += 1;
      continue;
    }
    isi.set(s.storeId, s.note);
    sesudah.set(dayKey, isi);
    hariTujuan.push(dayKey);
  }

  const { buat, jejak, hariBerubah } = bandingkan(sebelum, sesudah, hariTujuan);
  return { buat, dilewati, jejak, hariBerubah };
}

// ─── Beranda dan rute: jadwal kantor di depan ───────────────────────────────

export type BarisRencanaJadwal<J, R> =
  | { jenis: "jadwal"; jadwal: J; rencana: R | null }
  | { jenis: "rencana"; rencana: R };

/**
 * Gabungkan toko terjadwal hari ini dengan rencana otomatis untuk kartu
 * "Rencana kunjungan": toko terjadwal yang BELUM didatangi paling atas (urutan
 * kantor dipertahankan), lalu rencana otomatis tanpa toko yang sudah
 * terjadwal (alasannya ikut ke baris jadwalnya), lalu toko terjadwal yang
 * sudah didatangi — selesai, tapi tetap terlihat sebagai bukti.
 */
export function gabungRencanaJadwal<J extends { storeId: string; dikunjungi: boolean }, R extends { storeId: string }>(
  jadwal: readonly J[],
  rencana: readonly R[],
): BarisRencanaJadwal<J, R>[] {
  const rencanaPer = new Map(rencana.map((r) => [r.storeId, r]));
  const terjadwal = new Set(jadwal.map((j) => j.storeId));
  const baris = (j: J): BarisRencanaJadwal<J, R> => ({ jenis: "jadwal", jadwal: j, rencana: rencanaPer.get(j.storeId) ?? null });
  return [
    ...jadwal.filter((j) => !j.dikunjungi).map(baris),
    ...rencana.filter((r) => !terjadwal.has(r.storeId)).map((r) => ({ jenis: "rencana" as const, rencana: r })),
    ...jadwal.filter((j) => j.dikunjungi).map(baris),
  ];
}
