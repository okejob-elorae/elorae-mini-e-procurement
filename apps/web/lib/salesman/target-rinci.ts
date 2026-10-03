import { kunciHariWib } from "@/lib/dashboard/tren";
import { bulanWib } from "./pengaturan";

/**
 * Target sales per kategori dan per barang — aturan murni, tanpa basis data.
 *
 * Target TOTAL bulanan tetap di `SystemSetting["salesman.targets"]` (kartu
 * "Bulan ini" di beranda). Di sini rinciannya: kantor menetapkan, per sales
 * per bulan, berapa NILAI (rupiah) atau berapa PCS yang ingin dicapai untuk
 * satu kategori barang atau satu barang jadi (`SalesTarget`).
 *
 * Capaiannya memakai definisi omzet yang SAMA dengan kartu beranda
 * (`penjualanSalesman`): putus = kiriman, konsi = pesanan konsinyasi yang
 * disetujui, van = penjualan mobil, per hari kalender WIB sampai hari ini.
 * Nilai satu dokumen dibagi ke baris-barisnya sebanding nilai bersih baris
 * (`bagiSen`), dihitung dalam sen bulat — jadi jumlah semua kategori SELALU
 * tepat sama dengan omzet di beranda, termasuk diskon pesanan yang tidak
 * menempel ke baris mana pun.
 */

export const LINGKUP_TARGET = ["KATEGORI", "BARANG"] as const;
export type LingkupTarget = (typeof LINGKUP_TARGET)[number];

export const UKURAN_TARGET = ["NILAI", "PCS"] as const;
export type UkuranTarget = (typeof UKURAN_TARGET)[number];

/** Batas baris per sales per bulan — daftar yang lebih panjang tidak lagi dibaca siapa pun. */
export const MAKS_BARIS_TARGET = 200;

/** `SalesTarget.value` = Decimal(15,2): paling banyak 13 digit di depan koma. */
const NILAI_MAKS = 9_999_999_999_999;

/** Kunci "tanpa kategori" di peta capaian. Id basis data tidak pernah kosong. */
export const TANPA_KATEGORI = "";

export type BarisTarget = { scope: LingkupTarget; refId: string; measure: UkuranTarget; value: number };

export type DaftarDikenal = { kategori: ReadonlySet<string>; barang: ReadonlySet<string> };

// ─── Bulan ────────────────────────────────────────────────────────────────────

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function bulanSah(bulan: unknown): bulan is string {
  return typeof bulan === "string" && POLA_BULAN.test(bulan);
}

