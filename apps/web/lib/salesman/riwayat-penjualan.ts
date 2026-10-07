import { kunciHariWib } from "@/lib/dashboard/tren";
import type { BarisJual, JenisJual } from "./dasbor";
import { bulanWib } from "./pengaturan";

/**
 * Riwayat penjualan salesman per bulan — aturan murni, tanpa basis data.
 * Kuerinya di `riwayat-penjualan-queries.ts`.
 *
 * Bahannya SELALU baris `penjualanSalesman` (`lib/salesman/queries.ts`), yaitu
 * sumber angka "Bulan ini" di beranda HP: putus = kiriman menurut tanggal
 * kirim, konsi = barang laku di toko konsinyasi menurut tanggal laku
 * (`penjualan-konsi.ts`), van = penjualan mobil menurut tanggal jual. Bulan = bulan kalender WIB, dan baris
 * bertanggal sesudah hari ini (WIB) tidak dihitung — sama dengan grafik beranda
 * yang berhenti di hari ini. Dengan begitu angka bulan ini di halaman riwayat
 * tidak pernah berbeda dari kartu beranda.
 */

export const JUMLAH_BULAN_RIWAYAT = 12;
export const BATAS_TOKO_TERATAS = 5;
export const BATAS_BARANG_TERATAS = 10;

const POLA_BULAN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type JumlahBulan = { putus: number; konsi: number; van: number; total: number };
export type TitikBulan = JumlahBulan & { bulan: string };

const kosong = (): JumlahBulan => ({ putus: 0, konsi: 0, van: 0, total: 0 });

