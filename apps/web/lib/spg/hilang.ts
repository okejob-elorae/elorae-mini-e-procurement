import { computeStorePrice } from "@elorae/db/pricing";
import type { AturanBarangHilang, DasarNilaiHilang } from "./pengaturan";

/**
 * Barang hilang — aturan murni, satu tempat (keputusan pemilik 2026-10-03:
 * "kadang ditanggung toko, kadang SPG, kadang sales, kadang Elorae; Elorae
 * memutuskan, dan kalau ditanggung orang, memengaruhi komisi atau gajinya").
 *
 * Tanpa basis data, aman diimpor komponen klien (formulir keputusan kantor,
 * kartu pengaturan).
 *
 * Alur dokumen `StockLoss`:
 * 1. DIBUKA (TERBUKA) — dari opname toko konsinyasi yang kurang, mutasi yang
 *    selisihnya diputuskan HILANG, kiriman yang diterima kurang, atau dicatat
 *    manual oleh kantor. Nilai per potong dibekukan saat dibuka (`dasarNilai`).
 * 2. DITETAPKAN — kantor (`receivables:manage`) membagi total ke penanggung:
 *    TOKO, SPG (orang), SALES (orang), ELORAE. Jumlah bagian = total (kantor
 *    boleh mengubah total dengan alasan). Bagian ELORAE langsung lunas
 *    (dihapusbukukan). Keringanan diskon pegawai (opsional, per keputusan)
 *    mengurangi setiap bagian SPG/SALES dan memindahkan selisihnya ke ELORAE
 *    (`terapkanDiskonPegawai`); hanya tercatat di catatan keputusan dan
 *    metadata jejaknya.
 * 3. SELESAI — otomatis begitu semua bagian lunas: TOKO konsinyasi lewat
 *    tagihan siklus bulan itu, TOKO putus ditandai kantor sudah ditagih, SPG
 *    dipotong dari komisi/gajinya (paling banyak `maksPotongPersen` dari satu
 *    pembayaran, sisanya dicicil), SALES ditandai kantor sudah dipotong.
 * 4. DIBATALKAN — dengan alasan (mis. ternyata terjual tanpa nota), hanya
 *    selama belum ada potongan/tagihan atas bagian orang atau toko.
 *
 * Uang dihitung dalam SEN (bilangan bulat) supaya pembagian dan cicilan selalu
 * berjumlah tepat sama dengan totalnya.
 */

export const STATUS_HILANG = ["TERBUKA", "DITETAPKAN", "SELESAI", "DIBATALKAN"] as const;
export type StatusHilang = (typeof STATUS_HILANG)[number];

export const SUMBER_HILANG = ["OPNAME", "MUTASI", "PENERIMAAN", "MANUAL"] as const;
export type SumberHilang = (typeof SUMBER_HILANG)[number];

export const PENANGGUNG = ["TOKO", "SPG", "SALES", "ELORAE"] as const;
export type Penanggung = (typeof PENANGGUNG)[number];

/** Penanggung yang berupa ORANG — wajib `bearerUserId`, dipotong dari gaji/komisinya. */
export const PENANGGUNG_ORANG: readonly Penanggung[] = ["SPG", "SALES"];

/** Urutan pilihan di kartu pengaturan; yang pertama = bawaan. */
export const DASAR_NILAI: readonly DasarNilaiHilang[] = ["HARGA_TERIMA", "HARGA_ELORAE", "HPP", "ECERAN"];

/** Nama tindakan jejak (`AuditLog.action`) — label di i18n `auditActions.actions.*`. */
export const JEJAK_HILANG = {
  DIBUKA: "STOCK_LOSS_OPENED",
  DIPUTUSKAN: "STOCK_LOSS_DECIDED",
  DIUBAH: "STOCK_LOSS_CHANGED",
  DIBATALKAN: "STOCK_LOSS_CANCELLED",
  /** Bagian toko lunas: ditagihkan di siklus konsinyasi, atau ditandai kantor sudah ditagih. */
  LUNAS: "STOCK_LOSS_SETTLED",
  /** Bagian orang dipotong dari komisi/gaji (atau ditandai kantor sudah dipotong). */
  DIPOTONG: "STOCK_LOSS_DEDUCTED",
  /** Potongan/tagihan dilepas — komisi ditetapkan ulang atau kunci siklus dibuka. */
  POTONGAN_DILEPAS: "STOCK_LOSS_DEDUCTION_RELEASED",
  PENGATURAN_DIUBAH: "STOCK_LOSS_SETTINGS_CHANGED",
} as const;

