import { describe, expect, it } from "vitest";
import {
  batasDasarPotongSen,
  cakupanUangMukaDipotong,
  dasarPotongBawaanSen,
  hitungPembayaran,
  kunciDokumenHutang,
  uangMukaTerpotongSen,
  type AlokasiSah,
  type SisaDokumen,
} from "./pembayaran-aturan";
import {
  adalahPotongUangMuka,
  hitungUangMukaBelumDipotong,
  kunciPotongUangMuka,
  rencanaPotongPenerapan,
  susunJejakUangMuka,
} from "./pembayaran-uang-muka";

/*
 * PPh atas jasa yang sebagian dibayar dengan UANG MUKA (uji akuntansi 2,
 * Okt 2026): jasa jahit Rp 1.225.000, uang muka Rp 500.000 diterapkan,
 * pelunasan Rp 725.000. Dulu PPh 23 hanya dipotong atas alokasi pelunasan
 * (Rp 14.500); uang muka tidak pernah dipotong. Benar: total PPh atas satu
 * dokumen = tarif × dasar dokumen itu (2% × 1.225.000 = Rp 24.500), apa pun
 * urutan uang muka dan pembayarannya.
 *
 * Semua uang dalam SEN.
 */

const W = "w1";
const KW = kunciDokumenHutang("WO_STEP", W);
const jasa = (sisaSen: number, belum = 0, porsi = 1): Map<string, SisaDokumen> =>
  new Map([[KW, { sisaSen, porsiDasarPotong: porsi, uangMukaBelumDipotongSen: belum }]]);
const bayar = (sen: number): AlokasiSah[] => [{ jenis: "WO_STEP", id: W, sen }];
const pph23 = (dasarSen: number, brutoSen: number) => hitungPembayaran(brutoSen, "PPH23", dasarSen, true).potongSen;

describe("dasar potongan pelunasan memasukkan uang muka yang belum dipotong", () => {
  it("uang muka 500.000 diterapkan dulu, lalu pelunasan 725.000 → dasar 1.225.000, PPh 24.500, keluar 700.500", () => {
    const sisa = jasa(72_500_000, 50_000_000);
    const dasar = dasarPotongBawaanSen("PPH23", bayar(72_500_000), sisa, 72_500_000);
    expect(dasar).toBe(122_500_000);
    expect(hitungPembayaran(72_500_000, "PPH23", dasar, true)).toEqual({ brutoSen: 72_500_000, dasarPotongSen: 122_500_000, potongSen: 2_450_000, netoSen: 70_050_000 });
    expect(cakupanUangMukaDipotong("PPH23", bayar(72_500_000), sisa)).toEqual([{ jenis: "WO_STEP", id: W, sen: 50_000_000 }]);
  });

  it("dua pembayaran sebagian tanpa uang muka: 600.000 + 625.000 → 12.000 + 12.500 = 24.500", () => {
    const pertama = pph23(dasarPotongBawaanSen("PPH23", bayar(60_000_000), jasa(122_500_000), 60_000_000), 60_000_000);
    const kedua = pph23(dasarPotongBawaanSen("PPH23", bayar(62_500_000), jasa(62_500_000), 62_500_000), 62_500_000);
    expect([pertama, kedua]).toEqual([1_200_000, 1_250_000]);
    expect(pertama + kedua).toBe(2_450_000);
    expect(cakupanUangMukaDipotong("PPH23", bayar(60_000_000), jasa(122_500_000))).toEqual([]);
  });

  it("dokumen jasa ber-PPN: uang muka ikut dasar sebesar porsi jasa tanpa PPN", () => {
    const sisa = jasa(55_500_000, 55_500_000, 100 / 111);
    expect(dasarPotongBawaanSen("PPH23", bayar(55_500_000), sisa, 55_500_000)).toBe(100_000_000);
  });

  it("barang (porsi 0) tidak menjadi dasar walau ada uang muka diterapkan; PPh 4(2) memakai bruto + uang muka belum dipotong", () => {
    const sisa = new Map<string, SisaDokumen>([[kunciDokumenHutang("GRN", "g1"), { sisaSen: 10_000_000, porsiDasarPotong: 0, uangMukaBelumDipotongSen: 5_000_000 }]]);
    const a: AlokasiSah[] = [{ jenis: "GRN", id: "g1", sen: 10_000_000 }];
    expect(dasarPotongBawaanSen("PPH23", a, sisa, 10_000_000)).toBe(0);
    expect(cakupanUangMukaDipotong("PPH23", a, sisa)).toEqual([]);
    expect(dasarPotongBawaanSen("PPH4_2", a, sisa, 10_000_000)).toBe(15_000_000);
    expect(cakupanUangMukaDipotong("PPH4_2", a, sisa)).toEqual([{ jenis: "GRN", id: "g1", sen: 5_000_000 }]);
  });

  it("kredit (uang muka sudah dipotong lebih dulu, nilainya negatif) mengurangi dasar, tidak pernah di bawah nol", () => {
    expect(dasarPotongBawaanSen("PPH23", bayar(50_000_000), jasa(50_000_000, -50_000_000), 50_000_000)).toBe(0);
    expect(cakupanUangMukaDipotong("PPH23", bayar(50_000_000), jasa(50_000_000, -50_000_000))).toEqual([{ jenis: "WO_STEP", id: W, sen: -50_000_000 }]);
    expect(dasarPotongBawaanSen("PPH23", bayar(30_000_000), jasa(80_000_000, -50_000_000), 30_000_000)).toBe(0);
    expect(cakupanUangMukaDipotong("PPH23", bayar(30_000_000), jasa(80_000_000, -50_000_000))).toEqual([{ jenis: "WO_STEP", id: W, sen: -30_000_000 }]);
  });

  it("dasar yang diketik boleh sampai bruto + uang muka belum dipotong dokumen yang dibayar", () => {
    expect(batasDasarPotongSen(bayar(72_500_000), jasa(72_500_000, 50_000_000), 72_500_000)).toBe(122_500_000);
    expect(batasDasarPotongSen(bayar(72_500_000), jasa(72_500_000, -10_000_000), 72_500_000)).toBe(72_500_000);
    expect(batasDasarPotongSen([], new Map(), 500)).toBe(500);
  });

  it("PPh dibatasi bruto (bayar kecil, uang muka besar belum dipotong): cakupan dikecilkan sebanding", () => {
    expect(cakupanUangMukaDipotong("PPH23", bayar(100_000), jasa(100_000, 50_000_000), 0.5)).toEqual([{ jenis: "WO_STEP", id: W, sen: 25_000_000 }]);
  });
});

