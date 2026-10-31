/**
 * Daftar periksa display toko — murni, satu tempat untuk HP (mengisi), server
 * (menyimpan & menilai) dan kantor (menyusun template & membaca laporan).
 *
 * Elorae menjual PAKAIAN yang digantung di rak, sering di pojok merek sendiri di
 * dalam toko multi-merek. Yang dinilai karena itu hal yang bisa dilihat
 * salesman dengan mata: pojok rapi, ukuran lengkap di rak, materi promosi dan
 * label harga terpasang, berapa rak yang diberikan toko, dan fotonya.
 *
 * Skor DIHITUNG DI SERVER dari jawaban, tidak pernah dikirim HP. Hasil yang
 * tersimpan membawa RINCIAN per pertanyaan (teks, bobot, poin) sebagaimana
 * pertanyaannya saat diisi: template boleh diubah kemudian, dan laporan lama
 * tidak boleh ikut berubah artinya.
 */

export const JENIS_PERTANYAAN = ["YA_TIDAK", "SKALA_1_5", "ANGKA", "FOTO", "TEKS"] as const;
export type JenisPertanyaan = (typeof JENIS_PERTANYAAN)[number];

export const BATAS_CHECKLIST = {
  nama: 100,
  pertanyaan: 40,
  teks: 200,
  petunjuk: 300,
  bobotMaks: 100,
  angkaMaks: 100_000,
  jawabanTeks: 500,
  fotoPerPertanyaan: 5,
  idFoto: 100,
} as const;

export type JenisToko = "PUTUS" | "KONSI";

export type PertanyaanChecklist = {
  /** Stabil antar-perubahan template — laporan "pertanyaan terlemah" mengelompokkan per id. */
  id: string;
  teks: string;
  jenis: JenisPertanyaan;
  /** 0 untuk TEKS (informasi, tidak dinilai). */
  bobot: number;
  wajib: boolean;
  /** Hanya ANGKA: nilai yang dianggap penuh (mis. 2 rak). */
  target: number | null;
  petunjuk: string | null;
};

export function adalahJenisPertanyaan(x: unknown): x is JenisPertanyaan {
  return typeof x === "string" && (JENIS_PERTANYAAN as readonly string[]).includes(x);
}

export function jenisBerskor(j: JenisPertanyaan): boolean {
  return j !== "TEKS";
}

// ─── Template ────────────────────────────────────────────────────────────────

export type KodeTolakTemplate =
  | "NAMA_WAJIB"
  | "NAMA_TERLALU_PANJANG"
  | "JENIS_TOKO_TIDAK_SAH"
  | "TANPA_PERTANYAAN"
  | "TERLALU_BANYAK_PERTANYAAN"
  | "PERTANYAAN_TIDAK_SAH"
  | "ID_GANDA"
  | "TEKS_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "JENIS_TIDAK_SAH"
  | "BOBOT_TIDAK_SAH"
  | "TARGET_TIDAK_SAH"
  | "TANPA_SKOR";

export type TemplateSah = { nama: string; termsType: JenisToko | null; pertanyaan: PertanyaanChecklist[] };

export type HasilPeriksaTemplate =
  | { ok: true; nilai: TemplateSah }
  | { ok: false; kode: KodeTolakTemplate; indeks?: number };

const POLA_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Rapikan spasi: teks bebas yang diketik di HP sering membawa spasi ganda. */
const rapi = (s: string) => s.trim().replace(/\s+/g, " ");

type PeriksaSatu = { ok: true; nilai: PertanyaanChecklist } | { ok: false; kode: KodeTolakTemplate };

function periksaPertanyaan(raw: unknown): PeriksaSatu {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, kode: "PERTANYAAN_TIDAK_SAH" };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !POLA_ID.test(o.id)) return { ok: false, kode: "PERTANYAAN_TIDAK_SAH" };
  const teks = typeof o.teks === "string" ? rapi(o.teks) : "";
  if (!teks) return { ok: false, kode: "TEKS_WAJIB" };
  if (teks.length > BATAS_CHECKLIST.teks) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  if (!adalahJenisPertanyaan(o.jenis)) return { ok: false, kode: "JENIS_TIDAK_SAH" };
  const jenis = o.jenis;

  let bobot = 0;
  if (jenisBerskor(jenis)) {
    const b = o.bobot;
    if (typeof b !== "number" || !Number.isInteger(b) || b < 1 || b > BATAS_CHECKLIST.bobotMaks) {
      return { ok: false, kode: "BOBOT_TIDAK_SAH" };
    }
    bobot = b;
  }

  let target: number | null = null;
  if (jenis === "ANGKA") {
    const t = o.target;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > BATAS_CHECKLIST.angkaMaks) {
      return { ok: false, kode: "TARGET_TIDAK_SAH" };
    }
    target = t;
  }

  let petunjuk: string | null = null;
  if (typeof o.petunjuk === "string") {
    const p = rapi(o.petunjuk);
    if (p.length > BATAS_CHECKLIST.petunjuk) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
    petunjuk = p || null;
  }

  return { ok: true, nilai: { id: o.id, teks, jenis, bobot, wajib: o.wajib === true, target, petunjuk } };
}

