import { formatDisplayDate } from "@/lib/date-only";
import type { KodeRingkasan } from "@/lib/salesman/hasil-kunjungan";
import type { KodeJanggal, MetrikLapangan, PresetRentang, Rentang } from "@/lib/salesman/metrik-lapangan";
import type { KinerjaSales } from "@/lib/salesman/metrik-queries";

/**
 * Bentuk data dasbor kinerja sales yang dikirim ke komponen klien: hanya
 * angka dan teks, tanpa `Date` (tanggal/jam diformat di server). Modul ini
 * aman diimpor klien — impor dari kueri hanya TIPE.
 */

export type AngkaSales = {
  kunjungan: number;
  tokoDikunjungi: number;
  efektif: number;
  persenEfektif: number | null;
  berlangsung: number;
  janggal: number;
  pesanan: MetrikLapangan["pesanan"];
  van: MetrikLapangan["van"];
  pelunasan: MetrikLapangan["pelunasan"];
  retur: number;
  tokoBaru: number;
  menitLapangan: number;
  hariAktif: number;
  rencana: { direncanakan: number; dikunjungi: number; persen: number | null } | null;
  tokoMenurun: number | null;
  target: { target: number; capai: number; persen: number } | null;
  /** Jadwal kantor di rentang; null = tidak dimuat atau tidak ada jadwal sama sekali. */
  jadwal: { direncanakan: number; dikunjungi: number; terlewat: number } | null;
};

export type BarisHasil = { kode: KodeRingkasan; jumlah: number };
export type BarisTanda = { kode: KodeJanggal; jumlah: number };

export function keAngka(
  m: MetrikLapangan,
  tambahan: Partial<Pick<KinerjaSales, "rencana" | "tokoMenurun" | "target" | "jadwal">> = {},
): AngkaSales {
  return {
    kunjungan: m.kunjungan,
    tokoDikunjungi: m.tokoDikunjungi,
    efektif: m.efektif,
    persenEfektif: m.persenEfektif,
    berlangsung: m.berlangsung,
    janggal: m.janggal,
    pesanan: m.pesanan,
    van: m.van,
    pelunasan: m.pelunasan,
    retur: m.retur,
    tokoBaru: m.tokoBaru,
    menitLapangan: m.lapangan.menit,
    hariAktif: m.lapangan.hariAktif,
    rencana: tambahan.rencana
      ? {
          direncanakan: tambahan.rencana.direncanakan,
          dikunjungi: tambahan.rencana.dikunjungi,
          persen: tambahan.rencana.persen,
        }
      : null,
    tokoMenurun: tambahan.tokoMenurun ?? null,
    target: tambahan.target
      ? { target: tambahan.target.target, capai: tambahan.target.capai, persen: tambahan.target.persen }
      : null,
    jadwal:
      tambahan.jadwal && tambahan.jadwal.direncanakan > 0
        ? {
            direncanakan: tambahan.jadwal.direncanakan,
            dikunjungi: tambahan.jadwal.dikunjungi,
            terlewat: tambahan.jadwal.terlewat,
          }
        : null,
  };
}

/** Parameter alamat untuk rentang yang sedang dilihat — dibawa ke rincian dan kembali. */
export function paramRentang(preset: PresetRentang, r: Rentang): string {
  return preset === "kustom" ? `rentang=kustom&dari=${r.dari}&sampai=${r.sampai}` : `rentang=${preset}`;
}

/** "30 Sep 2026" atau "1 Sep 2026 – 30 Sep 2026" — dipanggil di server (tanggal diformat di server). */
export function labelRentang(r: Rentang): string {
  const tgl = (k: string) => formatDisplayDate(new Date(`${k}T00:00:00+07:00`));
  return r.dari === r.sampai ? tgl(r.dari) : `${tgl(r.dari)} – ${tgl(r.sampai)}`;
}

export type FilterRentangData = {
  preset: PresetRentang;
  dari: string;
  sampai: string;
  /** Sudah diformat di server. */
  label: string;
};