export const ENTITAS_HILANG = "StockLoss";
/** Kategori catatan kantor (`AdminNotification`) — penerimanya `receivables:manage`. */
export const KATEGORI_NOTIF_HILANG = "STOCK_LOSS_OPEN";

/** `StockLossDeduction.refType` milik modul ini. Pemanggil lain memakai nama dokumennya sendiri. */
export const REF_SIKLUS_KONSI = "ConsignmentCycle";
export const REF_TAGIH_TOKO_MANUAL = "TagihanTokoManual";
export const REF_KOMISI_SALESMAN = "KomisiSalesman";
/** Komisi SPG toko putus — `refId` = `SpgCommission.id`. */
export const REF_KOMISI_SPG_PUTUS = "SpgCommission";
/** Gaji + komisi SPG konsinyasi — `refId` = `ConsignmentCommission.id`. */
export const REF_KOMISI_KONSI = "ConsignmentCommission";

export const BATAS_TEKS_HILANG = 500;
export const BATAS_BARIS_HILANG = 200;
export const BATAS_BAGIAN = 20;

export function bacaStatusHilang(v: unknown): StatusHilang | null {
  return typeof v === "string" && (STATUS_HILANG as readonly string[]).includes(v) ? (v as StatusHilang) : null;
}

export function bacaSumberHilang(v: unknown): SumberHilang | null {
  return typeof v === "string" && (SUMBER_HILANG as readonly string[]).includes(v) ? (v as SumberHilang) : null;
}

export function bacaPenanggung(v: unknown): Penanggung | null {
  return typeof v === "string" && (PENANGGUNG as readonly string[]).includes(v) ? (v as Penanggung) : null;
}

export const penanggungOrang = (b: Penanggung): boolean => b === "SPG" || b === "SALES";

// ─── Uang dalam sen ──────────────────────────────────────────────────────────

export const keSen = (rupiah: number): number => Math.round(rupiah * 100);
export const dariSen = (sen: number): number => sen / 100;
/** Bentuk yang ditulis ke kolom Decimal(15,2) — string, supaya tidak ada ekor float. */
export const desimal = (sen: number): string => (sen / 100).toFixed(2);

/** Rupiah dengan paling banyak dua angka di belakang koma. */
function senSah(rupiah: unknown): number | null {
  if (typeof rupiah !== "number" || !Number.isFinite(rupiah)) return null;
  const sen = keSen(rupiah);
  if (Math.abs(sen - rupiah * 100) > 1e-6) return null;
  return sen;
}

// ─── Teks ───────────────────────────────────────────────────────────────────

export type HasilTeks = { ok: true; teks: string | null } | { ok: false; kode: "ALASAN_WAJIB" | "TEKS_TERLALU_PANJANG" };

/** Teks rapi (spasi dirapatkan). Kosong → null, atau ALASAN_WAJIB kalau wajib. */
export function rapikanTeksHilang(v: unknown, wajib: boolean): HasilTeks {
  const rapi = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  if (rapi.length > BATAS_TEKS_HILANG) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  if (!rapi) return wajib ? { ok: false, kode: "ALASAN_WAJIB" } : { ok: true, teks: null };
  return { ok: true, teks: rapi };
}

// ─── Bagian penanggung ───────────────────────────────────────────────────────

export type IsianBagian = { bearer: Penanggung; bearerUserId: string | null; amount: number };

export type KodeTolakBagian =
  | "BAGIAN_KOSONG"
  | "BAGIAN_TERLALU_BANYAK"
  | "PENANGGUNG_TIDAK_SAH"
  | "ORANG_WAJIB"
  | "TOKO_WAJIB"
  | "BAGIAN_KEMBAR"
  | "JUMLAH_TIDAK_SAH"
  | "TOTAL_TIDAK_SAH"
  | "JUMLAH_TIDAK_SAMA";

