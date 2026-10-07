/**
 * Aturan pengiriman sampel KOL — murni, aman untuk klien.
 *
 * Penulisnya (`sampel-writer.ts`) dan layar Sampel memakai berkas ini supaya
 * keduanya tidak bisa berbeda pendapat soal kapan sebuah paket "berangkat",
 * baris mana yang dianggap sama, dan siapa yang pernah dikirimi.
 *
 * Kapan stok keluar ditetapkan di `aturan.ts` (`pengirimanBerangkat`,
 * `stokPerluKeluar`): tanggal kirim DAN resi terisi. Kurir yang memang tidak
 * memberi nomor (diantar sendiri, kurir toko) memakai tanda `RESI_TANPA_NOMOR`
 * yang dipilih dengan sadar lewat "Tanpa resi" — bukan resi yang dikosongkan,
 * karena resi kosong berarti paketnya belum berangkat.
 */

import { pengirimanBerangkat } from "./aturan";
import type { Tahap } from "./tahap";
import { normalisasiWa } from "./wa";

/** Kurir yang ditawarkan di isian (datalist) — orang tetap boleh mengetik yang lain. */
export const DAFTAR_KURIR = [
  "JNE",
  "J&T",
  "SiCepat",
  "Anteraja",
  "Ninja",
  "ID Express",
  "POS",
  "Lion Parcel",
  "GoSend",
  "Grab",
] as const;

/**
 * Isi `trackingNo` untuk paket yang berangkat tanpa nomor resi.
 *
 * Satu tanda yang tetap, dipilih lewat "Tanpa resi": aturan berangkat membaca
 * resi yang terisi, jadi tanda ini memberangkatkan paket (dan mengeluarkan
 * stoknya) seperti resi biasa, tetapi tampil sebagai "tanpa resi" dan tidak
 * pernah dicocokkan sebagai resi kembar.
 */
export const RESI_TANPA_NOMOR = "-";

export const BATAS_PENGIRIMAN = {
  /** Baris barang berbeda per pengiriman. */
  baris: 50,
  /** Qty per baris. */
  qty: 9999,
  resi: 100,
  kurir: 60,
  catatan: 2000,
  ongkir: 100_000_000,
} as const;

/** Resi dalam bentuk simpan: tanpa spasi di tepi maupun di tengah. Kosong → null. */
export function normalisasiResi(input: string | null | undefined): string | null {
  const t = (input ?? "").replace(/\s+/g, "");
  return t ? t : null;
}

export function tanpaNomorResi(trackingNo: string | null | undefined): boolean {
  return normalisasiResi(trackingNo) === RESI_TANPA_NOMOR;
}

/** Dua resi menunjuk paket yang sama (huruf besar-kecil diabaikan; "tanpa resi" tidak pernah sama). */
export function samaResi(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalisasiResi(a);
  const y = normalisasiResi(b);
  if (!x || !y || x === RESI_TANPA_NOMOR || y === RESI_TANPA_NOMOR) return false;
  return x.toUpperCase() === y.toUpperCase();
}

export type KeadaanPengiriman = "BELUM_BERANGKAT" | "DALAM_PERJALANAN" | "SUDAH_SAMPAI";

type DataKeadaan = {
  sentAt: Date | string | null;
  trackingNo: string | null;
  stockIssuedAt: Date | string | null;
  receivedAt: Date | string | null;
};

/** Sudah berangkat = stoknya sudah keluar, atau syarat berangkat sudah terpenuhi. */
export function sudahBerangkat(p: Omit<DataKeadaan, "receivedAt">): boolean {
  return p.stockIssuedAt !== null || pengirimanBerangkat(p);
}

export function keadaanPengiriman(p: DataKeadaan): KeadaanPengiriman {
  if (!sudahBerangkat(p)) return "BELUM_BERANGKAT";
  return p.receivedAt ? "SUDAH_SAMPAI" : "DALAM_PERJALANAN";
}

/* ───────────────────────────── Tab layar ───────────────────────────── */

export const TAB_SAMPEL = ["perlu-dikirim", "dalam-perjalanan", "sudah-sampai"] as const;
export type TabSampel = (typeof TAB_SAMPEL)[number];

export function bacaTabSampel(v: unknown): TabSampel {
  return typeof v === "string" && (TAB_SAMPEL as readonly string[]).includes(v) ? (v as TabSampel) : "perlu-dikirim";
}

/** "Perlu dikirim": sudah sepakat, belum ada paket yang berangkat. */
export const TAHAP_PERLU_KIRIM: readonly Tahap[] = ["DEAL", "BRIEF_DIKIRIM"];

/**
 * "Sudah sampai": paket diterima dan kontennya belum tayang — yang ditunggu
 * di sini adalah kontennya. Begitu tayang (atau kolaborasinya keluar jalur),
 * barisnya selesai dan hilang dari antrean.
 */