/** Periksa template kiriman kantor. Menolak di pertanyaan PERTAMA yang salah, dengan indeksnya. */
export function periksaTemplate(raw: unknown): HasilPeriksaTemplate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, kode: "NAMA_WAJIB" };
  const o = raw as Record<string, unknown>;
  const nama = typeof o.nama === "string" ? rapi(o.nama) : "";
  if (!nama) return { ok: false, kode: "NAMA_WAJIB" };
  if (nama.length > BATAS_CHECKLIST.nama) return { ok: false, kode: "NAMA_TERLALU_PANJANG" };

  let termsType: JenisToko | null = null;
  if (o.termsType !== null && o.termsType !== undefined && o.termsType !== "") {
    if (o.termsType !== "PUTUS" && o.termsType !== "KONSI") return { ok: false, kode: "JENIS_TOKO_TIDAK_SAH" };
    termsType = o.termsType;
  }

  if (!Array.isArray(o.pertanyaan) || o.pertanyaan.length === 0) return { ok: false, kode: "TANPA_PERTANYAAN" };
  if (o.pertanyaan.length > BATAS_CHECKLIST.pertanyaan) return { ok: false, kode: "TERLALU_BANYAK_PERTANYAAN" };

  const pertanyaan: PertanyaanChecklist[] = [];
  const terlihat = new Set<string>();
  for (let i = 0; i < o.pertanyaan.length; i++) {
    const r = periksaPertanyaan(o.pertanyaan[i]);
    if (!r.ok) return { ok: false, kode: r.kode, indeks: i };
    if (terlihat.has(r.nilai.id)) return { ok: false, kode: "ID_GANDA", indeks: i };
    terlihat.add(r.nilai.id);
    pertanyaan.push(r.nilai);
  }
  // Template tanpa satu pun pertanyaan bernilai menghasilkan skor 0/0 di setiap
  // kunjungan — laporannya kosong tanpa ada yang tahu kenapa.
  if (!pertanyaan.some((p) => jenisBerskor(p.jenis))) return { ok: false, kode: "TANPA_SKOR" };

  return { ok: true, nilai: { nama, termsType, pertanyaan } };
}

/**
 * Pertanyaan dari kolom JSON tersimpan. Toleran: baris yang rusak dibuang, bukan
 * membuat seluruh daftar periksa tidak bisa dibuka di lapangan.
 */
export function bacaPertanyaan(json: unknown): PertanyaanChecklist[] {
  if (!Array.isArray(json)) return [];
  const hasil: PertanyaanChecklist[] = [];
  const terlihat = new Set<string>();
  for (const x of json) {
    const r = periksaPertanyaan(x);
    if (!r.ok || terlihat.has(r.nilai.id)) continue;
    terlihat.add(r.nilai.id);
    hasil.push(r.nilai);
  }
  return hasil;
}

/**
 * Template bawaan untuk pakaian — TIDAK disimpan di basis data. Kantor
 * menyalinnya ke penyunting ("Salin template bawaan"), menyesuaikan, lalu
 * menyimpannya sebagai template sendiri. Teks pertanyaannya ada di i18n
 * (`checklistToko.bawaan.<kunci>`) supaya mengikuti bahasa orang yang menyalin.
 *
 * Bobot berjumlah 100 supaya skor terbaca langsung sebagai persen.
 */
