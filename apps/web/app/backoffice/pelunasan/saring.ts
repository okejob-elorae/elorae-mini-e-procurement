import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import type { StatusKlaim } from "@/lib/receivables/rules";

export type { StatusKlaim };

/**
 * Tab saringan daftar Pelunasan (BKM), urut tampil. "Semua" = jumlah keempatnya —
 * dulu BKM batal ikut dihitung di "Semua" tanpa punya tab sendiri, jadi
 * angka-angka tab tidak pernah berjumlah sama dengan "Semua".
 *
 * Murni: dipakai halaman server dan komponen klien, diuji tanpa basis data.
 */
export const URUT_STATUS_KLAIM: readonly StatusKlaim[] = ["DIKIRIM", "TERVERIFIKASI", "DITOLAK", "DIBATALKAN"];

/** `?status=` dari alamat. Nilai lain diabaikan (= semua), bukan ditolak. */
export function bacaStatusKlaim(raw: string | undefined | null): StatusKlaim | null {
  return raw && (URUT_STATUS_KLAIM as readonly string[]).includes(raw) ? (raw as StatusKlaim) : null;
}

/**
 * Saringan tanggal `?dari=YYYY-MM-DD&sampai=YYYY-MM-DD` — hari kalender WIB,
 * kedua ujung ikut. Teksnya disimpan apa adanya untuk keping saringan dan
 * tautan; instannya untuk membandingkan.
 */
export type PeriodeKlaim = {
  dari: string | null;
  sampai: string | null;
  mulai: Date | null;
  akhir: Date | null;
};

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

function bacaTanggal(raw: string | undefined | null): string | null {
  const t = (raw ?? "").trim();
  if (!POLA_TANGGAL.test(t)) return null;
  const d = parseDateOnly(t);
  // "2026-02-31" lolos pola tapi bergeser ke Maret — ditolak, bukan ditafsirkan.
  // Pulang-pergi lewat hari WIB yang sama membuktikan tanggalnya ada.
  return d && new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) === t ? t : null;
}

/** `null` = tanpa saringan tanggal. Ujung yang terbalik ditukar, bukan ditolak. */
export function bacaPeriodeKlaim(sp: { dari?: string | null; sampai?: string | null }): PeriodeKlaim | null {
  let dari = bacaTanggal(sp.dari);
  let sampai = bacaTanggal(sp.sampai);
  if (!dari && !sampai) return null;
  if (dari && sampai && dari > sampai) [dari, sampai] = [sampai, dari];
  return {
    dari,
    sampai,
    mulai: dari ? (parseDateOnly(dari) ?? null) : null,
    akhir: sampai ? (parseDateOnlyEnd(sampai) ?? null) : null,
  };
}

/** Bentuk minimum baris BKM untuk saringan tanggal. */
export type TanggalKlaim = {
  /** Tanggal transfer yang tertulis di BKM — kolom tanggal di daftar. */
  claimedTransferAt: Date | string;
  verifiedAt: Date | string | null;
};

/**
 * Tanggal yang dibandingkan dengan periode. Tab "Terverifikasi" memakai tanggal
 * VERIFIKASI — itulah hari uangnya diakui, dan angka "pelunasan terverifikasi
 * bulan ini" di layar lain dihitung dari sana. Tab lain memakai tanggal
 * transfer di BKM, kolom tanggal yang terlihat di daftar.
 */
export function tanggalPeriode(b: TanggalKlaim, status: StatusKlaim | null): Date | null {
  const v = status === "TERVERIFIKASI" ? b.verifiedAt : b.claimedTransferAt;
  if (v === null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dalamPeriode(b: TanggalKlaim, status: StatusKlaim | null, periode: PeriodeKlaim | null): boolean {
  if (!periode) return true;
  const d = tanggalPeriode(b, status);
  if (!d) return false;
  if (periode.mulai && d < periode.mulai) return false;
  if (periode.akhir && d > periode.akhir) return false;
  return true;
}

export type JumlahKlaim = Record<StatusKlaim, number> & { semua: number; koreksi: number };

/**
 * Angka setiap tab atas baris yang diberikan. Halaman memberinya baris yang
 * SUDAH cocok dengan kotak cari, supaya angka tab sama dengan jumlah baris yang
 * muncul saat tab itu diklik — termasuk saringan tanggal, yang dasar
 * tanggalnya ikut tab (lihat `tanggalPeriode`).
 */
export function hitungTabKlaim(
  baris: readonly ({ status: string; mintaKoreksi: boolean } & Partial<TanggalKlaim>)[],
  periode: PeriodeKlaim | null = null,
): JumlahKlaim {
  const jumlah: JumlahKlaim = { semua: 0, koreksi: 0, DIKIRIM: 0, TERVERIFIKASI: 0, DITOLAK: 0, DIBATALKAN: 0 };
  const tgl = (b: Partial<TanggalKlaim>): TanggalKlaim => ({
    claimedTransferAt: b.claimedTransferAt ?? "",
    verifiedAt: b.verifiedAt ?? null,
  });
  for (const b of baris) {
    if (dalamPeriode(tgl(b), null, periode)) {
      jumlah.semua += 1;
      if (b.mintaKoreksi) jumlah.koreksi += 1;
    }
    if ((URUT_STATUS_KLAIM as readonly string[]).includes(b.status)) {
      const s = b.status as StatusKlaim;
      if (dalamPeriode(tgl(b), s, periode)) jumlah[s] += 1;
    }
  }
  return jumlah;
}
