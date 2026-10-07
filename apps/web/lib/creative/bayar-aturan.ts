/**
 * Pembayaran fee KOL — aturan murni, aman untuk komponen klien.
 *
 * Tahap ini SEDERHANA seperti KOL Manager (keputusan sementara pemilik
 * 2026-10-07): status + jumlah yang sudah dibayar + tanggal + catatan. Termin,
 * PPh, dan rekening belum dibangun.
 *
 * `paidAmount` adalah TOTAL yang sudah dibayar sampai sekarang, bukan cicilan
 * terakhir: "Sebagian 400.000" berarti sudah dibayar 400.000 seluruhnya.
 *
 * Penulis (`bayar-writer.ts`) dan dialog "Tandai dibayar" memakai aturan yang
 * SAMA dari berkas ini, jadi layar tidak bisa menerima isian yang ditolak
 * server, dan sebaliknya.
 */

import type { StatusTone } from "@/components/ui/status-pill";
import { bacaTanggal } from "@/lib/tanggal-isian";
import { dariSen, keSen } from "./angka-konten";
import type { StatusBayar } from "./tahap";

/** Status yang boleh dipilih saat mencatat pembayaran. */
export const STATUS_BAYAR_ISIAN: readonly StatusBayar[] = ["LUNAS", "SEBAGIAN", "BELUM", "TIDAK_PERLU"];

export type ChipBayar = "BELUM" | "SEBAGIAN" | "LUNAS" | "SEMUA";
export const CHIP_BAYAR: readonly ChipBayar[] = ["BELUM", "SEBAGIAN", "LUNAS", "SEMUA"];
export const CHIP_BAYAR_BAWAAN: ChipBayar = "BELUM";

export function bacaChipBayar(v: unknown): ChipBayar {
  return typeof v === "string" && (CHIP_BAYAR as readonly string[]).includes(v) ? (v as ChipBayar) : CHIP_BAYAR_BAWAAN;
}

export type KodeTolakBayar =
  | "STATUS_TIDAK_VALID"
  | "JUMLAH_WAJIB"
  | "JUMLAH_TIDAK_VALID"
  /** TIDAK_PERLU dipilih untuk kolaborasi yang punya fee — ubah fee-nya ke 0 di kolaborasi. */
  | "ADA_FEE"
  | "TANGGAL_TIDAK_VALID"
  /** Tanggal bayar sesudah hari ini (WIB). */
  | "TANGGAL_DEPAN";

export type RencanaBayar =
  | { ok: true; payStatus: StatusBayar; paidAmount: number; paidAtHari: string | null }
  | { ok: false; kode: KodeTolakBayar };

const angkaSah = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * Keadaan pembayaran yang akan disimpan.
 *
 * - Fee 0 → selalu TIDAK_PERLU (tidak ada yang harus dibayar).
 * - LUNAS → jumlah = fee; tanggal bawaan hari ini.
 * - SEBAGIAN → 0 < jumlah < fee (jumlah = total yang sudah dibayar).
 * - BELUM → jumlah 0, tanpa tanggal.
 * - TIDAK_PERLU untuk fee > 0 ditolak: utang fee tidak boleh hilang lewat
 *   pilihan status; yang benar adalah mengubah fee kolaborasinya.
 * - Tanggal bayar sesudah hari ini ditolak — yang dicatat adalah uang yang
 *   sudah keluar.
 */
export function rencanaPembayaran(input: {
  fee: number;
  status: string;
  jumlah?: number | null;
  /** Hari WIB "YYYY-MM-DD"; kosong = hari ini. */
  tanggal?: string | null;
  hariIni: string;
}): RencanaBayar {
  if (!(STATUS_BAYAR_ISIAN as readonly string[]).includes(input.status)) return { ok: false, kode: "STATUS_TIDAK_VALID" };
  const feeSen = keSen(angkaSah(input.fee) ? input.fee : 0);
  if (feeSen <= 0) return { ok: true, payStatus: "TIDAK_PERLU", paidAmount: 0, paidAtHari: null };

  const status = input.status as StatusBayar;
  if (status === "TIDAK_PERLU") return { ok: false, kode: "ADA_FEE" };
  if (status === "BELUM") return { ok: true, payStatus: "BELUM", paidAmount: 0, paidAtHari: null };

  const teks = input.tanggal?.trim() || "";
  if (teks && !bacaTanggal(teks)) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };
  const hari = teks || input.hariIni;
  if (hari > input.hariIni) return { ok: false, kode: "TANGGAL_DEPAN" };

  if (status === "LUNAS") return { ok: true, payStatus: "LUNAS", paidAmount: dariSen(feeSen), paidAtHari: hari };

  if (input.jumlah === null || input.jumlah === undefined || !angkaSah(input.jumlah)) return { ok: false, kode: "JUMLAH_WAJIB" };
  const jumlahSen = keSen(input.jumlah);
  if (jumlahSen <= 0 || jumlahSen >= feeSen) return { ok: false, kode: "JUMLAH_TIDAK_VALID" };
  return { ok: true, payStatus: "SEBAGIAN", paidAmount: dariSen(jumlahSen), paidAtHari: hari };
}