export const TEMPLATE_BAWAAN = {
  kunciNama: "nama",
  pertanyaan: [
    { id: "pojok_rapi", kunci: "pojok_rapi", jenis: "YA_TIDAK", bobot: 20, wajib: true, target: null },
    { id: "ukuran_lengkap", kunci: "ukuran_lengkap", jenis: "SKALA_1_5", bobot: 20, wajib: true, target: null },
    { id: "materi_promosi", kunci: "materi_promosi", jenis: "YA_TIDAK", bobot: 15, wajib: true, target: null },
    { id: "label_harga", kunci: "label_harga", jenis: "YA_TIDAK", bobot: 15, wajib: true, target: null },
    { id: "jumlah_rak", kunci: "jumlah_rak", jenis: "ANGKA", bobot: 10, wajib: true, target: 2 },
    { id: "pesaing_sebelah", kunci: "pesaing_sebelah", jenis: "TEKS", bobot: 0, wajib: false, target: null },
    { id: "foto_display", kunci: "foto_display", jenis: "FOTO", bobot: 20, wajib: true, target: null },
  ] as ReadonlyArray<{
    id: string;
    kunci: string;
    jenis: JenisPertanyaan;
    bobot: number;
    wajib: boolean;
    target: number | null;
  }>,
} as const;

/** Template yang bisa dipakai di toko berjenis ini: aktif, dan untuk semua jenis atau jenis yang sama. */
export function templateBerlaku<T extends { termsType: string | null; isActive: boolean }>(daftar: T[], termsType: JenisToko): T[] {
  return daftar.filter((t) => t.isActive && (t.termsType === null || t.termsType === termsType));
}

// ─── Jawaban & skor ──────────────────────────────────────────────────────────

/** YA_TIDAK: boolean · SKALA_1_5: 1–5 · ANGKA: ≥ 0 · FOTO: id foto kunjungan (clientId) · TEKS: teks. */
export type NilaiJawaban = boolean | number | string | string[];
export type JawabanChecklist = Record<string, NilaiJawaban>;

export type HasilBacaJawaban =
  | { ok: true; jawaban: JawabanChecklist }
  | { ok: false; kode: "JAWABAN_TIDAK_SAH" | "WAJIB_DIJAWAB"; pertanyaanId: string };

function kosong(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Nilai jawaban yang sah untuk pertanyaan ini, atau undefined bila tidak sah. */
function nilaiSah(p: PertanyaanChecklist, v: unknown): NilaiJawaban | undefined {
  switch (p.jenis) {
    case "YA_TIDAK":
      return typeof v === "boolean" ? v : undefined;
    case "SKALA_1_5":
      return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : undefined;
    case "ANGKA":
      return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= BATAS_CHECKLIST.angkaMaks ? v : undefined;
    case "FOTO": {
      if (!Array.isArray(v)) return undefined;
      if (!v.every((x) => typeof x === "string" && x.length > 0 && x.length <= BATAS_CHECKLIST.idFoto)) return undefined;
      const unik = [...new Set(v as string[])];
      return unik.length <= BATAS_CHECKLIST.fotoPerPertanyaan ? unik : undefined;
    }
    case "TEKS": {
      if (typeof v !== "string") return undefined;
      const t = v.trim();
      return t.length <= BATAS_CHECKLIST.jawabanTeks ? t : undefined;
    }
  }
}

/** Periksa jawaban kiriman HP terhadap pertanyaan template. Kunci asing dibuang. */
export function bacaJawaban(pertanyaan: PertanyaanChecklist[], raw: unknown): HasilBacaJawaban {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: "" };
  const o = raw as Record<string, unknown>;
  const jawaban: JawabanChecklist = {};
  for (const p of pertanyaan) {
    const v = o[p.id];
    if (kosong(v)) {
      if (p.wajib) return { ok: false, kode: "WAJIB_DIJAWAB", pertanyaanId: p.id };
      continue;
    }
    const sah = nilaiSah(p, v);
    if (sah === undefined) return { ok: false, kode: "JAWABAN_TIDAK_SAH", pertanyaanId: p.id };
    jawaban[p.id] = sah;
  }
  return { ok: true, jawaban };
}

/** Poin mentah (belum dibulatkan) satu pertanyaan. Jawaban yang tidak cocok = nol. */
export function poinPertanyaan(p: PertanyaanChecklist, v: unknown): number {
  switch (p.jenis) {
    case "YA_TIDAK":
      return v === true ? p.bobot : 0;
    case "SKALA_1_5":
      return typeof v === "number" && v >= 1 && v <= 5 ? ((v - 1) / 4) * p.bobot : 0;
    case "ANGKA":
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || !p.target) return 0;
      return Math.min(v / p.target, 1) * p.bobot;
    case "FOTO":
      return Array.isArray(v) && v.length > 0 ? p.bobot : 0;
    case "TEKS":
      return 0;
  }
}

