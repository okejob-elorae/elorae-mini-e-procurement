/**
 * Tahap kolaborasi KOL — murni, aman untuk komponen klien (tanpa Prisma).
 *
 * Satu kolaborasi (baris `KolBrief`, di layar "Kolaborasi") berjalan lewat 13
 * tahap berurutan dan bisa keluar lewat 3 jalur. Aturan pindahnya:
 *   - MAJU boleh melompati tahap, tanpa alasan — pekerjaan lapangan sering
 *     mendahului pencatatannya.
 *   - MUNDUR hanya dengan alasan — mundur berarti ada yang salah dicatat, dan
 *     yang membetulkan harus bisa ditanya kenapa.
 *   - KELUAR (ditolak, ghosting, batal) dari tahap aktif mana pun, alasan wajib.
 *   - Dari jalur keluar hanya "buka lagi" ke PROSPEK/DIHUBUNGI, dengan alasan.
 *     Menghidupkan langsung ke tengah alur melewati semua pemeriksaan di
 *     depannya (alamat, sampel, draf).
 */

export type Tahap =
  | "PROSPEK"
  | "DIHUBUNGI"
  | "NEGO"
  | "DEAL"
  | "BRIEF_DIKIRIM"
  | "SAMPEL_DIKIRIM"
  | "SAMPEL_DITERIMA"
  | "DRAF"
  | "DRAF_DISETUJUI"
  | "TAYANG"
  | "ANGKA_MASUK"
  | "DIBAYAR"
  | "SELESAI"
  | "DITOLAK"
  | "GHOSTING"
  | "BATAL";

export type JenisKerjaSama = "BARTER" | "BAYAR" | "CAMPURAN" | "KOMISI";
export type StatusBayar = "TIDAK_PERLU" | "BELUM" | "SEBAGIAN" | "LUNAS";
export type StatusDraf = "MENUNGGU" | "REVISI" | "DISETUJUI";
export type JenisAgenda = "TUGAS" | "MEETING" | "DEADLINE" | "KIRIM" | "KONTEN" | "BAYAR" | "LAINNYA";

/** 13 tahap jalan, berurutan. */
export const URUTAN_TAHAP = [
  "PROSPEK",
  "DIHUBUNGI",
  "NEGO",
  "DEAL",
  "BRIEF_DIKIRIM",
  "SAMPEL_DIKIRIM",
  "SAMPEL_DITERIMA",
  "DRAF",
  "DRAF_DISETUJUI",
  "TAYANG",
  "ANGKA_MASUK",
  "DIBAYAR",
  "SELESAI",
] as const satisfies readonly Tahap[];

/** Tiga jalur keluar. */
export const JALUR_KELUAR = ["DITOLAK", "GHOSTING", "BATAL"] as const satisfies readonly Tahap[];

export const SEMUA_TAHAP: readonly Tahap[] = [...URUTAN_TAHAP, ...JALUR_KELUAR];

/** Tahap yang masih "berjalan": urutan tanpa SELESAI. Kolom papan dan angka "kolaborasi berjalan". */
export const TAHAP_BERJALAN: readonly Tahap[] = URUTAN_TAHAP.filter((t) => t !== "SELESAI");

export const SEMUA_JENIS_KERJA_SAMA: readonly JenisKerjaSama[] = ["BARTER", "BAYAR", "CAMPURAN", "KOMISI"];
export const SEMUA_STATUS_BAYAR: readonly StatusBayar[] = ["TIDAK_PERLU", "BELUM", "SEBAGIAN", "LUNAS"];
export const SEMUA_STATUS_DRAF: readonly StatusDraf[] = ["MENUNGGU", "REVISI", "DISETUJUI"];
export const SEMUA_JENIS_AGENDA: readonly JenisAgenda[] = ["TUGAS", "MEETING", "DEADLINE", "KIRIM", "KONTEN", "BAYAR", "LAINNYA"];

/**
 * Label bahasa Indonesia untuk teks yang dibuat mesin (rekap, pesan, cetak) —
 * tempat yang tidak punya penerjemah. Layar memakai i18n `kreatifRuang.tahap.*`
 * yang isinya sama.
 */