/** Label bahasa Indonesia untuk teks buatan mesin (CSV, cetak). Layar memakai i18n `kreatifRuang.bayar.*`. */
export const LABEL_STATUS_BAYAR: Record<StatusBayar, string> = {
  TIDAK_PERLU: "Tidak perlu",
  BELUM: "Belum dibayar",
  SEBAGIAN: "Dibayar sebagian",
  LUNAS: "Lunas",
};

/** Nada pil status bayar: belum = kuning, sebagian = biru, lunas = hijau, tidak perlu = abu. */
export function nadaBayar(s: StatusBayar): StatusTone {
  return s === "LUNAS" ? "settled" : s === "SEBAGIAN" ? "progress" : s === "BELUM" ? "waiting" : "inactive";
}

/**
 * Status yang berlaku untuk dibaca. Fee 0 selalu TIDAK_PERLU; fee > 0 yang
 * masih tercatat TIDAK_PERLU (fee diisi sesudah kolaborasi dibuat) dibaca
 * BELUM — fee yang belum dibayar tidak boleh tersembunyi karena statusnya
 * tidak ikut diperbarui.
 */
export function statusBayarEfektif(fee: number, payStatus: StatusBayar): StatusBayar {
  if (keSen(angkaSah(fee) ? fee : 0) <= 0) return "TIDAK_PERLU";
  return payStatus === "TIDAK_PERLU" ? "BELUM" : payStatus;
}

export type KeadaanBayar = { fee: number; paidAmount: number; payStatus: StatusBayar };

/** Yang sudah dibayar menurut catatan; TIDAK_PERLU selalu nol. */
export function dibayar(k: KeadaanBayar): number {
  if (k.payStatus === "TIDAK_PERLU") return 0;
  return dariSen(Math.max(0, keSen(k.paidAmount)));
}

/** Sisa yang masih harus dibayar: fee − dibayar, tidak pernah negatif. */
export function sisaBayar(k: KeadaanBayar): number {
  if (k.payStatus === "TIDAK_PERLU") return 0;
  return dariSen(Math.max(0, keSen(k.fee) - keSen(dibayar(k))));
}

export type RingkasTagihan = { jumlah: number; totalFee: number; dibayar: number; sisa: number };

/** Tiga kartu Pembayaran (total fee, sudah dibayar, sisa) — aman-sen. */
export function ringkasTagihan(baris: readonly KeadaanBayar[]): RingkasTagihan {
  let fee = 0;
  let bayar = 0;
  let sisa = 0;
  for (const b of baris) {
    fee += keSen(b.fee);
    bayar += keSen(dibayar(b));
    sisa += keSen(sisaBayar(b));
  }
  return { jumlah: baris.length, totalFee: dariSen(fee), dibayar: dariSen(bayar), sisa: dariSen(sisa) };
}

export type StatusDialogBayar = "LUNAS" | "SEBAGIAN" | "BELUM";

export type RingkasDialogBayar = {
  jumlah: number;
  totalFee: number;
  /** Total sudah dibayar seluruh yang dipilih SESUDAH disimpan. */
  dibayarSesudah: number;
  /** Selisih terhadap yang sudah tercatat (negatif bila dikembalikan). */
  tambahan: number;
  /** Baris yang isiannya akan ditolak, per id. */
  galat: Record<string, KodeTolakBayar>;
};

/**
 * Isi dialog "Tandai dibayar" untuk SEMUA kolaborasi yang dipilih — bukan hanya
 * yang tampil di halaman ini (bug KOL Manager: totalnya hanya menjumlah satu
 * halaman, padahal pilihannya bertahan lintas halaman). Untuk SEBAGIAN setiap
 * baris membawa jumlahnya sendiri.
 */
export function ringkasDialogBayar(
  dipilih: readonly (KeadaanBayar & { id: string })[],
  status: StatusDialogBayar,
  jumlahPerBaris: Readonly<Record<string, number | null | undefined>>,
  hariIni = "9999-12-31",
): RingkasDialogBayar {
  let fee = 0;
  let sesudah = 0;
  let sebelum = 0;
  const galat: Record<string, KodeTolakBayar> = {};
  for (const b of dipilih) {
    fee += keSen(b.fee);
    sebelum += keSen(dibayar(b));
    const r = rencanaPembayaran({ fee: b.fee, status, jumlah: jumlahPerBaris[b.id], hariIni });
    if (!r.ok) {
      galat[b.id] = r.kode;
      sesudah += keSen(dibayar(b));
    } else {
      sesudah += keSen(r.paidAmount);
    }
  }
  return { jumlah: dipilih.length, totalFee: dariSen(fee), dibayarSesudah: dariSen(sesudah), tambahan: dariSen(sesudah - sebelum), galat };
}
