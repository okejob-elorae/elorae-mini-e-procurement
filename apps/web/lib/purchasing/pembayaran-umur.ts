/**
 * Umur hutang pemasok — MURNI, aman untuk klien, dites.
 *
 * Kelompok umur dihitung dari TANGGAL DOKUMEN hutang (tanggal GRN, tanggal
 * penerimaan barang jadi pertama untuk jasa WO, tanggal jurnal saldo awal)
 * sampai tanggal laporan, dalam hari kalender: 0–30, 31–60, 61–90, > 90.
 * Sisa negatif (lebih bayar) dan uang muka yang belum terpakai masuk kolom
 * KREDIT, bukan mengurangi kelompok umur tertentu.
 */

export const KELOMPOK_UMUR = ["0_30", "31_60", "61_90", "LEBIH_90"] as const;
export type KelompokUmur = (typeof KELOMPOK_UMUR)[number];

const msHari = (t: string) => Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));

export function umurHari(tanggalDokumen: string, tanggalLaporan: string): number {
  return Math.round((msHari(tanggalLaporan) - msHari(tanggalDokumen)) / 86_400_000);
}

export function kelompokUmur(hari: number): KelompokUmur {
  if (hari <= 30) return "0_30";
  if (hari <= 60) return "31_60";
  if (hari <= 90) return "61_90";
  return "LEBIH_90";
}

export type DokumenUmur = { kunci: string; tanggal: string; sisaSen: number };

/**
 * Kredit tingkat PO (retur pemasok, tombol lama "Tandai lunas") diterapkan ke
 * dokumen hutang PO itu dari yang TERTUA. Sisa kredit yang tidak terserap
 * dikembalikan sebagai `sisaKreditSen` (lebih bayar).
 */
export function terapkanFifo<T extends DokumenUmur>(dokumen: readonly T[], kreditSen: number): { dokumen: T[]; sisaKreditSen: number } {
  let sisa = Math.max(0, kreditSen);
  const urut = [...dokumen].sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kunci.localeCompare(b.kunci));
  const hasil = urut.map((d) => {
    if (sisa <= 0 || d.sisaSen <= 0) return { ...d };
    const pakai = Math.min(sisa, d.sisaSen);
    sisa -= pakai;
    return { ...d, sisaSen: d.sisaSen - pakai };
  });
  return { dokumen: hasil, sisaKreditSen: sisa };
}

export type BarisUmur = Record<KelompokUmur, number> & { kreditSen: number; totalSen: number; netoSen: number };

export const BARIS_UMUR_KOSONG: BarisUmur = { "0_30": 0, "31_60": 0, "61_90": 0, LEBIH_90: 0, kreditSen: 0, totalSen: 0, netoSen: 0 };

/** Kelompokkan sisa dokumen; `kreditSen` = uang muka + lebih bayar lain (positif). */
export function susunUmur(dokumen: readonly DokumenUmur[], tanggalLaporan: string, kreditSen = 0): BarisUmur {
  const b: BarisUmur = { ...BARIS_UMUR_KOSONG };
  for (const d of dokumen) {
    if (d.sisaSen === 0) continue;
    if (d.sisaSen < 0) {
      b.kreditSen += -d.sisaSen;
      continue;
    }
    const k = kelompokUmur(umurHari(d.tanggal, tanggalLaporan));
    b[k] += d.sisaSen;
    b.totalSen += d.sisaSen;
  }
  b.kreditSen += Math.max(0, kreditSen);
  b.netoSen = b.totalSen - b.kreditSen;
  return b;
}

export function jumlahkanUmur(baris: readonly BarisUmur[]): BarisUmur {
  const t: BarisUmur = { ...BARIS_UMUR_KOSONG };
  for (const b of baris) {
    for (const k of KELOMPOK_UMUR) t[k] += b[k];
    t.kreditSen += b.kreditSen;
    t.totalSen += b.totalSen;
    t.netoSen += b.netoSen;
  }
  return t;
}