export const TAHAP_TUNGGU_TAYANG: readonly Tahap[] = ["SAMPEL_DIKIRIM", "SAMPEL_DITERIMA", "DRAF", "DRAF_DISETUJUI"];

export const UKURAN_HALAMAN_SAMPEL = 25;

/** Umur disorot merah bila MELEBIHI ambang (ambang 7 → hari ke-8 merah). */
export function umurMerah(umur: number | null | undefined, ambangHari: number): boolean {
  return typeof umur === "number" && umur > ambangHari;
}

/* ───────────────────────────── Baris barang ───────────────────────────── */

export type BarisSampel = { itemId: string; variantSku: string | null; qty: number };

/** Kunci satu baris stok: barang + varian; null dan "" sama-sama "tanpa varian". */
export function kunciVarian(itemId: string, variantSku: string | null | undefined): string {
  return `${itemId}::${(variantSku ?? "").trim()}`;
}

export type HasilRapikanBaris =
  | { ok: true; baris: BarisSampel[] }
  | { ok: false; kode: "QTY_TIDAK_VALID" | "TERLALU_BANYAK_BARIS" };

/**
 * Bentuk simpan baris barang: tanpa barang kosong, varian dirapikan, dan baris
 * dengan barang + varian yang sama DIJUMLAH (dua baris "Kaos M ×1" adalah satu
 * baris "Kaos M ×2" — gudang memotong satu baris stok). Urutan pertama
 * kemunculan dipertahankan.
 */
export function rapikanBarisSampel(baris: readonly { itemId: string | null | undefined; variantSku?: string | null; qty: number }[]): HasilRapikanBaris {
  const gabung = new Map<string, BarisSampel>();
  for (const b of baris) {
    const itemId = (b.itemId ?? "").trim();
    if (!itemId) continue;
    if (!Number.isInteger(b.qty) || b.qty < 1 || b.qty > BATAS_PENGIRIMAN.qty) return { ok: false, kode: "QTY_TIDAK_VALID" };
    const variantSku = b.variantSku?.trim() || null;
    const k = kunciVarian(itemId, variantSku);
    const ada = gabung.get(k);
    if (ada) {
      ada.qty += b.qty;
      if (ada.qty > BATAS_PENGIRIMAN.qty) return { ok: false, kode: "QTY_TIDAK_VALID" };
    } else {
      gabung.set(k, { itemId, variantSku, qty: b.qty });
    }
  }
  if (gabung.size > BATAS_PENGIRIMAN.baris) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };
  return { ok: true, baris: [...gabung.values()] };
}

/** Dua daftar baris berisi barang/varian/qty yang sama (urutan diabaikan). */
export function barisSama(a: readonly BarisSampel[], b: readonly BarisSampel[]): boolean {
  if (a.length !== b.length) return false;
  const peta = new Map(a.map((x) => [kunciVarian(x.itemId, x.variantSku), x.qty]));
  return b.every((y) => peta.get(kunciVarian(y.itemId, y.variantSku)) === y.qty);
}

/* ───────────────────────────── Kirim dobel ───────────────────────────── */

/** Paket yang SUDAH berangkat milik kolaborasi lain. */
export type KirimanLain = {
  kolaborasiId: string;
  docNo: string;
  kolId: string;
  kolNama: string;
  waNormal: string | null;
  campaignId: string | null;
  campaignNama: string | null;
  /** Hari WIB "YYYY-MM-DD". */
  sentAt: string | null;
};

export type SebabDobel = "KOL_SAMA" | "WA_SAMA";

export type PeringatanDobel = {
  kolaborasiId: string;
  docNo: string;
  kolNama: string;
  campaignNama: string | null;
  sentAt: string | null;
  sebab: SebabDobel;
  /** Kiriman itu di campaign yang sama dengan kolaborasi ini. */
  campaignSama: boolean;
};

/**
 * Peringatan kirim dobel untuk satu kolaborasi: KOL yang sama, atau KOL lain
 * dengan nomor WA yang sama (orang yang sama didaftarkan dua kali), sudah
 * pernah menerima paket — di campaign ini atau kapan pun.
 *
 * PERINGATAN, bukan penolakan: mengirim lagi ke orang yang sama kadang memang
 * disengaja (produk baru, campaign lain). Yang dicegah adalah mengirim dua kali
 * TANPA tahu. Satu peringatan per kolaborasi lain; yang di campaign sama
 * didahulukan, lalu yang terbaru.
 */