/**
 * Periksa bagian-bagian keputusan terhadap total. Setiap bagian lebih dari nol,
 * paling banyak dua angka desimal; orang wajib untuk SPG/SALES (dan dibuang
 * untuk TOKO/ELORAE); TOKO hanya bila catatannya punya toko; satu baris per
 * penanggung (per orang untuk SPG/SALES); jumlahnya tepat sama dengan total.
 */
export function periksaBagian(
  isian: unknown,
  total: number,
  adaToko: boolean,
): { ok: true; bagian: IsianBagian[] } | { ok: false; kode: KodeTolakBagian } {
  const totalSen = senSah(total);
  if (totalSen === null || totalSen <= 0) return { ok: false, kode: "TOTAL_TIDAK_SAH" };
  if (!Array.isArray(isian) || isian.length === 0) return { ok: false, kode: "BAGIAN_KOSONG" };
  if (isian.length > BATAS_BAGIAN) return { ok: false, kode: "BAGIAN_TERLALU_BANYAK" };

  const hasil: IsianBagian[] = [];
  const kunci = new Set<string>();
  let jumlah = 0;
  for (const x of isian) {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const bearer = bacaPenanggung(o.bearer);
    if (!bearer) return { ok: false, kode: "PENANGGUNG_TIDAK_SAH" };
    let orang: string | null = null;
    if (penanggungOrang(bearer)) {
      orang = typeof o.bearerUserId === "string" ? o.bearerUserId.trim() : "";
      if (!orang || orang.length > 64) return { ok: false, kode: "ORANG_WAJIB" };
    }
    if (bearer === "TOKO" && !adaToko) return { ok: false, kode: "TOKO_WAJIB" };
    const k = `${bearer}:${orang ?? ""}`;
    if (kunci.has(k)) return { ok: false, kode: "BAGIAN_KEMBAR" };
    kunci.add(k);
    const sen = senSah(o.amount);
    if (sen === null || sen <= 0) return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
    jumlah += sen;
    hasil.push({ bearer, bearerUserId: orang, amount: dariSen(sen) });
  }
  if (jumlah !== totalSen) return { ok: false, kode: "JUMLAH_TIDAK_SAMA" };
  return { ok: true, bagian: hasil };
}

/**
 * Bagi `totalSen` ke `n` bagian sama rata, dalam RUPIAH UTUH: sisa rupiah
 * diberikan satu per satu ke bagian pertama, dan sen yang tersisa (kalau
 * totalnya bersen) ke bagian pertama. Jumlahnya selalu tepat `totalSen`.
 */
export function bagiRata(totalSen: number, n: number): number[] {
  if (!Number.isInteger(n) || n <= 0 || totalSen <= 0) return [];
  const rupiah = Math.floor(totalSen / 100);
  const senSisa = totalSen - rupiah * 100;
  const dasar = Math.floor(rupiah / n);
  let lebih = rupiah - dasar * n;
  const hasil: number[] = [];
  for (let i = 0; i < n; i++) {
    hasil.push((dasar + (lebih > 0 ? 1 : 0)) * 100);
    if (lebih > 0) lebih--;
  }
  hasil[0] += senSisa;
  return hasil;
}

export type JenisPreset = "ELORAE" | "TOKO" | "SPG_TOKO" | "SALES_TOKO";

/**
 * Isian bagian untuk tombol cepat di formulir keputusan. Null kalau preset itu
 * tidak bisa dipakai (toko tanpa SPG, tanpa sales pemegang, catatan tanpa toko).
 */
export function presetBagian(
  jenis: JenisPreset,
  konteks: { total: number; adaToko: boolean; spgIds: string[]; salesmanId: string | null },
): IsianBagian[] | null {
  const totalSen = senSah(konteks.total);
  if (totalSen === null || totalSen <= 0) return null;
  const total = dariSen(totalSen);
  switch (jenis) {
    case "ELORAE":
      return [{ bearer: "ELORAE", bearerUserId: null, amount: total }];
    case "TOKO":
      return konteks.adaToko ? [{ bearer: "TOKO", bearerUserId: null, amount: total }] : null;
    case "SALES_TOKO":
      return konteks.salesmanId ? [{ bearer: "SALES", bearerUserId: konteks.salesmanId, amount: total }] : null;
    case "SPG_TOKO": {
      const ids = [...new Set(konteks.spgIds)];
      if (ids.length === 0) return null;
      return bagiRata(totalSen, ids.length).map((sen, i) => ({ bearer: "SPG", bearerUserId: ids[i], amount: dariSen(sen) }));
    }
  }
}