export type RincianPertanyaan = {
  id: string;
  teks: string;
  jenis: JenisPertanyaan;
  bobot: number;
  /** Dibulatkan dua desimal — untuk tampilan dan laporan. */
  poin: number;
  maks: number;
  jawaban: NilaiJawaban | null;
};

/** Persen dari skor TERSIMPAN (bulat) — satu rumus untuk layar HP dan laporan kantor. */
export function persenSkor(score: number, maxScore: number): number | null {
  return maxScore > 0 ? Math.round((score * 100) / maxScore) : null;
}

const duaDesimal = (x: number) => Math.round(x * 100) / 100;

/**
 * Skor = jumlah poin mentah, dibulatkan SEKALI di akhir (pembulatan per
 * pertanyaan menggelembungkan skor template berbobot kecil). Pertanyaan yang
 * tidak dijawab bernilai nol tapi tetap masuk skor maksimum: rak yang tidak
 * difoto adalah rak yang tidak terbukti, bukan rak yang dikecualikan.
 */
export function hitungSkor(pertanyaan: PertanyaanChecklist[], jawaban: JawabanChecklist) {
  let mentah = 0;
  let maxScore = 0;
  const rincian: RincianPertanyaan[] = pertanyaan.map((p) => {
    const v = jawaban[p.id];
    const poin = poinPertanyaan(p, v);
    const maks = jenisBerskor(p.jenis) ? p.bobot : 0;
    mentah += poin;
    maxScore += maks;
    return { id: p.id, teks: p.teks, jenis: p.jenis, bobot: p.bobot, poin: duaDesimal(poin), maks, jawaban: v ?? null };
  });
  const score = Math.round(mentah);
  return { score, maxScore, persen: persenSkor(score, maxScore), rincian };
}

// ─── Bentuk tersimpan (VisitChecklistResult.answers) ─────────────────────────

export type SimpananChecklist = { versi: 1; jawaban: JawabanChecklist; rincian: RincianPertanyaan[] };

export function bentukSimpanan(jawaban: JawabanChecklist, rincian: RincianPertanyaan[]): SimpananChecklist {
  return { versi: 1, jawaban, rincian };
}

function bacaRincian(x: unknown): RincianPertanyaan | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.teks !== "string" ||
    !adalahJenisPertanyaan(o.jenis) ||
    typeof o.bobot !== "number" ||
    typeof o.poin !== "number" ||
    typeof o.maks !== "number"
  ) {
    return null;
  }
  const j = o.jawaban;
  const jawaban =
    typeof j === "boolean" || typeof j === "number" || typeof j === "string"
      ? j
      : Array.isArray(j) && j.every((s) => typeof s === "string")
        ? (j as string[])
        : null;
  return { id: o.id, teks: o.teks, jenis: o.jenis, bobot: o.bobot, poin: o.poin, maks: o.maks, jawaban };
}

/** Baca kolom `answers`. Toleran: JSON rusak dibaca kosong, bukan membuat laporan gagal dibuka. */
export function bacaSimpanan(json: unknown): { jawaban: JawabanChecklist; rincian: RincianPertanyaan[]; fotoIds: string[] } {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const jawaban =
    o.jawaban && typeof o.jawaban === "object" && !Array.isArray(o.jawaban) ? (o.jawaban as JawabanChecklist) : {};
  const rincian = Array.isArray(o.rincian)
    ? o.rincian.map(bacaRincian).filter((r): r is RincianPertanyaan => r !== null)
    : [];
  const fotoIds = rincian.flatMap((r) =>
    r.jenis === "FOTO" && Array.isArray(r.jawaban) ? r.jawaban : [],
  );
  return { jawaban, rincian, fotoIds };
}

// ─── Panduan display ─────────────────────────────────────────────────────────

/**
 * Panduan display berlaku di toko ini sekarang? Jenis toko dan area yang
 * kosong berarti "semua". `activeTo` disimpan sebagai AKHIR hari WIB (inklusif),
 * `activeFrom` sebagai awal hari WIB.
 */