function geserBulan(bulan: string, n: number): string {
  const [th, bl] = bulan.split("-").map(Number);
  const d = new Date(Date.UTC(th, bl - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const bulanSebelumnya = (bulan: string) => geserBulan(bulan, -1);
export const bulanBerikutnya = (bulan: string) => geserBulan(bulan, 1);

const awalBulanWib = (bulan: string) => new Date(`${bulan}-01T00:00:00+07:00`);

/**
 * Rentang waktu capaian satu bulan: dari 00.00 WIB tanggal 1 sampai akhir
 * bulan — tetapi tidak melewati akhir HARI INI (WIB). Itu aturan kartu
 * beranda: grafiknya berhenti di hari ini, jadi baris bertanggal sesudah hari
 * ini belum dihitung. `null` = bulan yang belum dimulai.
 */
export function rentangBulanWib(bulan: string, hariIni: Date): { awal: Date; akhir: Date } | null {
  const awal = awalBulanWib(bulan);
  const akhirBulan = awalBulanWib(bulanBerikutnya(bulan));
  const besok = new Date(Date.parse(`${kunciHariWib(hariIni)}T00:00:00+07:00`) + 86_400_000);
  const akhir = besok < akhirBulan ? besok : akhirBulan;
  return akhir > awal ? { awal, akhir } : null;
}

// ─── Validasi ────────────────────────────────────────────────────────────────

export type KodeTolakTarget =
  | "BENTUK_TIDAK_SAH"
  | "TERLALU_BANYAK"
  | "LINGKUP_TIDAK_DIKENAL"
  | "UKURAN_TIDAK_DIKENAL"
  | "NILAI_TIDAK_SAH"
  | "PCS_BUKAN_BULAT"
  | "ACUAN_TIDAK_DIKENAL"
  | "GANDA";

export type HasilPeriksaTarget =
  | { ok: true; baris: BarisTarget[] }
  | { ok: false; kode: KodeTolakTarget; indeks?: number };

/**
 * Satu set target untuk satu sales satu bulan. `dikenal` = kategori yang ada
 * dan barang JADI yang ada (penulis yang mengisinya dari basis data); `null`
 * = periksa bentuknya saja — penulis memakainya sebelum menyentuh basis data,
 * supaya daftar yang rusak atau terlalu panjang tidak sempat jadi kueri.
 *
 * NILAI dibulatkan ke rupiah utuh, sama dengan target total; PCS harus bulat.
 * Satu acuan (kategori atau barang) hanya sekali per bulan — kalau boleh dua,
 * "target kaos 5 juta" dan "target kaos 100 pcs" akan saling membatalkan di
 * kepala salesman.
 */
export function periksaTargetRinci(masuk: unknown, dikenal: DaftarDikenal | null): HasilPeriksaTarget {
  if (!Array.isArray(masuk)) return { ok: false, kode: "BENTUK_TIDAK_SAH" };
  if (masuk.length > MAKS_BARIS_TARGET) return { ok: false, kode: "TERLALU_BANYAK" };

  const baris: BarisTarget[] = [];
  const terpakai = new Set<string>();
  for (let indeks = 0; indeks < masuk.length; indeks++) {
    const b: unknown = masuk[indeks];
    if (!b || typeof b !== "object") return { ok: false, kode: "BENTUK_TIDAK_SAH", indeks };
    const { scope, refId, measure, value } = b as Record<string, unknown>;
    if (!(LINGKUP_TARGET as readonly unknown[]).includes(scope)) return { ok: false, kode: "LINGKUP_TIDAK_DIKENAL", indeks };
    if (!(UKURAN_TARGET as readonly unknown[]).includes(measure)) return { ok: false, kode: "UKURAN_TIDAK_DIKENAL", indeks };
    if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, kode: "NILAI_TIDAK_SAH", indeks };
    if (measure === "PCS" && !Number.isInteger(value)) return { ok: false, kode: "PCS_BUKAN_BULAT", indeks };
    const nilai = measure === "NILAI" ? Math.round(value) : value;
    if (nilai < 1 || nilai > NILAI_MAKS) return { ok: false, kode: "NILAI_TIDAK_SAH", indeks };
    if (typeof refId !== "string" || refId.length === 0 || refId.length > 64) {
      return { ok: false, kode: "ACUAN_TIDAK_DIKENAL", indeks };
    }
    if (dikenal && !(scope === "KATEGORI" ? dikenal.kategori : dikenal.barang).has(refId)) {
      return { ok: false, kode: "ACUAN_TIDAK_DIKENAL", indeks };
    }
    const kunci = `${scope}:${refId}`;
    if (terpakai.has(kunci)) return { ok: false, kode: "GANDA", indeks };
    terpakai.add(kunci);
    baris.push({ scope: scope as LingkupTarget, refId, measure: measure as UkuranTarget, value: nilai });
  }
  return { ok: true, baris };
}

const kunciBaris = (b: BarisTarget) => `${b.scope}:${b.refId}:${b.measure}:${b.value}`;

/** Dua set target sama isinya, urutan diabaikan — menyimpan set yang sama tidak menulis apa pun. */
export function samaIsiTarget(a: readonly BarisTarget[], b: readonly BarisTarget[]): boolean {
  if (a.length !== b.length) return false;
  const kiri = a.map(kunciBaris).sort();
  const kanan = b.map(kunciBaris).sort();
  return kiri.every((k, i) => k === kanan[i]);
}

/**
 * Salin target bulan lalu apa adanya. Acuan yang sudah tidak dikenal
 * (kategori dihapus, barang dinonaktifkan) dibuang dan dihitung, supaya layar
 * bisa mengatakan berapa yang tidak ikut tersalin.
 */
export function salinDariBulanLalu(
  lalu: readonly BarisTarget[],
  dikenal: DaftarDikenal,
): { baris: BarisTarget[]; dibuang: number } {
  const baris = lalu.filter((b) => (b.scope === "KATEGORI" ? dikenal.kategori : dikenal.barang).has(b.refId));
  return { baris: baris.map((b) => ({ ...b })), dibuang: lalu.length - baris.length };
}

// ─── Kemajuan ────────────────────────────────────────────────────────────────

/**
 * TERCAPAI · SESUAI (di depan atau tepat pada laju hari ini) · TERTINGGAL ·
 * TIDAK_TERCAPAI (bulan sudah lewat) · BELUM_MULAI (bulan depan).
 */
export type LajuTarget = "TERCAPAI" | "SESUAI" | "TERTINGGAL" | "TIDAK_TERCAPAI" | "BELUM_MULAI";

export type KemajuanRinci = {
  target: number;
  capai: number;
  persen: number;
  /** Yang masih kurang; 0 bila tercapai. */
  kurang: number;
  tercapai: boolean;
  /**
   * Capaian yang "seharusnya" sudah ada bila laju rata sebulan, dihitung atas
   * hari yang SUDAH LEWAT — hari ini belum selesai, jadi tanggal 1 pagi
   * harapannya nol, bukan sepertiga puluh target.
   */
  harapan: number;
  laju: LajuTarget;
  /** Hari kalender tersisa, TERMASUK hari ini — sama dengan `kemajuanTarget`. */
  sisaHari: number;
  /** Yang masih dibutuhkan per hari; null bila tercapai atau bulannya sudah lewat. */
  perHari: number | null;
};

/**
 * Kemajuan satu target rinci. Ide yang sama dengan `kemajuanTarget` (target
 * total di beranda): sisa dibagi hari yang tersisa. Tambahannya: laju —
 * dibandingkan dengan bagian bulan yang sudah lewat, supaya "baru 40%" di
 * tanggal 10 tidak terbaca sebagai tertinggal.
 */
export function kemajuanRinci(target: number, capai: number, bulan: string, hariIni: Date): KemajuanRinci {
  const [th, bl] = bulan.split("-").map(Number);
  const hariDalamBulan = new Date(Date.UTC(th, bl, 0)).getUTCDate();
  const sekarang = bulanWib(hariIni);
  const tanggal = Number(kunciHariWib(hariIni).slice(8, 10));
  // Hari yang sudah lewat seluruhnya: bulan lalu semua, bulan depan nol, bulan ini sampai kemarin.
  const lewat = bulan < sekarang ? hariDalamBulan : bulan > sekarang ? 0 : tanggal - 1;
  const sisaHari = hariDalamBulan - lewat;

  const kurang = Math.max(0, target - capai);
  const tercapai = capai >= target;
  const harapan = (target * lewat) / hariDalamBulan;
  const laju: LajuTarget = tercapai
    ? "TERCAPAI"
    : bulan < sekarang
      ? "TIDAK_TERCAPAI"
      : bulan > sekarang
        ? "BELUM_MULAI"
        : capai >= harapan
          ? "SESUAI"
          : "TERTINGGAL";
  return {
    target,
    capai,
    persen: target > 0 ? Math.round((capai / target) * 100) : 0,
    kurang,
    tercapai,
    harapan,
    laju,
    sisaHari,
    perHari: kurang > 0 && sisaHari > 0 ? Math.ceil(kurang / sisaHari) : null,
  };
}

// ─── Pembagian nilai dokumen ke barisnya ─────────────────────────────────────

/**
 * Bagi `totalSen` (sen bulat) ke baris sebanding `bobot`, sisa pembulatan ke
 * baris dengan pecahan terbesar. Jumlah hasilnya SELALU tepat `totalSen`.
 * Bobot negatif dianggap nol; bobot nol semua → dibagi rata. Tanpa baris →
 * kosong (pemanggil yang memutuskan ke mana totalnya).
 */
export function bagiSen(totalSen: number, bobot: readonly number[]): number[] {
  if (bobot.length === 0) return [];
  const tanda = totalSen < 0 ? -1 : 1;
  const mutlak = Math.abs(Math.round(totalSen));
  const b = bobot.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const jumlah = b.reduce((n, x) => n + x, 0);
  const pakai = jumlah > 0 ? b : b.map(() => 1);
  const penyebut = jumlah > 0 ? jumlah : b.length;

  const mentah = pakai.map((x) => (mutlak * x) / penyebut);
  const hasil = mentah.map(Math.floor);
  let sisa = mutlak - hasil.reduce((n, x) => n + x, 0);
  const urut = mentah
    .map((x, i) => ({ i, pecahan: x - Math.floor(x) }))
    .sort((p, q) => q.pecahan - p.pecahan || p.i - q.i);
  for (let k = 0; sisa > 0; k = (k + 1) % urut.length, sisa--) hasil[urut[k].i] += 1;
  return hasil.map((x) => x * tanda);
}

// ─── Capaian ─────────────────────────────────────────────────────────────────

export type JenisDokumen = "putus" | "konsi" | "van" | "spg";

/**
 * Satu dokumen penjualan dalam bentuk netral: kiriman putus, pesanan konsi
 * yang disetujui, penjualan van — atau, untuk SPG, nota penjualan di tokonya
 * (`dokumenSpg`). `totalSen` = total dokumen persis seperti yang dijumlahkan
 * kartu beranda; `bobotSen` = nilai bersih baris (sebelum diskon pesanan),
 * hanya dipakai sebagai perbandingan.
 */
export type DokumenJual = {
  jenis: JenisDokumen;
  totalSen: number;
  baris: { itemId: string; qty: number; bobotSen: number; bonus: boolean }[];
};

export type Capaian = { nilai: number; pcs: number };

export type CapaianRinci = {
  /** = omzet "Bulan ini" di beranda salesman; untuk SPG = penjualan bersih notanya. */
  total: number;
  kanal: Record<JenisDokumen, number>;
  /** Per `Item.categoryId`; `TANPA_KATEGORI` untuk barang tanpa kategori dan dokumen tanpa baris. */
  kategori: Record<string, Capaian>;
  /** Per `itemId`. */
  barang: Record<string, Capaian>;
  /** Per `itemId`, hanya dari konsinyasi — untuk `capaianUntukHp`. */
  barangKonsi: Record<string, Capaian>;
};

/**
 * Susun capaian per kategori dan per barang dari dokumen-dokumen satu sales.
 *
 * Baris BONUS (promo "beli X gratis Y") tidak dihitung pcs-nya: barang gratis
 * bukan barang terjual, sama dengan saran pesanan yang juga mengabaikannya.
 * Kategori dibaca dari `kategoriBarang` (kategori barang SAAT INI).
 */
export function susunCapaianRinci(
  dokumen: readonly DokumenJual[],
  kategoriBarang: ReadonlyMap<string, string | null>,
): CapaianRinci {
  const kanalSen: Record<JenisDokumen, number> = { putus: 0, konsi: 0, van: 0, spg: 0 };
  const kategori = new Map<string, { sen: number; pcs: number }>();
  const barang = new Map<string, { sen: number; pcs: number }>();
  const barangKonsi = new Map<string, { sen: number; pcs: number }>();
  const tambah = (peta: Map<string, { sen: number; pcs: number }>, kunci: string, sen: number, pcs: number) => {
    if (sen === 0 && pcs === 0) return;
    const ada = peta.get(kunci);
    if (ada) {
      ada.sen += sen;
      ada.pcs += pcs;
    } else peta.set(kunci, { sen, pcs });
  };

  for (const d of dokumen) {
    kanalSen[d.jenis] += d.totalSen;
    if (d.baris.length === 0) {
      tambah(kategori, TANPA_KATEGORI, d.totalSen, 0);
      continue;
    }
    const bagian = bagiSen(d.totalSen, d.baris.map((b) => b.bobotSen));
    d.baris.forEach((b, i) => {
      const pcs = b.bonus ? 0 : b.qty;
      tambah(kategori, kategoriBarang.get(b.itemId) ?? TANPA_KATEGORI, bagian[i], pcs);
      tambah(barang, b.itemId, bagian[i], pcs);
      if (d.jenis === "konsi") tambah(barangKonsi, b.itemId, bagian[i], pcs);
    });
  }

  const keRupiah = (peta: Map<string, { sen: number; pcs: number }>) =>
    Object.fromEntries([...peta].map(([k, v]) => [k, { nilai: v.sen / 100, pcs: v.pcs }]));
  return {
    total: (kanalSen.putus + kanalSen.konsi + kanalSen.van + kanalSen.spg) / 100,
    kanal: { putus: kanalSen.putus / 100, konsi: kanalSen.konsi / 100, van: kanalSen.van / 100, spg: kanalSen.spg / 100 },
    kategori: keRupiah(kategori),
    barang: keRupiah(barang),
    barangKonsi: keRupiah(barangKonsi),
  };
}

/**
 * Satu nota SPG (`SpgSale`) sebagai dokumen penjualan, BERSIH dari retur
 * pembeli: tiap baris dikurangi `returnedQty`-nya, senilai bagian barisnya
 * (`lineTotal × returnedQty / qty`, dibulatkan ke sen). Nilai yang dikurangkan
 * dari total sama persis dengan yang dikurangkan dari baris, jadi jumlah per
 * kategori tetap tepat sama dengan total bersih.
 *
 * Retur dihitung pada BULAN NOTANYA (kolom `returnedQty` ada di baris nota):
 * barang yang dikembalikan bulan depan mengurangi capaian bulan nota itu.
 */
export function dokumenSpg(nota: {
  total: unknown;
  lines: readonly { itemId: string; qty: number; lineTotal: unknown; returnedQty: number }[];
}): DokumenJual {
  const keSen = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  let kembaliSen = 0;
  const baris = nota.lines.map((l) => {
    const qty = Math.max(0, l.qty);
    const kembali = Math.min(qty, Math.max(0, l.returnedQty));
    const nilai = keSen(l.lineTotal);
    const potong = qty > 0 ? Math.round((nilai * kembali) / qty) : 0;
    kembaliSen += potong;
    return { itemId: l.itemId, qty: qty - kembali, bobotSen: nilai - potong, bonus: false };
  });
  return { jenis: "spg", totalSen: Math.max(0, keSen(nota.total) - kembaliSen), baris };
}

/**
 * Target BARANG dalam rupiah di HP dihitung TANPA konsinyasi.
 *
 * Aplikasi salesman tidak pernah menampilkan harga konsinyasi, dan nilai konsi
 * satu barang dibagi pcs yang ia kirim sendiri sama dengan harga satuan konsi.
 * Pcs dan target kategori tidak terdampak: jumlah barang tidak memuat harga, dan
 * nilai gabungan kategori sama dengan yang sudah tampil di kartu "Bulan ini".
 * Layar kantor tetap memakai `capaianUntuk` (semua saluran).
 */
export function tanpaKonsiDiHp(t: Pick<BarisTarget, "scope" | "measure">): boolean {
  return t.scope === "BARANG" && t.measure === "NILAI";
}

export function capaianUntukHp(
  c: Pick<CapaianRinci, "kategori" | "barang" | "barangKonsi">,
  t: Pick<BarisTarget, "scope" | "refId" | "measure">,
): number {
  if (!tanpaKonsiDiHp(t)) return capaianUntuk(c, t);
  const semua = c.barang[t.refId]?.nilai ?? 0;
  const konsi = c.barangKonsi[t.refId]?.nilai ?? 0;
  return Math.round((semua - konsi) * 100) / 100;
}

/** Capaian yang dibandingkan dengan satu target: ukurannya dari target itu sendiri. */
export function capaianUntuk(
  c: Pick<CapaianRinci, "kategori" | "barang">,
  t: Pick<BarisTarget, "scope" | "refId" | "measure">,
): number {
  const x = (t.scope === "KATEGORI" ? c.kategori : c.barang)[t.refId];
  if (!x) return 0;
  return t.measure === "NILAI" ? x.nilai : x.pcs;
}