// ─── Lunas dan potongan ──────────────────────────────────────────────────────

/** Status dokumen sesudah pelunasan berubah: SELESAI kalau semua bagian lunas. */
export function statusSesudahLunas(bagian: { amount: number; settledAmount: number }[]): "DITETAPKAN" | "SELESAI" {
  if (bagian.length === 0) return "DITETAPKAN";
  return bagian.every((b) => keSen(b.settledAmount) >= keSen(b.amount)) ? "SELESAI" : "DITETAPKAN";
}

/**
 * Batas potongan dari SATU pembayaran: `persen` × bruto, dibulatkan ke bawah
 * ke rupiah utuh (slip gaji tidak bersen). Nol untuk bruto ≤ 0.
 */
export function batasPotongSen(bruto: number, persen: number): number {
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  const p = Number.isFinite(persen) ? Math.min(100, Math.max(0, persen)) : 0;
  return Math.floor((keSen(bruto) * p) / 100 / 100) * 100;
}

export type BagianTerbuka = { id: string; sisaSen: number };

/**
 * Bagikan `batasSen` ke bagian-bagian yang belum lunas, BERURUTAN (yang
 * terlama dulu — urutan dari pemanggil): bagian pertama dihabiskan dulu
 * sebelum bagian berikutnya dipotong. Hanya bagian yang dipotong yang kembali.
 */
export function alokasiPotong(bagian: BagianTerbuka[], batasSen: number): { id: string; potongSen: number }[] {
  let sisa = Math.max(0, Math.floor(batasSen));
  const hasil: { id: string; potongSen: number }[] = [];
  for (const b of bagian) {
    if (sisa <= 0) break;
    const potong = Math.min(sisa, Math.max(0, b.sisaSen));
    if (potong <= 0) continue;
    hasil.push({ id: b.id, potongSen: potong });
    sisa -= potong;
  }
  return hasil;
}

// ─── Nilai per potong ────────────────────────────────────────────────────────

export type BahanNilai = {
  sellingPrice: number | null;
  avgCost: number | null;
  termsType: "PUTUS" | "KONSI" | null;
  marginPercent: number | null;
  /** Harga per potong saat barang itu terakhir diterima toko ini (`pilihHargaTerima`), atau null. */
  hargaTerima?: number | null;
};

/**
 * Nilai satu potong menurut dasar di pengaturan, dalam sen:
 * - HARGA_TERIMA: harga saat toko itu terakhir menerima barang tersebut
 *   (`pilihHargaTerima`); kalau tidak ada, harga jual Elorae.
 * - HARGA_ELORAE: harga jual Elorae (`Item.sellingPrice`).
 * - HPP: harga pokok rata-rata gudang (`InventoryValue.avgCost`).
 * - ECERAN: harga eceran di toko itu — sama dengan harga jual untuk toko putus,
 *   dinaikkan dengan margin toko untuk konsinyasi (`computeStorePrice`).
 * Yang tidak diketahui bernilai nol (dan ditandai di layar).
 */
export function nilaiSatuanSen(dasar: DasarNilaiHilang, b: BahanNilai): number {
  const aman = (n: number | null | undefined) => (n !== null && n !== undefined && Number.isFinite(n) && n > 0 ? keSen(n) : 0);
  if (dasar === "HPP") return aman(b.avgCost);
  if (dasar === "ECERAN") {
    if (!b.termsType) return aman(b.sellingPrice);
    return aman(computeStorePrice({ sellingPrice: b.sellingPrice, termsType: b.termsType, marginPercent: b.marginPercent }).price);
  }
  if (dasar === "HARGA_TERIMA") return aman(b.hargaTerima) || aman(b.sellingPrice);
  return aman(b.sellingPrice);
}

// ─── Harga toko terima ───────────────────────────────────────────────────────

/**
 * Satu harga kiriman ke toko: baris nota kiriman putus, atau baris kiriman
 * konsinyasi (yang tidak punya varian → `variantSku` null). `harga` dalam
 * rupiah per potong, BERSIH dari potongan baris.
 */