describe("uang muka yang sudah dipotong saat dibayar", () => {
  it("PPh 4(2): seluruh uang muka sudah dipotong (dasar = bruto)", () => {
    expect(uangMukaTerpotongSen("PPH4_2", [], new Map(), 100_000_000, 100_000_000)).toBe(100_000_000);
  });

  it("PPh 23 bawaan: uang muka murni tidak dipotong; dasar yang diketik untuk uang muka dicatat sebagai sudah dipotong", () => {
    expect(uangMukaTerpotongSen("PPH23", [], new Map(), 50_000_000, 0)).toBe(0);
    expect(uangMukaTerpotongSen("PPH23", [], new Map(), 50_000_000, 50_000_000)).toBe(50_000_000);
    // Campuran: alokasi jasa 100.000 + uang muka 50.000, dasar diketik 120.000 → 20.000 uang muka sudah dipotong.
    expect(uangMukaTerpotongSen("PPH23", bayar(10_000_000), jasa(10_000_000), 5_000_000, 12_000_000)).toBe(2_000_000);
    expect(uangMukaTerpotongSen(null, [], new Map(), 50_000_000, 50_000_000)).toBe(0);
  });
});

describe("rencanaPotongPenerapan — uang muka diterapkan ke dokumen jasa", () => {
  const dasar = { jenis: "PPH23" as const, adaNpwp: true };

  it("dokumen belum lunas: tidak dipotong sekarang (ditunda ke pelunasan), seluruh uang muka dialokasikan", () => {
    const r = rencanaPotongPenerapan({ ...dasar, alokasi: bayar(50_000_000), sisa: jasa(122_500_000), poolSen: 0 });
    expect(r.potongSen).toBe(0);
    expect(r.baris).toEqual([{ jenis: "WO_STEP", id: W, dariUangMukaSen: 50_000_000, alokasiPotongSen: 0, dasarSen: 0, potongSen: 0, cakupanSen: 0 }]);
  });

  it("pelunasan 725.000 lebih dulu, lalu uang muka 500.000 melunasi dokumen: PPh 10.000 dipotong sekarang", () => {
    const r = rencanaPotongPenerapan({ ...dasar, alokasi: bayar(50_000_000), sisa: jasa(50_000_000), poolSen: 0 });
    expect(r.baris).toEqual([{ jenis: "WO_STEP", id: W, dariUangMukaSen: 49_000_000, alokasiPotongSen: 1_000_000, dasarSen: 50_000_000, potongSen: 1_000_000, cakupanSen: 49_000_000 }]);
    expect(r.potongSen).toBe(1_000_000);
    // Total dokumen: 14.500 (pelunasan) + 10.000 = 24.500.
    expect(pph23(72_500_000, 72_500_000) + r.potongSen).toBe(2_450_000);
  });

  it("uang muka lebih besar dari dokumen (2.000.000 untuk 1.225.000): PPh 24.500, uang muka terpakai 1.200.500", () => {
    const r = rencanaPotongPenerapan({ ...dasar, alokasi: bayar(122_500_000), sisa: jasa(122_500_000), poolSen: 0 });
    expect(r.baris[0]).toMatchObject({ dariUangMukaSen: 120_050_000, alokasiPotongSen: 2_450_000, dasarSen: 122_500_000, potongSen: 2_450_000, cakupanSen: 120_050_000 });
  });

  it("melunasi dokumen yang sudah punya uang muka tertunda: semua yang belum dipotong ikut dasar", () => {
    const r = rencanaPotongPenerapan({ ...dasar, alokasi: bayar(72_500_000), sisa: jasa(72_500_000, 50_000_000), poolSen: 0 });
    expect(r.baris[0]).toMatchObject({ dasarSen: 122_500_000, potongSen: 2_450_000, alokasiPotongSen: 2_450_000, dariUangMukaSen: 70_050_000, cakupanSen: 120_050_000 });
  });

  it("uang muka yang sudah dipotong saat dibayar (pool) tidak dipotong lagi", () => {
    const r = rencanaPotongPenerapan({ ...dasar, alokasi: bayar(50_000_000), sisa: jasa(50_000_000), poolSen: 50_000_000 });
    expect(r.potongSen).toBe(0);
    expect(r.baris[0]).toMatchObject({ dariUangMukaSen: 50_000_000, alokasiPotongSen: 0 });
    expect(r.sisaPoolSen).toBe(0);
  });

  it("PPh 4(2) uang muka sewa (sudah dipotong saat dibayar): tidak ada potongan kedua", () => {
    const sisa = new Map<string, SisaDokumen>([[kunciDokumenHutang("GRN", "g1"), { sisaSen: 100_000_000, porsiDasarPotong: 0 }]]);
    const r = rencanaPotongPenerapan({ jenis: "PPH4_2", adaNpwp: true, alokasi: [{ jenis: "GRN", id: "g1", sen: 100_000_000 }], sisa, poolSen: 100_000_000 });
    expect(r.potongSen).toBe(0);
  });

  it("PPh 21 penjahit perorangan: 50% × 5% atas uang muka yang melunasi dokumen", () => {
    const r = rencanaPotongPenerapan({ jenis: "PPH21", adaNpwp: true, alokasi: bayar(50_000_000), sisa: jasa(50_000_000), poolSen: 0 });
    expect(r.potongSen).toBe(1_250_000);
    expect(r.baris[0]).toMatchObject({ dariUangMukaSen: 48_750_000, alokasiPotongSen: 1_250_000 });
  });

  it("pemasok tanpa jenis potong: tidak pernah dipotong", () => {
    expect(rencanaPotongPenerapan({ jenis: null, adaNpwp: true, alokasi: bayar(50_000_000), sisa: jasa(50_000_000), poolSen: 0 }).potongSen).toBe(0);
  });
});