export const LABEL_TAHAP: Record<Tahap, string> = {
  PROSPEK: "Prospek",
  DIHUBUNGI: "Dihubungi",
  NEGO: "Nego",
  DEAL: "Deal",
  BRIEF_DIKIRIM: "Brief dikirim",
  SAMPEL_DIKIRIM: "Sampel dikirim",
  SAMPEL_DITERIMA: "Sampel diterima",
  DRAF: "Draf masuk",
  DRAF_DISETUJUI: "Draf disetujui",
  TAYANG: "Tayang",
  ANGKA_MASUK: "Angka masuk",
  DIBAYAR: "Dibayar",
  SELESAI: "Selesai",
  DITOLAK: "Ditolak",
  GHOSTING: "Ghosting",
  BATAL: "Batal",
};

const URUTAN_SET: ReadonlySet<Tahap> = new Set(URUTAN_TAHAP);
const KELUAR_SET: ReadonlySet<Tahap> = new Set(JALUR_KELUAR);

export function isJalurKeluar(t: Tahap): boolean {
  return KELUAR_SET.has(t);
}

/** Masih dikerjakan: bukan jalur keluar dan belum SELESAI. */
export function tahapAktif(t: Tahap): boolean {
  return URUTAN_SET.has(t) && t !== "SELESAI";
}

/** Posisi dalam urutan; -1 untuk jalur keluar. */
export function indeksTahap(t: Tahap): number {
  return (URUTAN_TAHAP as readonly Tahap[]).indexOf(t);
}

export function tahapBerikut(t: Tahap): Tahap | null {
  const i = indeksTahap(t);
  if (i < 0 || i >= URUTAN_TAHAP.length - 1) return null;
  return URUTAN_TAHAP[i + 1];
}

export type JenisPindah = "MAJU" | "MUNDUR" | "KELUAR" | "BUKA_LAGI";

/** Jenis perpindahan, atau `null` kalau perpindahannya tidak ada (termasuk ke dirinya sendiri). */
export function jenisPindah(dari: Tahap, ke: Tahap): JenisPindah | null {
  if (dari === ke) return null;
  if (isJalurKeluar(dari)) {
    return ke === "PROSPEK" || ke === "DIHUBUNGI" ? "BUKA_LAGI" : null;
  }
  if (isJalurKeluar(ke)) return tahapAktif(dari) ? "KELUAR" : null;
  return indeksTahap(ke) > indeksTahap(dari) ? "MAJU" : "MUNDUR";
}

/** Apakah perpindahan ini menuntut alasan (dialog alasan di papan/tabel). */
export function butuhAlasan(dari: Tahap, ke: Tahap): boolean {
  const j = jenisPindah(dari, ke);
  return j !== null && j !== "MAJU";
}

export type HasilPindahTahap =
  | { boleh: true; jenis: JenisPindah }
  | { boleh: false; sebab: "SAMA" | "TIDAK_BISA" | "ALASAN_WAJIB" };

export function bolehPindahTahap(dari: Tahap, ke: Tahap, alasan?: string | null): HasilPindahTahap {
  if (dari === ke) return { boleh: false, sebab: "SAMA" };
  const jenis = jenisPindah(dari, ke);
  if (!jenis) return { boleh: false, sebab: "TIDAK_BISA" };
  if (jenis !== "MAJU" && !alasan?.trim()) return { boleh: false, sebab: "ALASAN_WAJIB" };
  return { boleh: true, jenis };
}

/** Semua tujuan yang sah dari sebuah tahap, dalam urutan tampil — untuk pilihan "ubah tahap". */
export function tujuanPindah(dari: Tahap): Tahap[] {
  return SEMUA_TAHAP.filter((ke) => jenisPindah(dari, ke) !== null);
}

/**
 * Fakta lapangan yang boleh memajukan tahap sendiri. Semua opsional; tanggal
 * berupa hari WIB "YYYY-MM-DD".
 */