export type KandidatHargaTerima = { itemId: string; variantSku: string | null; harga: number; pada: Date };

/**
 * Harga bersih per potong satu baris nota kiriman putus:
 * `unitPrice − discountAmount / qty`, dibulatkan ke sen. Null kalau harga
 * kosong, jumlah tidak sah, atau hasilnya tidak lebih dari nol (baris bonus).
 */
export function hargaBersihKirim(unitPrice: number | null, discountAmount: number | null, qty: number): number | null {
  if (unitPrice === null || !Number.isFinite(unitPrice) || !Number.isInteger(qty) || qty <= 0) return null;
  const potongan = discountAmount !== null && Number.isFinite(discountAmount) ? discountAmount : 0;
  const sen = Math.round((unitPrice - potongan / qty) * 100);
  return sen > 0 ? sen / 100 : null;
}

/**
 * Harga yang Elorae TERIMA untuk satu potong di toko konsinyasi. Dokumen
 * konsinyasi (kiriman konsinyasi, baris pesanan konsi) membawa harga jual DI
 * TOKO; toko memotong marginnya. Pemilik 2026-10-03: "untuk konsinyasi akan
 * saya sesuaikan, jadi 100.000 margin 25%, maka saya terima 75.000".
 *
 * Margin yang tidak sah (kosong, < 0, ≥ 100) berarti harga tidak dinaikkan
 * waktu dicatat (`computeStorePrice` memakai harga jual apa adanya), jadi
 * harganya dipakai apa adanya. Dibulatkan ke sen; null kalau hasilnya tidak
 * lebih dari nol.
 */
export function hargaTerimaKonsi(hargaToko: number | null, marginPercent: number | null): number | null {
  if (hargaToko === null || !Number.isFinite(hargaToko) || hargaToko <= 0) return null;
  const m = marginPercent;
  const sah = m !== null && Number.isFinite(m) && m >= 0 && m < 100;
  const sen = Math.round(hargaToko * (sah ? 1 - m / 100 : 1) * 100);
  return sen > 0 ? sen / 100 : null;
}

/**
 * Harga saat toko terakhir MENERIMA barang ini: kiriman terbaru dengan varian
 * yang persis sama lebih dulu; kalau tidak ada, kiriman terbaru barang yang
 * sama (varian apa pun). Null kalau toko belum pernah menerimanya dengan harga
 * — pemanggil jatuh ke harga jual Elorae. Kiriman berwaktu sama: urutan
 * masukan dipertahankan (pemanggil mengurutkan dengan id sebagai penentu).
 */
export function pilihHargaTerima(kandidat: KandidatHargaTerima[], itemId: string, variantSku: string): number | null {
  const milik = kandidat
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k.itemId === itemId && Number.isFinite(k.harga) && k.harga > 0)
    .sort((a, b) => b.k.pada.getTime() - a.k.pada.getTime() || a.i - b.i)
    .map(({ k }) => k);
  if (milik.length === 0) return null;
  const sku = variantSku.trim();
  const persis = sku ? milik.find((k) => (k.variantSku ?? "").trim() === sku) : undefined;
  return (persis ?? milik[0]).harga;
}

// ─── Keringanan diskon pegawai ───────────────────────────────────────────────

/**
 * Pemilik 2026-10-03: SPG/sales yang menanggung barang hilang "kadang kita
 * berikan keringanan, sebagai pegawai yang bisa dapat potongan diskon".
 *
 * Setiap bagian SPG/SALES dikurangi `persen` dan DIBULATKAN KE BAWAH ke rupiah
 * utuh (slip gaji tidak bersen); seluruh pengurangannya pindah ke bagian
 * ELORAE (ditambahkan ke bagian Elorae yang sudah ada, atau bagian baru di
 * akhir). Jumlah semua bagian tetap sama dengan sebelumnya. Bagian orang yang
 * menjadi nol dibuang (keringanan 100%). Persen yang bukan bilangan bulat
 * 1–100, atau tanpa bagian SPG/SALES: tidak ada yang berubah.
 */
export type HasilKeringanan = {
  bagian: IsianBagian[];
  /** Total yang pindah ke Elorae, dalam sen. */
  diserapSen: number;
  /** Bagian orang yang dikurangi: jumlah sebelum dan sesudah (rupiah). */
  perOrang: { bearer: Penanggung; bearerUserId: string | null; sebelum: number; sesudah: number }[];
};