export function panduanBerlaku(
  p: { isActive: boolean; termsType: string | null; groupId: string | null; activeFrom: Date | null; activeTo: Date | null },
  toko: { termsType: JenisToko; groupId: string | null },
  sekarang: Date,
): boolean {
  if (!p.isActive) return false;
  if (p.termsType !== null && p.termsType !== toko.termsType) return false;
  if (p.groupId !== null && p.groupId !== toko.groupId) return false;
  if (p.activeFrom && p.activeFrom.getTime() > sekarang.getTime()) return false;
  if (p.activeTo && p.activeTo.getTime() < sekarang.getTime()) return false;
  return true;
}

export const BATAS_PANDUAN = { judul: 120, isi: 4000 } as const;

export type KodeTolakPanduan =
  | "JUDUL_WAJIB"
  | "ISI_WAJIB"
  | "TEKS_TERLALU_PANJANG"
  | "GAMBAR_TIDAK_SAH"
  | "JENIS_TOKO_TIDAK_SAH"
  | "AREA_TIDAK_SAH"
  | "TANGGAL_TIDAK_SAH"
  | "TANGGAL_TERBALIK";

export type PanduanSah = {
  judul: string;
  isi: string;
  gambarUrl: string | null;
  termsType: JenisToko | null;
  groupId: string | null;
  /** YYYY-MM-DD (hari WIB) — diubah jadi instan oleh pemanggil. */
  mulai: string | null;
  selesai: string | null;
};

/** Gambar hanya dari unggahan sendiri — URL luar akan dimuat di HP setiap salesman. */
const POLA_FOTO_SENDIRI = /^\/api\/foto\/[A-Za-z0-9_-]{1,64}$/;

/** YYYY-MM-DD yang sungguh ada di kalender (2026-02-30 ditolak). */
function tanggalSah(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function periksaPanduan(raw: unknown): { ok: true; nilai: PanduanSah } | { ok: false; kode: KodeTolakPanduan } {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const judul = typeof o.judul === "string" ? rapi(o.judul) : "";
  if (!judul) return { ok: false, kode: "JUDUL_WAJIB" };
  // Isi panduan boleh berbaris (langkah 1, 2, 3) — hanya ujungnya yang dirapikan.
  const isi = typeof o.isi === "string" ? o.isi.trim() : "";
  if (!isi) return { ok: false, kode: "ISI_WAJIB" };
  if (judul.length > BATAS_PANDUAN.judul || isi.length > BATAS_PANDUAN.isi) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };

  let gambarUrl: string | null = null;
  if (o.gambarUrl !== undefined && o.gambarUrl !== null && o.gambarUrl !== "") {
    if (typeof o.gambarUrl !== "string" || !POLA_FOTO_SENDIRI.test(o.gambarUrl)) return { ok: false, kode: "GAMBAR_TIDAK_SAH" };
    gambarUrl = o.gambarUrl;
  }

  let termsType: JenisToko | null = null;
  if (o.termsType !== undefined && o.termsType !== null && o.termsType !== "") {
    if (o.termsType !== "PUTUS" && o.termsType !== "KONSI") return { ok: false, kode: "JENIS_TOKO_TIDAK_SAH" };
    termsType = o.termsType;
  }

  let groupId: string | null = null;
  if (o.groupId !== undefined && o.groupId !== null && o.groupId !== "") {
    if (typeof o.groupId !== "string" || o.groupId.length > 64) return { ok: false, kode: "AREA_TIDAK_SAH" };
    groupId = o.groupId;
  }

  const tgl = (x: unknown): string | null | false => {
    if (x === undefined || x === null || x === "") return null;
    return typeof x === "string" && tanggalSah(x) ? x : false;
  };
  const mulai = tgl(o.mulai);
  const selesai = tgl(o.selesai);
  if (mulai === false || selesai === false) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (mulai && selesai && selesai < mulai) return { ok: false, kode: "TANGGAL_TERBALIK" };

  return { ok: true, nilai: { judul, isi, gambarUrl, termsType, groupId, mulai, selesai } };
}

// ─── Laporan ─────────────────────────────────────────────────────────────────

export type HasilUntukLaporan = {
  id: string;
  storeId: string;
  templateId: string;
  /** Waktu kunjungan (check-in) — urutan tren mengikuti kunjungan, bukan jam kirim. */
  tanggal: Date;
  score: number;
  maxScore: number;
  persen: number | null;
  rincian: RincianPertanyaan[];
};