export type FaktaKolaborasi = {
  /** Ada pengiriman sampel dengan nomor resi. */
  adaResi?: boolean;
  /** Ada pengiriman sampel dengan tanggal terima. */
  adaTerima?: boolean;
  /** Ada konten dengan link draf. */
  adaLinkDraf?: boolean;
  /** Ada draf yang disetujui. */
  drafDisetujui?: boolean;
  /** Ada konten dengan link tayang. */
  adaLinkKonten?: boolean;
  /** Hari WIB konten pertama tayang. */
  tayangHari?: string | null;
  /** Hari WIB angka konten terakhir dicatat. */
  angkaTerakhirHari?: string | null;
  statusBayar?: StatusBayar;
};

/** Hari minimal sesudah tayang agar angka konten dianggap "masuk". */
export const HARI_ANGKA_MATANG = 7;

function tambahHari(teks: string, hari: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(teks);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + hari)).toISOString().slice(0, 10);
}

/** Angka konten tercatat pada hari WIB ≥ tayang + 7. */
export function angkaSudahMatang(
  tayangHari: string | null | undefined,
  angkaHari: string | null | undefined,
  hari: number = HARI_ANGKA_MATANG,
): boolean {
  if (!tayangHari || !angkaHari) return false;
  const batas = tambahHari(tayangHari, hari);
  return batas !== null && angkaHari >= batas;
}

/**
 * Tahap baru yang ditunjuk fakta lapangan, atau `null` kalau tidak bergerak.
 *
 * HANYA maju: fakta yang menunjuk tahap lebih awal dari tahap sekarang
 * diabaikan, karena kolaborasi yang sudah dipindah orang ke depan tidak boleh
 * diseret mundur oleh data lama. Kolaborasi di jalur keluar atau yang sudah
 * SELESAI tidak pernah disentuh.
 *
 * LUNAS baru memajukan ke DIBAYAR sesudah kontennya tayang: fee yang dibayar
 * di depan tidak boleh menyembunyikan kolaborasi dari antrean sampel dan
 * konten. Kolaborasi tanpa fee tidak punya tahap bayar, jadi begitu angkanya
 * masuk ia langsung SELESAI.
 */
export function majuOtomatis(sekarang: Tahap, fakta: FaktaKolaborasi): Tahap | null {
  if (!tahapAktif(sekarang)) return null;

  let target = -1;
  const naik = (t: Tahap) => {
    target = Math.max(target, indeksTahap(t));
  };

  if (fakta.adaResi) naik("SAMPEL_DIKIRIM");
  if (fakta.adaTerima) naik("SAMPEL_DITERIMA");
  if (fakta.adaLinkDraf) naik("DRAF");
  if (fakta.drafDisetujui) naik("DRAF_DISETUJUI");
  if (fakta.adaLinkKonten) naik("TAYANG");
  if (fakta.adaLinkKonten && angkaSudahMatang(fakta.tayangHari, fakta.angkaTerakhirHari)) naik("ANGKA_MASUK");

  const sudahTayang = Math.max(target, indeksTahap(sekarang)) >= indeksTahap("TAYANG");
  if (fakta.statusBayar === "LUNAS" && sudahTayang) naik("DIBAYAR");

  const sudahAngka = Math.max(target, indeksTahap(sekarang)) >= indeksTahap("ANGKA_MASUK");
  if (fakta.statusBayar === "TIDAK_PERLU" && sudahAngka) naik("SELESAI");

  if (target <= indeksTahap(sekarang)) return null;
  return URUTAN_TAHAP[target];
}

/**
 * Sudahkah fee kolaborasi ini boleh dihitung sebagai beban?
 *
 * Fee diakui saat kontennya TAYANG, dan tetap diakui sesudahnya. Kerja sama
 * yang baru dijanjikan bukan beban — bentuknya persis "klaim bukan lunas" di
 * modul piutang.
 */
export function feeDiakui(t: Tahap): boolean {
  return t === "TAYANG" || t === "ANGKA_MASUK" || t === "DIBAYAR" || t === "SELESAI";
}

/** Nilai fee yang boleh masuk laporan biaya. Nol selama belum tayang. */
export function nilaiFeeDiakui(t: Tahap, fee: number): number {
  return feeDiakui(t) ? fee : 0;
}

/** Status bayar awal sebuah kolaborasi: fee nol berarti tidak perlu dibayar. */
export function statusBayarBawaan(fee: number): StatusBayar {
  return Number.isFinite(fee) && fee > 0 ? "BELUM" : "TIDAK_PERLU";
}