export function terapkanDiskonPegawai(bagian: IsianBagian[], persen: number): HasilKeringanan {
  const tetap: HasilKeringanan = { bagian: bagian.map((b) => ({ ...b })), diserapSen: 0, perOrang: [] };
  if (!Number.isInteger(persen) || persen <= 0 || persen > 100) return tetap;
  if (!bagian.some((b) => penanggungOrang(b.bearer))) return tetap;

  let diserapSen = 0;
  const perOrang: HasilKeringanan["perOrang"] = [];
  const hasil: IsianBagian[] = [];
  for (const b of bagian) {
    if (!penanggungOrang(b.bearer)) {
      hasil.push({ ...b });
      continue;
    }
    const sebelumSen = keSen(b.amount);
    // Bilangan bulat semua: sen × (100 − persen) / 100 → sen, lalu ke bawah ke rupiah utuh.
    const sesudahSen = Math.floor((sebelumSen * (100 - persen)) / 10_000) * 100;
    diserapSen += sebelumSen - sesudahSen;
    perOrang.push({ bearer: b.bearer, bearerUserId: b.bearerUserId, sebelum: dariSen(sebelumSen), sesudah: dariSen(sesudahSen) });
    if (sesudahSen > 0) hasil.push({ ...b, amount: dariSen(sesudahSen) });
  }
  if (diserapSen > 0) {
    const elorae = hasil.find((b) => b.bearer === "ELORAE");
    if (elorae) elorae.amount = dariSen(keSen(elorae.amount) + diserapSen);
    else hasil.push({ bearer: "ELORAE", bearerUserId: null, amount: dariSen(diserapSen) });
  }
  return { bagian: hasil, diserapSen, perOrang };
}

/** Kalimat keringanan di catatan keputusan dan jejaknya. */
export function kalimatKeringanan(persen: number, diserapSen: number): string {
  return `Keringanan diskon pegawai ${persen}%: Rp ${tulisIsianRupiah(dariSen(diserapSen))} ditanggung Elorae.`;
}

/**
 * Bentuk `metadata.keringanan` di jejak keputusan (`STOCK_LOSS_DECIDED` /
 * `STOCK_LOSS_CHANGED`) — satu-satunya tempat keringanan tersimpan (tanpa
 * kolom baru). `sebelum` = pembagian sebelum keringanan, supaya "Ubah
 * keputusan" bisa mulai dari situ.
 */
export type JejakKeringanan = {
  persen: number;
  diserap: number;
  sebelum: IsianBagian[];
  perOrang: HasilKeringanan["perOrang"];
};

/** Baca `metadata.keringanan` dari jejak keputusan; null kalau tidak ada atau rusak. */
export function bacaJejakKeringanan(metadata: unknown): JejakKeringanan | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const k = (metadata as Record<string, unknown>).keringanan;
  if (!k || typeof k !== "object" || Array.isArray(k)) return null;
  const o = k as Record<string, unknown>;
  if (typeof o.persen !== "number" || !Number.isInteger(o.persen) || o.persen <= 0 || o.persen > 100) return null;
  if (typeof o.diserap !== "number" || !Number.isFinite(o.diserap)) return null;
  const sebelum = Array.isArray(o.sebelum)
    ? o.sebelum.flatMap((x): IsianBagian[] => {
        const b = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        const bearer = bacaPenanggung(b.bearer);
        if (!bearer || typeof b.amount !== "number") return [];
        return [{ bearer, bearerUserId: typeof b.bearerUserId === "string" ? b.bearerUserId : null, amount: b.amount }];
      })
    : [];
  const perOrang = Array.isArray(o.perOrang)
    ? o.perOrang.flatMap((x): HasilKeringanan["perOrang"] => {
        const b = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
        const bearer = bacaPenanggung(b.bearer);
        if (!bearer || typeof b.sebelum !== "number" || typeof b.sesudah !== "number") return [];
        return [{ bearer, bearerUserId: typeof b.bearerUserId === "string" ? b.bearerUserId : null, sebelum: b.sebelum, sesudah: b.sesudah }];
      })
    : [];
  return { persen: o.persen, diserap: o.diserap, sebelum, perOrang };
}