/** "YYYY-MM" digeser `n` bulan (negatif = mundur). */
export function geserBulan(bulan: string, n: number): string {
  const [th, bl] = bulan.split("-").map(Number);
  const d = new Date(Date.UTC(th, bl - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Awal bulan (00.00 WIB tanggal 1) sebagai instant UTC. */
export function awalBulanWib(bulan: string): Date {
  return new Date(`${bulan}-01T00:00:00+07:00`);
}

/** `n` bulan kalender WIB yang berakhir di bulan ini, dari yang terlama. */
export function daftarBulan(hariIni: Date, n: number = JUMLAH_BULAN_RIWAYAT): string[] {
  const kini = bulanWib(hariIni);
  return Array.from({ length: n }, (_, i) => geserBulan(kini, i - (n - 1)));
}

/**
 * Bulan yang dipilih dari parameter alamat. Hanya bulan di dalam daftar yang
 * diterima — alamat yang disunting tangan jatuh ke bulan ini, bukan ke bulan
 * yang tidak punya grafik.
 */
export function pilihBulan(param: unknown, daftar: readonly string[]): string {
  const terakhir = daftar[daftar.length - 1];
  if (typeof param !== "string" || !POLA_BULAN.test(param)) return terakhir;
  return daftar.includes(param) ? param : terakhir;
}

/** Hari dalam sebulan ("YYYY-MM"). */
export function hariDalamBulan(bulan: string): number {
  const [th, bl] = bulan.split("-").map(Number);
  return new Date(Date.UTC(th, bl, 0)).getUTCDate();
}

/**
 * Jumlah satu bulan per kanal. `sampaiTanggal` membatasi ke tanggal 1..n bulan
 * itu (untuk membandingkan bulan berjalan dengan hari yang sama di bulan lain).
 * Baris sesudah hari ini (WIB) tidak pernah dihitung.
 */
export function jumlahSatuBulan(
  baris: readonly BarisJual[],
  bulan: string,
  hariIni: Date,
  sampaiTanggal: number | null = null,
): JumlahBulan {
  const batasHari = kunciHariWib(hariIni);
  const j = kosong();
  for (const b of baris) {
    const k = kunciHariWib(b.tanggal);
    if (!k.startsWith(bulan) || k > batasHari) continue;
    if (sampaiTanggal !== null && Number(k.slice(8, 10)) > sampaiTanggal) continue;
    j[b.jenis] += b.nilai;
  }
  j.total = j.putus + j.konsi + j.van;
  return j;
}

/** Seri bulanan untuk grafik — satu titik per bulan, bulan tanpa penjualan bernilai nol. */
export function susunSeriBulanan(baris: readonly BarisJual[], bulanDaftar: readonly string[], hariIni: Date): TitikBulan[] {
  const batasHari = kunciHariWib(hariIni);
  const peta = new Map<string, TitikBulan>(bulanDaftar.map((b) => [b, { bulan: b, ...kosong() }]));
  for (const b of baris) {
    const k = kunciHariWib(b.tanggal);
    if (k > batasHari) continue;
    const t = peta.get(k.slice(0, 7));
    if (t) t[b.jenis as JenisJual] += b.nilai;
  }
  for (const t of peta.values()) t.total = t.putus + t.konsi + t.van;
  return [...peta.values()];
}

export type Perubahan = { bulan: string; total: number; persen: number | null };

/** Persen perubahan; null bila pembandingnya nol (tidak ada dasar untuk persen). */
export function persenPerubahan(sekarang: number, dulu: number): number | null {
  return dulu > 0 ? Math.round(((sekarang - dulu) / dulu) * 100) : null;
}

export type RingkasanBulan = {
  bulan: string;
  jumlah: JumlahBulan;
  /**
   * Bulan BERJALAN dibandingkan pada tanggal yang sama (1..n) di bulan
   * pembandingnya — bulan yang baru berjalan sepuluh hari tidak adil disandingkan
   * dengan satu bulan penuh. null = bulan yang dipilih sudah lewat (penuh).
   */
  sampaiTanggal: number | null;
  sebulanLalu: Perubahan;
  setahunLalu: Perubahan;
};

export function ringkasBulan(baris: readonly BarisJual[], bulan: string, hariIni: Date): RingkasanBulan {
  const berjalan = bulan === bulanWib(hariIni);
  const tanggal = Number(kunciHariWib(hariIni).slice(8, 10));
  // Hari terakhir bulan berjalan = bulan penuh; tidak perlu "s.d. tanggal".
  const sampaiTanggal = berjalan && tanggal < hariDalamBulan(bulan) ? tanggal : null;
  const jumlah = jumlahSatuBulan(baris, bulan, hariIni);
  const banding = (b: string): Perubahan => {
    const total = jumlahSatuBulan(baris, b, hariIni, sampaiTanggal).total;
    return { bulan: b, total, persen: persenPerubahan(jumlah.total, total) };
  };
  return {
    bulan,
    jumlah,
    sampaiTanggal,
    sebulanLalu: banding(geserBulan(bulan, -1)),
    setahunLalu: banding(geserBulan(bulan, -12)),
  };
}

/**
 * Bulan terlama yang perlu dibaca: bulan terlama di grafik, dikurangi setahun
 * untuk pembanding "bulan yang sama tahun lalu".
 */
export function bulanAwalBacaan(bulanDaftar: readonly string[]): string {
  return geserBulan(bulanDaftar[0], -12);
}

// ─── Target ───────────────────────────────────────────────────────────────────

export type CapaianTarget = { target: number; capai: number; persen: number; kurang: number; tercapai: boolean };

/** Capaian satu bulan terhadap target totalnya; null bila bulan itu tidak punya target. */
export function capaianTarget(target: number | null | undefined, capai: number): CapaianTarget | null {
  if (!target || target <= 0) return null;
  return {
    target,
    capai,
    persen: Math.round((capai / target) * 100),
    kurang: Math.max(0, target - capai),
    tercapai: capai >= target,
  };
}

// ─── Toko dan barang teratas ──────────────────────────────────────────────────

/**
 * Satu dokumen penjualan ke satu toko. `nilai` adalah total dokumen; nilai
 * konsinyasi TIDAK PERNAH ditampilkan per toko di HP (nilai konsi satu toko ÷
 * pcs yang dikirim = harga konsinyasi), jadi baris konsi hanya menyumbang pcs.
 */
export type JualKeToko = { storeId: string | null; jenis: JenisJual; nilai: number; pcs: number };

export type TokoTeratas = { storeId: string; pcs: number; pcsKonsi: number; nilaiTanpaKonsi: number };

/**
 * Toko teratas sebulan, diurutkan menurut PCS: satu-satunya ukuran yang sama
 * adilnya bagi toko putus dan toko konsinyasi tanpa membuka harga konsinyasi.
 * Penjualan van ke pembeli tanpa toko (`storeId` null) bukan toko — dilewati.
 */
export function tokoTeratas(baris: readonly JualKeToko[], batas: number = BATAS_TOKO_TERATAS): TokoTeratas[] {
  const per = new Map<string, { pcs: number; pcsKonsi: number; sen: number }>();
  for (const b of baris) {
    if (!b.storeId) continue;
    let t = per.get(b.storeId);
    if (!t) per.set(b.storeId, (t = { pcs: 0, pcsKonsi: 0, sen: 0 }));
    t.pcs += b.pcs;
    if (b.jenis === "konsi") t.pcsKonsi += b.pcs;
    else t.sen += Math.round(b.nilai * 100);
  }
  return [...per]
    .map(([storeId, t]) => ({ storeId, pcs: t.pcs, pcsKonsi: t.pcsKonsi, nilaiTanpaKonsi: t.sen / 100 }))
    .filter((t) => t.pcs > 0 || t.nilaiTanpaKonsi !== 0)
    .sort((a, b) => b.pcs - a.pcs || b.nilaiTanpaKonsi - a.nilaiTanpaKonsi || a.storeId.localeCompare(b.storeId))
    .slice(0, batas);
}

export type BarangTeratas = { itemId: string; pcs: number; pcsKonsi: number; nilaiTanpaKonsi: number };

/**
 * Barang teratas sebulan dari capaian rinci (`capaianRinciSales`), menurut pcs.
 * Rupiahnya TANPA konsinyasi — aturan yang sama dengan target barang di HP
 * (`capaianUntukHp`): nilai konsi satu barang ÷ pcs = harga satuan konsi.
 */
export function barangTeratas(
  barang: Readonly<Record<string, { nilai: number; pcs: number }>>,
  barangKonsi: Readonly<Record<string, { nilai: number; pcs: number }>>,
  batas: number = BATAS_BARANG_TERATAS,
): BarangTeratas[] {
  return Object.entries(barang)
    .map(([itemId, x]) => {
      const k = barangKonsi[itemId];
      return {
        itemId,
        pcs: x.pcs,
        pcsKonsi: k?.pcs ?? 0,
        nilaiTanpaKonsi: Math.round((x.nilai - (k?.nilai ?? 0)) * 100) / 100,
      };
    })
    .filter((b) => b.pcs > 0)
    .sort((a, b) => b.pcs - a.pcs || b.nilaiTanpaKonsi - a.nilaiTanpaKonsi || a.itemId.localeCompare(b.itemId))
    .slice(0, batas);
}