describe("hitungUangMukaBelumDipotong — buku pembantu per dokumen", () => {
  const p = (x: Partial<Parameters<typeof hitungUangMukaBelumDipotong>[0][number]> & { id: string }) => ({
    alokasi: [] as Array<{ kunci: string; sen: number }>,
    diterapkan: [] as string[],
    terpotongSen: 0,
    menutup: [] as Array<{ kunci: string; sen: number }>,
    ...x,
  });

  it("uang muka diterapkan = tertunda; pelunasan yang memotongnya menutup", () => {
    const um = p({ id: "um", alokasi: [{ kunci: KW, sen: 50_000_000 }], diterapkan: [KW] });
    expect(hitungUangMukaBelumDipotong([um]).perDokumen.get(KW)).toBe(50_000_000);
    const lunas = p({ id: "q", alokasi: [{ kunci: KW, sen: 72_500_000 }], menutup: [{ kunci: KW, sen: 50_000_000 }] });
    expect(hitungUangMukaBelumDipotong([um, lunas]).perDokumen.has(KW)).toBe(false);
  });

  it("pool uang muka yang sudah dipotong dipakai berurutan; sisanya dilaporkan per pembayaran", () => {
    const K2 = kunciDokumenHutang("WO_STEP", "w2");
    const um = p({ id: "um", alokasi: [{ kunci: KW, sen: 30_000_000 }, { kunci: K2, sen: 40_000_000 }], diterapkan: [KW, K2], terpotongSen: 50_000_000 });
    const r = hitungUangMukaBelumDipotong([um]);
    expect(r.perDokumen.has(KW)).toBe(false);
    expect(r.perDokumen.get(K2)).toBe(20_000_000);
    expect(r.sisaTerpotong.get("um")).toBe(0);
  });

  it("pembayaran uang muka dibatalkan sesudah pelunasan memotongnya: tersisa kredit (negatif), bukan potongan kedua", () => {
    const lunas = p({ id: "q", alokasi: [{ kunci: KW, sen: 72_500_000 }], menutup: [{ kunci: KW, sen: 50_000_000 }] });
    expect(hitungUangMukaBelumDipotong([lunas]).perDokumen.get(KW)).toBe(-50_000_000);
  });

  it("alokasi yang tidak ada lagi diabaikan; alokasi saat dibuat tidak pernah tertunda", () => {
    const q = p({ id: "q", alokasi: [{ kunci: KW, sen: 10_000_000 }], diterapkan: ["WO_STEP|hilang"] });
    expect(hitungUangMukaBelumDipotong([q]).perDokumen.size).toBe(0);
  });
});