// ─── Baris yang kurang dari dokumen sumber ──────────────────────────────────

export type BarisKurang = { itemId: string | null; variantSku: string; productName: string; qty: number };

/** Opname: setiap baris yang dihitung LEBIH SEDIKIT dari saldo buku. */
export function kurangDariOpname(
  baris: { itemId: string; variantSku: string; productName: string; qtySystem: number; qtyCounted: number }[],
): BarisKurang[] {
  return baris
    .filter((b) => b.qtyCounted < b.qtySystem)
    .map((b) => ({ itemId: b.itemId, variantSku: b.variantSku ?? "", productName: b.productName, qty: b.qtySystem - b.qtyCounted }));
}

/**
 * Penerimaan (termasuk tanda terima mutasi): setiap baris yang TIBA lebih
 * sedikit dari yang dikirim. Barang rusak tetap terhitung tiba — rusak punya
 * alurnya sendiri, bukan hilang.
 */
export function kurangDariTerima(
  baris: { itemId: string | null; variantSku: string; productName: string; qtySent: number; qtyReceived: number }[],
): BarisKurang[] {
  return baris
    .filter((b) => b.qtyReceived < b.qtySent)
    .map((b) => ({ itemId: b.itemId, variantSku: b.variantSku ?? "", productName: b.productName, qty: b.qtySent - b.qtyReceived }));
}

// ─── Pengaturan ─────────────────────────────────────────────────────────────

/**
 * Isian kartu pengaturan yang sah, atau null. Bentuknya persis
 * `AturanBarangHilang` (urutan kunci sama dengan `bacaBarangHilang`).
 * Kunci lain (mis. `diskonPegawaiPersen` lama) diabaikan.
 */
export function validasiAturanBarangHilang(isi: unknown): AturanBarangHilang | null {
  if (!isi || typeof isi !== "object" || Array.isArray(isi)) return null;
  const o = isi as Record<string, unknown>;
  const dasar = typeof o.dasarNilai === "string" && (DASAR_NILAI as readonly string[]).includes(o.dasarNilai) ? (o.dasarNilai as DasarNilaiHilang) : null;
  if (!dasar) return null;
  const persen = o.maksPotongPersen;
  if (typeof persen !== "number" || !Number.isInteger(persen) || persen < 0 || persen > 100) return null;
  if (typeof o.dariOpname !== "boolean") return null;
  return { dasarNilai: dasar, maksPotongPersen: persen, dariOpname: o.dariOpname };
}

// ─── Tampilan ───────────────────────────────────────────────────────────────

const SATU_HARI = 24 * 60 * 60 * 1000;
const WIB = 7 * 60 * 60 * 1000;

/** Umur catatan dalam hari kalender WIB (0 = dibuka hari ini). */
export function umurHari(dibuat: Date, sekarang: Date): number {
  const hari = (d: Date) => Math.floor((d.getTime() + WIB) / SATU_HARI);
  return Math.max(0, hari(sekarang) - hari(dibuat));
}

/** Awal bulan SESUDAH (tahun, bulan 1–12) pukul 00.00 WIB — batas "dibuka sampai akhir bulan". */
export function awalBulanBerikutWib(tahun: number, bulan: number): Date {
  return new Date(Date.UTC(tahun, bulan, 1) - WIB);
}

// ─── Isian rupiah di formulir kantor ─────────────────────────────────────────

/**
 * Baca isian rupiah gaya Indonesia: titik = pemisah ribuan, koma = desimal
 * ("100.000" → 100000, "33.333,33" → 33333.33). Null kalau bukan angka sah
 * atau lebih dari dua angka desimal.
 */
export function bacaIsianRupiah(s: string): number | null {
  const rapi = s.replace(/\s+/g, "").replace(/^Rp/i, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(rapi)) return null;
  const n = Number(rapi.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Kebalikan `bacaIsianRupiah`: 100000 → "100.000", 33333.33 → "33.333,33". */
export function tulisIsianRupiah(n: number): string {
  const sen = keSen(Math.max(0, n));
  const utuh = Math.floor(sen / 100);
  const desimalSen = sen % 100;
  const ribuan = String(utuh).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return desimalSen === 0 ? ribuan : `${ribuan},${String(desimalSen).padStart(2, "0")}`;
}
