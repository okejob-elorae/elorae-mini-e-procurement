/*
 * Pulau status — keadaan murni (tanpa React, tanpa peramban).
 *
 * Satu kapsul di tengah atas menggantikan tumpukan toast dan label "Online".
 * Beberapa sumber bisa aktif bersamaan; yang tampil dipilih menurut tingkat:
 *
 *   galat > proses > luring/mengirim > notifikasi > pesan > antrean tertunda > diam
 *
 * Di dalam satu tingkat yang terbaru tampil dan sisanya dihitung sebagai "+N".
 * Tingkat berikutnya yang juga aktif tampil sebagai gelembung kecil di samping
 * kapsul (`kedua`), jadi pesan "Tersimpan" tidak hilang tanpa jejak hanya
 * karena HP sedang tanpa sinyal.
 *
 * Waktu selalu masuk sebagai argumen (`sekarang`); pengatur waktunya ada di
 * `pulau.ts`. Setiap fungsi mengembalikan keadaan baru dan tidak mengubah yang lama.
 */

export type JenisPesan = "sukses" | "galat" | "info" | "peringatan" | "memuat" | "biasa";

export type AksiPesan = {
  label: string;
  /** Menerima peristiwa klik tombolnya (dipakai jembatan toast). */
  jalankan: (peristiwa?: unknown) => void;
};

export type MasukanPesan = {
  /** Id yang sama memperbarui pesan lama, bukan menambah yang baru. */
  id?: string;
  jenis: JenisPesan;
  teks: string;
  keterangan?: string;
  aksi?: AksiPesan;
  tautan?: string;
  /** Milidetik. `null` = bertahan sampai diketuk. Kosong = bawaan per jenis. */
  durasiMs?: number | null;
};

export type Pesan = {
  id: string;
  jenis: JenisPesan;
  teks: string;
  keterangan?: string;
  aksi?: AksiPesan;
  tautan?: string;
  urut: number;
  /** Waktu hilang (ms epoch); `null` = sampai ditutup. */
  sampai: number | null;
};

export type Proses = { id: string; label: string; persen: number | null; urut: number };

export type MasukanLuring = {
  luring: boolean;
  belumTerkirim: number;
  mengirim: boolean;
  /** Ke mana kapsul membawa saat diketuk (layar antrean HP). */
  tautan?: string;
  /** Dijalankan saat kapsul "N belum terkirim" diketuk ketika ada sinyal. */
  kirimUlang?: () => void;
};

export type Luring = MasukanLuring & {
  /** Kilasan sesudah pengiriman selesai: sisa 0 = "Terkirim". */
  selesai: { sisa: number; sampai: number } | null;
};

export type MasukanNotifikasi = {
  judul: string;
  tautan?: string | null;
  jumlah?: number;
  diketuk?: () => void;
  /**
   * Tujuan ketukan saat kapsul menyebut LEBIH dari satu notifikasi — termasuk
   * yang terkumpul dari kabar sebelumnya yang masih tampil — supaya "2
   * notifikasi baru" membuka daftarnya, bukan hanya notifikasi terakhir.
   */
  semua?: { tautan?: string | null; diketuk?: () => void };
};

export type Notifikasi = {
  judul: string;
  tautan: string | null;
  jumlah: number;
  diketuk?: () => void;
  sampai: number;
};

export type KeadaanPulau = {
  urut: number;
  pesan: Pesan[];
  proses: Proses[];
  luring: Luring;
  notifikasi: Notifikasi | null;
};

export type JenisButir =
  | "galat"
  | "proses"
  | "luring"
  | "mengirim"
  | "terkirim"
  | "sisa"
  | "notifikasi"
  | "sukses"
  | "info"
  | "peringatan"
  | "memuat"
  | "biasa"
  | "tertunda";

export type ButirTampilan = {
  /** Stabil per sumber (id pesan, id proses, "luring", …) — kunci animasi. */
  kunci: string;
  jenis: JenisButir;
  /** Kosong untuk butir yang teksnya dirakit komponen (luring, terkirim, …). */
  teks: string;
  keterangan?: string;
  persen?: number | null;
  jumlah?: number;
  aksi?: AksiPesan;
  tautan?: string | null;
  diketuk?: () => void;
  /** Butir lain yang aktif di tingkat yang sama ("+N"). */
  tambahan: number;
  bisaDitutup: boolean;
  peran: "status" | "alert";
};

