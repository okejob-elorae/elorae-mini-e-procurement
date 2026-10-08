import type { TahunBulan } from "@/lib/finance/periode/periode";
import type { MetodePenyusutan } from "./kelompok";

/*
 * Jadwal penyusutan aset tetap (bagian D3). Murni — aman untuk komponen klien.
 *
 * Semua hitungan dalam SEN (bilangan bulat) dengan pembulatan kumulatif:
 * jumlah per bulan = target kumulatif bulan ini − target kumulatif bulan lalu,
 * jadi jumlah seluruh bulan PERSIS sama dengan nilai yang disusutkan.
 *
 * Masa manfaat mulai di bulan `mulai` (bawaan bulan perolehan — PMK 72/2023:
 * penyusutan dimulai pada bulan dilakukannya pengeluaran) dan berlangsung
 * `umurBulan` bulan.
 *
 * - Garis lurus: (harga perolehan − nilai sisa) ÷ umur, rata setiap bulan.
 * - Saldo menurun (fiskal): setiap tahun kalender, tarif setahun × nilai buku
 *   awal tahun itu (tahun pertama pro rata jumlah bulannya ÷ 12), dibagi rata ke
 *   bulan-bulannya. Tahun kalender TERAKHIR masa manfaat menghabiskan seluruh
 *   sisa nilai buku ("pada akhir masa manfaat nilai sisa buku disusutkan
 *   sekaligus"), dibagi rata ke bulan-bulan tersisanya. Tidak pernah di bawah
 *   nilai sisa.
 *
 * Yang DIPOSTING sebulan (`jumlahPenyusutanBulan`) = target kumulatif sampai
 * bulan itu − akumulasi awal (penyusutan sebelum masuk sistem) − semua yang
 * sudah diposting, dibatasi 0 … sisa yang bisa disusutkan. Akibatnya:
 * - aset lama yang akumulasi awalnya sesuai jadwal mulai diposting tepat di
 *   bulan sesudah akumulasi itu, tanpa perlu menyebut bulannya;
 * - bulan yang terlewat (mis. periodenya sudah ditutup) disusulkan otomatis di
 *   bulan berikutnya yang diposting;
 * - total tidak pernah melebihi jadwal, walau bulan diposting tidak berurutan.
 */

export type SpesifikasiPenyusutan = {
  biaya: number;
  nilaiSisa: number;
  umurBulan: number;
  metode: MetodePenyusutan;
  /** Tarif saldo menurun setahun (%), hanya untuk metode saldo menurun. */
  tarifSaldoMenurun: number | null;
  /** Bulan pertama masa manfaat. */
  mulai: TahunBulan;
};

export type BulanJadwal = {
  periode: string;
  tb: TahunBulan;
  jumlah: number;
  akumulasi: number;
  nilaiBuku: number;
};

const sen = (n: number): number => Math.round((Number(n) || 0) * 100);
const rupiah = (s: number): number => s / 100;

function kunci(tb: TahunBulan): string {
  return `${tb.tahun}-${String(tb.bulan).padStart(2, "0")}`;
}

/** Indeks bulan (0 = bulan mulai). */
export function indeksBulan(spek: Pick<SpesifikasiPenyusutan, "mulai">, tb: TahunBulan): number {
  return (tb.tahun - spek.mulai.tahun) * 12 + (tb.bulan - spek.mulai.bulan);
}

function tambahBulan(tb: TahunBulan, n: number): TahunBulan {
  const total = tb.tahun * 12 + (tb.bulan - 1) + n;
  return { tahun: Math.floor(total / 12), bulan: (total % 12) + 1 };
}

/** Bulan terakhir masa manfaat; null bila tidak disusutkan (tanah). */
export function akhirMasaManfaat(spek: Pick<SpesifikasiPenyusutan, "mulai" | "umurBulan">): TahunBulan | null {
  return spek.umurBulan > 0 ? tambahBulan(spek.mulai, spek.umurBulan - 1) : null;
}