export function kirimDobel(
  c: { id: string; kolId: string; waNormal: string | null; campaignId: string | null },
  lain: readonly KirimanLain[],
): PeringatanDobel[] {
  const wa = normalisasiWa(c.waNormal);
  const per = new Map<string, PeringatanDobel>();
  for (const o of lain) {
    if (o.kolaborasiId === c.id) continue;
    let sebab: SebabDobel | null = null;
    if (o.kolId === c.kolId) sebab = "KOL_SAMA";
    else if (wa && normalisasiWa(o.waNormal) === wa) sebab = "WA_SAMA";
    if (!sebab) continue;
    const ada = per.get(o.kolaborasiId);
    // Beberapa paket dari kolaborasi yang sama: cukup satu peringatan, tanggal terbarunya.
    if (ada && (ada.sentAt ?? "") >= (o.sentAt ?? "")) continue;
    per.set(o.kolaborasiId, {
      kolaborasiId: o.kolaborasiId,
      docNo: o.docNo,
      kolNama: o.kolNama,
      campaignNama: o.campaignNama,
      sentAt: o.sentAt,
      sebab,
      campaignSama: c.campaignId !== null && o.campaignId === c.campaignId,
    });
  }
  return [...per.values()].sort(
    (a, b) =>
      Number(b.campaignSama) - Number(a.campaignSama) ||
      (b.sentAt ?? "").localeCompare(a.sentAt ?? "") ||
      a.docNo.localeCompare(b.docNo),
  );
}

/* ───────────────────────────── Alamat ───────────────────────────── */

export type DataAlamat = {
  name: string;
  recipientName?: string | null;
  waNormal?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

const bersih = (s: string | null | undefined) => (s ?? "").trim();

export function alamatAda(k: DataAlamat): boolean {
  return bersih(k.address) !== "";
}

/** Nomor HP untuk label paket: "0812-3456-7890" (tetap teks di spreadsheet, mudah dibaca kurir). */
export function nomorHpTampil(k: Pick<DataAlamat, "waNormal" | "phone">): string | null {
  const n = normalisasiWa(k.waNormal ?? k.phone);
  if (!n) return bersih(k.phone) || null;
  const lokal = `0${n.slice(2)}`;
  return [lokal.slice(0, 4), lokal.slice(4, 8), lokal.slice(8)].filter(Boolean).join("-");
}

/** "Kota, Provinsi 12345" — bagian yang kosong dilewati. */
export function barisKota(k: DataAlamat): string {
  const kotaProv = [bersih(k.city), bersih(k.province)].filter(Boolean).join(", ");
  return [kotaProv, bersih(k.postalCode)].filter(Boolean).join(" ");
}

/**
 * Alamat siap tempel ke aplikasi kurir: nama penerima, HP, alamat, kota.
 * Nama penerima jatuh ke nama KOL bila tidak diisi.
 */
export function alamatLengkap(k: DataAlamat): string {
  return [bersih(k.recipientName) || bersih(k.name), nomorHpTampil(k), bersih(k.address), barisKota(k)]
    .filter((x): x is string => Boolean(x))
    .join("\n");
}

/* ───────────────────────────── CSV alamat ───────────────────────────── */

export type BarisCsvAlamat = DataAlamat & {
  docNo: string;
  campaignNama: string | null;
  barang: { nama: string; varian: string | null; qty: number }[];
};

export const KOLOM_CSV_ALAMAT = [
  "Nama penerima",
  "No. HP",
  "Alamat",
  "Kota",
  "Provinsi",
  "Kode pos",
  "Barang",
  "Varian",
  "Qty",
  "No. kolaborasi",
  "Campaign",
] as const;

/** Sel CSV: dikutip bila perlu; isi yang diawali =, +, -, @ diberi tanda kutip tunggal (injeksi rumus). */
export function selCsv(nilai: string | number | null | undefined): string {
  let s = nilai === null || nilai === undefined ? "" : String(nilai);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Daftar alamat kirim untuk gudang: satu baris per barang (alamat diulang),
 * supaya bisa disaring dan dihitung per barang. Kolaborasi tanpa rencana
 * barang tetap muncul satu baris dengan kolom barang kosong. Diawali BOM agar
 * Excel membaca huruf non-ASCII dengan benar.
 */
export function csvAlamatKirim(rows: readonly BarisCsvAlamat[]): string {
  const garis: string[] = [KOLOM_CSV_ALAMAT.map(selCsv).join(",")];
  for (const r of rows) {
    const awal = [
      bersih(r.recipientName) || bersih(r.name),
      nomorHpTampil(r),
      bersih(r.address),
      bersih(r.city),
      bersih(r.province),
      bersih(r.postalCode),
    ];
    const akhir = [r.docNo, r.campaignNama];
    const barang = r.barang.length ? r.barang : [null];
    for (const b of barang) {
      garis.push([...awal, b?.nama ?? "", b?.varian ?? "", b ? b.qty : "", ...akhir].map(selCsv).join(","));
    }
  }
  return `﻿${garis.join("\r\n")}\r\n`;
}