export type Tampilan = { utama: ButirTampilan; kedua: ButirTampilan | null };

/** Lama tampil bawaan (ms). */
export const DURASI = {
  sukses: 2500,
  info: 3500,
  biasa: 3500,
  peringatan: 5000,
  galat: 8000,
  /** "Menyimpan…" yang tidak pernah diselesaikan pemanggilnya tidak tertahan selamanya. */
  memuat: 60_000,
  /** Pesan bertombol (mis. "Urungkan") diberi waktu untuk diketuk. */
  denganAksi: 6000,
  notifikasi: 6000,
  terkirim: 2500,
  sisa: 4000,
} as const;

export function keadaanAwal(): KeadaanPulau {
  return {
    urut: 0,
    pesan: [],
    proses: [],
    luring: { luring: false, belumTerkirim: 0, mengirim: false, selesai: null },
    notifikasi: null,
  };
}

function lamaPesan(m: MasukanPesan): number | null {
  if (m.durasiMs === null) return null;
  if (typeof m.durasiMs === "number") {
    if (!Number.isFinite(m.durasiMs)) return null;
    return Math.max(0, m.durasiMs);
  }
  const bawaan = DURASI[m.jenis];
  return m.aksi ? Math.max(bawaan, DURASI.denganAksi) : bawaan;
}

export function tambahPesan(k: KeadaanPulau, m: MasukanPesan, sekarang: number): KeadaanPulau {
  const urut = k.urut + 1;
  const id = m.id ?? `pesan-${urut}`;
  const lama = lamaPesan(m);
  const baru: Pesan = {
    id,
    jenis: m.jenis,
    teks: m.teks,
    ...(m.keterangan ? { keterangan: m.keterangan } : {}),
    ...(m.aksi ? { aksi: m.aksi } : {}),
    ...(m.tautan ? { tautan: m.tautan } : {}),
    urut,
    sampai: lama === null ? null : sekarang + lama,
  };
  return { ...k, urut, pesan: [...k.pesan.filter((p) => p.id !== id), baru] };
}

export function tutupPesan(k: KeadaanPulau, id: string): KeadaanPulau {
  if (!k.pesan.some((p) => p.id === id)) return k;
  return { ...k, pesan: k.pesan.filter((p) => p.id !== id) };
}

function batasiPersen(persen: number): number {
  if (!Number.isFinite(persen)) return 0;
  return Math.min(100, Math.max(0, Math.round(persen)));
}

export function mulaiProses(k: KeadaanPulau, id: string, label: string): KeadaanPulau {
  const ada = k.proses.find((p) => p.id === id);
  if (ada) {
    return { ...k, proses: k.proses.map((p) => (p.id === id ? { ...p, label } : p)) };
  }
  const urut = k.urut + 1;
  return { ...k, urut, proses: [...k.proses, { id, label, persen: null, urut }] };
}

export function perbaruiProses(k: KeadaanPulau, id: string, persen: number | null, label?: string): KeadaanPulau {
  const nilai = persen === null ? null : batasiPersen(persen);
  if (!k.proses.some((p) => p.id === id)) {
    if (label === undefined) return k;
    const urut = k.urut + 1;
    return { ...k, urut, proses: [...k.proses, { id, label, persen: nilai, urut }] };
  }
  return {
    ...k,
    proses: k.proses.map((p) => (p.id === id ? { ...p, persen: nilai, ...(label !== undefined ? { label } : {}) } : p)),
  };
}

function buangProses(k: KeadaanPulau, id: string): KeadaanPulau {
  if (!k.proses.some((p) => p.id === id)) return k;
  return { ...k, proses: k.proses.filter((p) => p.id !== id) };
}

