import { kunciHariWib } from "@/lib/dashboard/tren";
import { formatDisplayDate } from "@/lib/date-only";
import { jumlahkanPenjualan, susunPenjualanSalesman } from "./dasbor";
import { rentangBulanWib, type SkemaKomisi } from "./komisi";
import { komisiSalesman } from "./komisi-queries";
import { bulanWib } from "./pengaturan";
import {
  jumlahHp,
  pcsKonsiBulan,
  trenHp,
  type BarisPcsKonsi,
  type InsentifHp,
  type JumlahHp,
  type TitikTrenHp,
} from "./penjualan-hp";
import { pcsDariLaku } from "./penjualan-konsi";
import { lakuKonsiSatuSalesman } from "./penjualan-konsi-queries";
import { penjualanSalesman } from "./queries";

/**
 * Kueri angka penjualan untuk HP salesman. Aturannya di `penjualan-hp.ts`:
 * angka HP = angka kantor, rupiah konsinyasi laku ikut (P56). Sumbernya
 * `penjualanSalesman` — tidak dihitung ulang dengan definisi lain — jadi setiap
 * kanal di HP sama dengan angka kantor.
 *
 * Client screens hanya boleh `import type` dari berkas ini (memuat Prisma).
 */

/** Jendela grafik beranda: 30 hari + 30 hari pembanding, selalu mencakup awal bulan ini. */
export const HARI_GRAFIK_BERANDA = 60;

/**
 * Pcs konsinyasi LAKU salesman sejak `sejak` (dan sebelum `sebelum`, bila
 * ada): barang yang laku di toko konsinyasi yang ia pegang — sumber, tanggal,
 * dan pemilik yang sama dengan baris konsi di `penjualanSalesman`
 * (`penjualan-konsi.ts`). Pcs-nya ditunjukkan di samping rupiah konsinyasi.
 */
export async function pcsKonsiSalesman(salesmanId: string, sejak: Date, sebelum?: Date): Promise<BarisPcsKonsi[]> {
  if (!salesmanId) return [];
  return pcsDariLaku(await lakuKonsiSatuSalesman(salesmanId, sejak, { sebelum }));
}

/** Kartu "Bulan ini" dan grafik 30 hari di beranda HP. */
export async function berandaPenjualanHp(
  salesmanId: string,
  hariIni: Date,
): Promise<{ bulanIni: JumlahHp; tren: TitikTrenHp[] }> {
  const sejak = new Date(Date.parse(`${kunciHariWib(hariIni)}T00:00:00+07:00`) - HARI_GRAFIK_BERANDA * 86_400_000);
  // Laku konsi dibaca sekali: rupiahnya ikut penjualan (P56), pcs-nya untuk kartu.
  const laku = lakuKonsiSatuSalesman(salesmanId, sejak);
  const [jual, pcs] = await Promise.all([penjualanSalesman(salesmanId, sejak, { lakuKonsi: laku }), laku.then(pcsDariLaku)]);
  const titik = susunPenjualanSalesman(jual, hariIni, HARI_GRAFIK_BERANDA);
  const bulan = bulanWib(hariIni);
  // Bulan ini = titik harian yang tanggalnya di bulan kalender WIB yang sama.
  const j = jumlahkanPenjualan(titik.filter((x) => x.tanggal.startsWith(bulan)));
  return { bulanIni: jumlahHp(j, pcsKonsiBulan(pcs, bulan, hariIni)), tren: trenHp(titik) };
}

/** Payload halaman Insentif di HP (tanpa daftar bulan, yang dirakit halamannya). */
export async function insentifHp(
  salesmanId: string,
  bulan: string,
  opsi: { target?: number | null; skema?: SkemaKomisi; hariIni?: Date } = {},
): Promise<InsentifHp> {
  const rentang = rentangBulanWib(bulan);
  const [r, pcs] = await Promise.all([
    // Angka resmi kantor — omzet putus + konsi + van (P56).
    komisiSalesman(salesmanId, bulan, { target: opsi.target, skema: opsi.skema }),
    rentang ? pcsKonsiSalesman(salesmanId, rentang.awal, rentang.akhir) : Promise.resolve([]),
  ]);
  return {
    aktif: r.skema.aktif,
    dasar: r.hasil.dasar,
    komisi: r.hasil.komisi,
    dasarNilai: r.hasil.dasarNilai,
    tarifDasar: r.hasil.tarifDasar,
    tarifDipakai: r.hasil.tarifDipakai,
    capaianPersen: r.hasil.capaianPersen,
    target: r.target,
    omzet: jumlahHp(r.omzet, pcsKonsiBulan(pcs, bulan, opsi.hariIni ?? new Date())),
    tingkat: r.hasil.tingkat,
    tingkatBerikut: r.hasil.tingkatBerikut,
    bagianPenagihPersen: r.skema.bagianPenagihPersen,
    tertagih: r.tertagih,
    // Uang tertagih dari setiap piutang yang dilunasi BKM terverifikasi — juga
    // tagihan siklus konsinyasi, yang dicatat atas nama pemegang toko saat
    // angkanya dikunci (P55), jadi bagian penjual/penagihnya seperti piutang putus.
    baris: r.baris.map((b) => ({
      kunci: `${b.claimId}:${b.receivableId}`,
      docNo: b.docNo,
      toko: b.toko,
      invoiceNo: b.invoiceNo,
      tanggal: formatDisplayDate(b.verifiedAt),
      nilai: b.nilai,
      dilunasi: b.dilunasi,
      peran: b.peran,
      bagian: b.bagian,
    })),
  };
}