export type RingkasTokoChecklist = {
  storeId: string;
  templateId: string;
  terakhir: HasilUntukLaporan;
  /** Persen lima hasil terakhir, lama → baru. */
  tren: (number | null)[];
  jumlah: number;
};

/**
 * Satu baris per toko × template. Dua template berbeda tidak dicampur dalam
 * satu tren — skornya mengukur hal yang berbeda. Diurutkan dari skor terakhir
 * TERENDAH: laporan ini dibuka untuk mencari toko yang perlu didatangi.
 */
export function ringkasPerToko(hasil: HasilUntukLaporan[], maksTren = 5): RingkasTokoChecklist[] {
  const grup = new Map<string, HasilUntukLaporan[]>();
  for (const h of hasil) {
    const k = `${h.storeId} ${h.templateId}`;
    const g = grup.get(k);
    if (g) g.push(h);
    else grup.set(k, [h]);
  }
  const baris: RingkasTokoChecklist[] = [];
  for (const g of grup.values()) {
    const urut = [...g].sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
    const terakhir = urut[urut.length - 1];
    baris.push({
      storeId: terakhir.storeId,
      templateId: terakhir.templateId,
      terakhir,
      tren: urut.slice(-maksTren).map((h) => h.persen),
      jumlah: urut.length,
    });
  }
  return baris.sort((a, b) => {
    const pa = a.terakhir.persen;
    const pb = b.terakhir.persen;
    if (pa === null && pb === null) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  });
}

export type PertanyaanLemah = {
  templateId: string;
  id: string;
  /** Teks dari hasil TERBARU — pertanyaan yang diubah redaksinya tetap satu baris. */
  teks: string;
  jenis: JenisPertanyaan;
  persen: number;
  jumlah: number;
};

/** Pertanyaan dengan capaian gabungan terendah (Σ poin / Σ maks). TEKS tidak dinilai, jadi tidak ikut. */
export function pertanyaanTerlemah(hasil: HasilUntukLaporan[]): PertanyaanLemah[] {
  const urut = [...hasil].sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
  const grup = new Map<string, { templateId: string; id: string; teks: string; jenis: JenisPertanyaan; poin: number; maks: number; jumlah: number }>();
  for (const h of urut) {
    for (const r of h.rincian) {
      if (r.maks <= 0) continue;
      const k = `${h.templateId} ${r.id}`;
      const g = grup.get(k);
      if (g) {
        g.poin += r.poin;
        g.maks += r.maks;
        g.jumlah += 1;
        g.teks = r.teks;
        g.jenis = r.jenis;
      } else {
        grup.set(k, { templateId: h.templateId, id: r.id, teks: r.teks, jenis: r.jenis, poin: r.poin, maks: r.maks, jumlah: 1 });
      }
    }
  }
  return [...grup.values()]
    .map((g) => ({
      templateId: g.templateId,
      id: g.id,
      teks: g.teks,
      jenis: g.jenis,
      persen: Math.round((g.poin * 100) / g.maks),
      jumlah: g.jumlah,
    }))
    .sort((a, b) => a.persen - b.persen || b.jumlah - a.jumlah);
}

// ─── Rentang laporan ─────────────────────────────────────────────────────────

export const HARI_LAPORAN_BAWAAN = 90;

const hariWib = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Rentang tanggal laporan dari isian alamat (YYYY-MM-DD, hari WIB). Bawaan:
 * 90 hari terakhir sampai hari ini. Isian yang rusak jatuh ke bawaan dan yang
 * terbalik ditukar — laporan kosong karena salah ketik tanggal lebih
 * membingungkan daripada laporan yang membetulkan dirinya.
 */
export function rentangLaporan(dari: string | undefined | null, sampai: string | undefined | null, sekarang: Date) {
  const hariIni = hariWib(sekarang);
  const bawaanDari = hariWib(new Date(new Date(`${hariIni}T00:00:00.000+07:00`).getTime() - (HARI_LAPORAN_BAWAAN - 1) * 86_400_000));
  let d = typeof dari === "string" && tanggalSah(dari) ? dari : bawaanDari;
  let s = typeof sampai === "string" && tanggalSah(sampai) ? sampai : hariIni;
  if (s < d) [d, s] = [s, d];
  return {
    dariStr: d,
    sampaiStr: s,
    dari: new Date(`${d}T00:00:00.000+07:00`),
    sampai: new Date(`${s}T23:59:59.999+07:00`),
  };
}