/** Proses selesai; dengan `teks` menjadi pesan sukses, tanpa teks hilang diam-diam. */
export function selesaiProses(k: KeadaanPulau, id: string, teks: string | undefined, sekarang: number): KeadaanPulau {
  const tanpa = buangProses(k, id);
  return teks ? tambahPesan(tanpa, { id: `proses:${id}`, jenis: "sukses", teks }, sekarang) : tanpa;
}

export function gagalProses(k: KeadaanPulau, id: string, teks: string, sekarang: number): KeadaanPulau {
  return tambahPesan(buangProses(k, id), { id: `proses:${id}`, jenis: "galat", teks }, sekarang);
}

export function kabarNotifikasi(k: KeadaanPulau, m: MasukanNotifikasi, sekarang: number): KeadaanPulau {
  const jumlah = (k.notifikasi?.jumlah ?? 0) + Math.max(1, Math.floor(m.jumlah ?? 1));
  const tujuan = jumlah > 1 && m.semua ? m.semua : m;
  return {
    ...k,
    notifikasi: {
      judul: m.judul,
      tautan: tujuan.tautan ?? null,
      jumlah,
      ...(tujuan.diketuk ? { diketuk: tujuan.diketuk } : {}),
      sampai: sekarang + DURASI.notifikasi,
    },
  };
}

export function tutupNotifikasi(k: KeadaanPulau): KeadaanPulau {
  return k.notifikasi ? { ...k, notifikasi: null } : k;
}

export function aturLuring(k: KeadaanPulau, m: MasukanLuring, sekarang: number): KeadaanPulau {
  const belumTerkirim = Math.max(0, Math.floor(m.belumTerkirim));
  let selesai = k.luring.selesai;
  if (m.luring || m.mengirim) {
    selesai = null;
  } else if (k.luring.mengirim) {
    // Pengiriman baru saja berhenti: kilaskan hasilnya.
    selesai = { sisa: belumTerkirim, sampai: sekarang + (belumTerkirim === 0 ? DURASI.terkirim : DURASI.sisa) };
  }
  const l = k.luring;
  if (
    l.luring === m.luring &&
    l.belumTerkirim === belumTerkirim &&
    l.mengirim === m.mengirim &&
    l.tautan === m.tautan &&
    l.kirimUlang === m.kirimUlang &&
    l.selesai === selesai
  ) {
    // Pemantau melapor berkala; laporan yang sama tidak membuat render baru.
    return k;
  }
  return {
    ...k,
    luring: {
      luring: m.luring,
      belumTerkirim,
      mengirim: m.mengirim,
      ...(m.tautan ? { tautan: m.tautan } : {}),
      ...(m.kirimUlang ? { kirimUlang: m.kirimUlang } : {}),
      selesai,
    },
  };
}

/** Buang semua yang sudah lewat waktunya. Mengembalikan objek yang sama bila tidak ada yang berubah. */
export function rapikan(k: KeadaanPulau, sekarang: number): KeadaanPulau {
  const pesan = k.pesan.filter((p) => p.sampai === null || p.sampai > sekarang);
  const notifikasiHabis = k.notifikasi !== null && k.notifikasi.sampai <= sekarang;
  const selesaiHabis = k.luring.selesai !== null && k.luring.selesai.sampai <= sekarang;
  if (pesan.length === k.pesan.length && !notifikasiHabis && !selesaiHabis) return k;
  return {
    ...k,
    pesan,
    notifikasi: notifikasiHabis ? null : k.notifikasi,
    luring: selesaiHabis ? { ...k.luring, selesai: null } : k.luring,
  };
}

/** Kapan sesuatu berikutnya hilang sendiri (ms epoch), atau null. */
export function kedaluwarsaBerikutnya(k: KeadaanPulau): number | null {
  const waktu: number[] = [];
  for (const p of k.pesan) if (p.sampai !== null) waktu.push(p.sampai);
  if (k.notifikasi) waktu.push(k.notifikasi.sampai);
  if (k.luring.selesai) waktu.push(k.luring.selesai.sampai);
  return waktu.length > 0 ? Math.min(...waktu) : null;
}

function terbaru<T extends { urut: number }>(daftar: T[]): T | null {
  let pilih: T | null = null;
  for (const x of daftar) if (!pilih || x.urut > pilih.urut) pilih = x;
  return pilih;
}