export function dalamMasaManfaat(spek: Pick<SpesifikasiPenyusutan, "mulai" | "umurBulan">, tb: TahunBulan): boolean {
  const i = indeksBulan(spek, tb);
  return spek.umurBulan > 0 && i >= 0 && i < spek.umurBulan;
}

/** Jumlah per bulan (sen) sepanjang masa manfaat. */
function jumlahPerBulanSen(spek: SpesifikasiPenyusutan): number[] {
  const L = Math.max(0, Math.trunc(spek.umurBulan));
  if (L === 0) return [];
  const disusutkan = Math.max(0, sen(spek.biaya) - sen(spek.nilaiSisa));
  if (disusutkan === 0) return Array(L).fill(0);

  if (spek.metode !== "DECLINING_BALANCE" || !(Number(spek.tarifSaldoMenurun) > 0)) {
    const hasil: number[] = [];
    let lalu = 0;
    for (let k = 1; k <= L; k++) {
      const target = Math.round((disusutkan * k) / L);
      hasil.push(target - lalu);
      lalu = target;
    }
    return hasil;
  }

  // Saldo menurun: per segmen tahun kalender.
  const tarif = Number(spek.tarifSaldoMenurun) / 100;
  const hasil: number[] = [];
  let sisa = disusutkan; // nilai buku − nilai sisa
  let nilaiBuku = sen(spek.biaya);
  let i = 0;
  while (i < L) {
    const tb = tambahBulan(spek.mulai, i);
    const n = Math.min(12 - (tb.bulan - 1), L - i);
    const terakhir = i + n >= L;
    const segmen = terakhir ? sisa : Math.min(sisa, Math.round((nilaiBuku * tarif * n) / 12));
    let lalu = 0;
    for (let j = 1; j <= n; j++) {
      const kum = Math.round((segmen * j) / n);
      hasil.push(kum - lalu);
      lalu = kum;
    }
    sisa -= segmen;
    nilaiBuku -= segmen;
    i += n;
  }
  return hasil;
}

/** Seluruh jadwal: satu baris per bulan masa manfaat. */
export function jadwalPenyusutan(spek: SpesifikasiPenyusutan): BulanJadwal[] {
  const per = jumlahPerBulanSen(spek);
  const biaya = sen(spek.biaya);
  let akum = 0;
  return per.map((s, i) => {
    const tb = tambahBulan(spek.mulai, i);
    akum += s;
    return { periode: kunci(tb), tb, jumlah: rupiah(s), akumulasi: rupiah(akum), nilaiBuku: rupiah(biaya - akum) };
  });
}

/** Akumulasi penyusutan menurut jadwal sampai AKHIR bulan `tb` (sen). */
function targetSen(spek: SpesifikasiPenyusutan, tb: TahunBulan): number {
  const per = jumlahPerBulanSen(spek);
  if (per.length === 0) return 0;
  const i = indeksBulan(spek, tb);
  if (i < 0) return 0;
  const sampai = Math.min(i, per.length - 1);
  let s = 0;
  for (let k = 0; k <= sampai; k++) s += per[k];
  return s;
}

/** Akumulasi penyusutan menurut jadwal sampai akhir bulan `tb` (rupiah). */
export function akumulasiTargetSampai(spek: SpesifikasiPenyusutan, tb: TahunBulan): number {
  return rupiah(targetSen(spek, tb));
}

/**
 * Penyusutan yang diposting untuk bulan `tb`: target kumulatif − akumulasi awal
 * − semua yang sudah diposting (bulan mana pun), dibatasi 0 … sisa.
 */
export function jumlahPenyusutanBulan(
  spek: SpesifikasiPenyusutan,
  tb: TahunBulan,
  sudah: { akumulasiAwal: number; sudahDiposting: number },
): number {
  const tercatat = sen(sudah.akumulasiAwal) + sen(sudah.sudahDiposting);
  const sisa = Math.max(0, sen(spek.biaya) - sen(spek.nilaiSisa) - tercatat);
  const kurang = targetSen(spek, tb) - tercatat;
  return rupiah(Math.max(0, Math.min(kurang, sisa)));
}