describe("susunJejakUangMuka — membaca jejak pembayaran", () => {
  const porsi = (k: string) => (k === KW ? 1 : 0);

  it("jejak baru: uang muka terpotong dan cakupan dibaca apa adanya; urutan penerapan dari jejak", () => {
    const r = susunJejakUangMuka(
      [
        { action: "SUPPLIER_PAYMENT_RECORDED", changes: { after: { uangMuka: 500_000, alokasi: [] } }, metadata: { jenisPotong: "PPH23", dasarPotong: 0, uangMukaTerpotong: 0, uangMukaDipotong: [] } },
        { action: "SUPPLIER_ADVANCE_APPLIED", changes: null, metadata: { alokasi: [{ jenis: "WO_STEP", id: W, jumlah: 500_000 }] } },
      ],
      porsi,
    );
    expect(r).toEqual({ terpotongSen: 0, diterapkan: [KW], menutup: [] });
    const q = susunJejakUangMuka(
      [{ action: "SUPPLIER_PAYMENT_RECORDED", changes: null, metadata: { uangMukaTerpotong: 0, uangMukaDipotong: [{ jenis: "WO_STEP", id: W, jumlah: 500_000 }] } }],
      porsi,
    );
    expect(q.menutup).toEqual([{ kunci: KW, sen: 50_000_000 }]);
  });

  it("jejak lama (sebelum perbaikan): uang muka 4(2) dianggap sudah dipotong; PPh 23 bawaan tidak", () => {
    const sewa = susunJejakUangMuka(
      [{ action: "SUPPLIER_PAYMENT_RECORDED", changes: { after: { uangMuka: 1_000_000, alokasi: [], potong: 100_000 } }, metadata: { jenisPotong: "PPH4_2", dasarPotong: 1_000_000 } }],
      porsi,
    );
    expect(sewa.terpotongSen).toBe(100_000_000);
    const jasaLama = susunJejakUangMuka(
      [{ action: "SUPPLIER_PAYMENT_RECORDED", changes: { after: { uangMuka: 500_000, alokasi: [{ jenis: "WO_STEP", id: W, jumlah: 100_000 }], potong: 2_000 } }, metadata: { jenisPotong: "PPH23", dasarPotong: 100_000 } }],
      porsi,
    );
    expect(jasaLama.terpotongSen).toBe(0);
  });

  it("kunci pembayaran potongan uang muka", () => {
    expect(kunciPotongUangMuka("byr1", "BYR/2001/03/0002")).toBe("potong-uang-muka:byr1:BYR/2001/03/0002");
    expect(adalahPotongUangMuka("potong-uang-muka:byr1:BYR/2001/03/0002", "byr1")).toBe(true);
    expect(adalahPotongUangMuka("potong-uang-muka:byr1:BYR/2001/03/0002", "byr2")).toBe(false);
    expect(adalahPotongUangMuka("potong-uang-muka:byr1:BYR/2001/03/0002")).toBe(true);
    expect(adalahPotongUangMuka(null)).toBe(false);
  });
});