function butirPesan(daftar: Pesan[]): ButirTampilan | null {
  const p = terbaru(daftar);
  if (!p) return null;
  return {
    kunci: `pesan:${p.id}`,
    jenis: p.jenis,
    teks: p.teks,
    ...(p.keterangan ? { keterangan: p.keterangan } : {}),
    ...(p.aksi ? { aksi: p.aksi } : {}),
    tautan: p.tautan ?? null,
    tambahan: daftar.length - 1,
    bisaDitutup: true,
    peran: p.jenis === "galat" ? "alert" : "status",
  };
}

function butirProses(daftar: Proses[]): ButirTampilan | null {
  const p = terbaru(daftar);
  if (!p) return null;
  return {
    kunci: `proses:${p.id}`,
    jenis: "proses",
    teks: p.label,
    persen: p.persen,
    tambahan: daftar.length - 1,
    bisaDitutup: false,
    peran: "status",
  };
}

function butirLuring(l: Luring): ButirTampilan | null {
  const dasar = { teks: "", tambahan: 0, peran: "status" as const };
  if (l.luring) {
    return {
      ...dasar,
      kunci: "luring",
      jenis: "luring",
      jumlah: l.belumTerkirim,
      tautan: l.belumTerkirim > 0 ? (l.tautan ?? null) : null,
      bisaDitutup: false,
    };
  }
  if (l.mengirim) {
    return { ...dasar, kunci: "luring", jenis: "mengirim", jumlah: l.belumTerkirim, bisaDitutup: false };
  }
  if (l.selesai) {
    return {
      ...dasar,
      kunci: "luring",
      jenis: l.selesai.sisa === 0 ? "terkirim" : "sisa",
      jumlah: l.selesai.sisa,
      tautan: l.selesai.sisa > 0 ? (l.tautan ?? null) : null,
      bisaDitutup: true,
    };
  }
  return null;
}

function butirTertunda(l: Luring): ButirTampilan | null {
  if (l.luring || l.mengirim || l.selesai || l.belumTerkirim === 0 || !l.kirimUlang) return null;
  return {
    kunci: "luring",
    jenis: "tertunda",
    teks: "",
    jumlah: l.belumTerkirim,
    diketuk: l.kirimUlang,
    tambahan: 0,
    bisaDitutup: false,
    peran: "status",
  };
}

function butirNotifikasi(n: Notifikasi | null): ButirTampilan | null {
  if (!n) return null;
  return {
    kunci: "notifikasi",
    jenis: "notifikasi",
    teks: n.judul,
    jumlah: n.jumlah,
    tautan: n.tautan,
    ...(n.diketuk ? { diketuk: n.diketuk } : {}),
    tambahan: 0,
    bisaDitutup: true,
    peran: "status",
  };
}

/** Isi kapsul menurut tingkat, plus gelembung untuk tingkat aktif berikutnya. */
export function tampilan(k: KeadaanPulau): Tampilan | null {
  const tingkat: (ButirTampilan | null)[] = [
    butirPesan(k.pesan.filter((p) => p.jenis === "galat")),
    butirProses(k.proses),
    butirLuring(k.luring),
    butirNotifikasi(k.notifikasi),
    butirPesan(k.pesan.filter((p) => p.jenis !== "galat")),
    butirTertunda(k.luring),
  ];
  const aktif = tingkat.filter((b): b is ButirTampilan => b !== null);
  if (aktif.length === 0) return null;
  return { utama: aktif[0], kedua: aktif[1] ?? null };
}

/** Pengguna mengetuk kapsul untuk menutupnya. Proses dan keadaan luring tidak bisa ditutup. */
export function tutupTampilan(k: KeadaanPulau, butir: ButirTampilan): KeadaanPulau {
  if (!butir.bisaDitutup) return k;
  if (butir.kunci.startsWith("pesan:")) return tutupPesan(k, butir.kunci.slice("pesan:".length));
  if (butir.kunci === "notifikasi") return tutupNotifikasi(k);
  if (butir.kunci === "luring" && k.luring.selesai) return { ...k, luring: { ...k.luring, selesai: null } };
  return k;
}
