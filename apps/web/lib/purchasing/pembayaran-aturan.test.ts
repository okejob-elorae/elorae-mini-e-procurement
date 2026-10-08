import { describe, expect, it } from "vitest";
import {
  adalahCerminTandaiLunas,
  dasarPotongBawaanSen,
  hitungPembayaran,
  ID_SALDO_AWAL,
  kunciDokumenHutang,
  kunciTandaiLunas,
  memoAlokasi,
  periksaAlokasiTerhadapSisa,
  periksaPembayaran,
  uraianJurnalPembayaran,
  type SisaDokumen,
} from "./pembayaran-aturan";
import { jumlahkanUmur, kelompokUmur, susunUmur, terapkanFifo, umurHari } from "./pembayaran-umur";

const HARI_INI = "2026-10-08";
const dasar = { pemasokId: "s1", tanggal: "2026-10-07", cara: "TRANSFER", rekeningId: "bca" };

describe("periksaPembayaran", () => {
  it("menerima pembayaran sebagian ke banyak dokumen + uang muka", () => {
    const r = periksaPembayaran(
      {
        ...dasar,
        alokasi: [
          { jenis: "GRN", id: "g1", jumlah: "1.000.000" },
          { jenis: "WO_STEP", id: "w1", jumlah: 500000 },
          { jenis: "OTHER", id: ID_SALDO_AWAL, jumlah: "250000" },
          { jenis: "GRN", id: "g2", jumlah: "0" },
        ],
        uangMuka: "100000",
      },
      HARI_INI,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pembayaran.alokasi.map((a) => [a.jenis, a.id, a.sen])).toEqual([
      ["GRN", "g1", 100_000_000],
      ["WO_STEP", "w1", 50_000_000],
      ["OTHER", ID_SALDO_AWAL, 25_000_000],
    ]);
    expect(r.pembayaran.brutoSen).toBe(185_000_000);
    expect(r.pembayaran.uangMukaSen).toBe(10_000_000);
    expect(r.pembayaran.jenisPotong).toBeUndefined();
  });

  it("menolak isian rusak dengan kode yang tepat", () => {
    expect(periksaPembayaran({ ...dasar, pemasokId: "" }, HARI_INI)).toEqual({ ok: false, kode: "PEMASOK_WAJIB" });
    expect(periksaPembayaran({ ...dasar, tanggal: "2026-10-09", uangMuka: 1 }, HARI_INI)).toEqual({ ok: false, kode: "TANGGAL_MASA_DEPAN" });
    expect(periksaPembayaran({ ...dasar, cara: "CEK" }, HARI_INI)).toEqual({ ok: false, kode: "CARA_TIDAK_SAH" });
    expect(periksaPembayaran({ ...dasar, rekeningId: null }, HARI_INI)).toEqual({ ok: false, kode: "REKENING_WAJIB" });
    expect(periksaPembayaran({ ...dasar, alokasi: [] }, HARI_INI)).toEqual({ ok: false, kode: "KOSONG" });
    expect(periksaPembayaran({ ...dasar, alokasi: [{ jenis: "PO", id: "p", jumlah: 1 }] }, HARI_INI)).toEqual({ ok: false, kode: "ALOKASI_TIDAK_SAH", baris: 1 });
    expect(periksaPembayaran({ ...dasar, alokasi: [{ jenis: "OTHER", id: "x", jumlah: 1 }] }, HARI_INI)).toEqual({ ok: false, kode: "ALOKASI_TIDAK_SAH", baris: 1 });
    expect(
      periksaPembayaran({ ...dasar, alokasi: [{ jenis: "GRN", id: "g", jumlah: 1 }, { jenis: "GRN", id: "g", jumlah: 2 }] }, HARI_INI),
    ).toEqual({ ok: false, kode: "ALOKASI_GANDA", baris: 2 });
    expect(periksaPembayaran({ ...dasar, alokasi: [{ jenis: "GRN", id: "g", jumlah: "-1" }] }, HARI_INI)).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAH", baris: 1 });
    expect(periksaPembayaran({ ...dasar, uangMuka: 5, jenisPotong: "PPH9" }, HARI_INI)).toEqual({ ok: false, kode: "POTONG_TIDAK_SAH" });
    expect(periksaPembayaran({ ...dasar, uangMuka: 5, dasarPotong: 6 }, HARI_INI)).toEqual({ ok: false, kode: "DASAR_POTONG_TIDAK_SAH" });
  });

  it("jenis potong: kosong berarti tidak dipotong, tidak diisi berarti ikut pemasok", () => {
    const tanpa = periksaPembayaran({ ...dasar, uangMuka: 5, jenisPotong: "" }, HARI_INI);
    expect(tanpa.ok && tanpa.pembayaran.jenisPotong).toBeNull();
    const pph23 = periksaPembayaran({ ...dasar, uangMuka: 5, jenisPotong: "PPH23", dasarPotong: "3" }, HARI_INI);
    expect(pph23.ok && pph23.pembayaran.jenisPotong).toBe("PPH23");
    expect(pph23.ok && pph23.pembayaran.dasarPotongSen).toBe(300);
  });

  it("jatuh tempo giro hanya disimpan untuk cara GIRO", () => {
    const g = periksaPembayaran({ ...dasar, cara: "GIRO", jatuhTempoGiro: "2026-11-01", uangMuka: 1 }, HARI_INI);
    expect(g.ok && g.pembayaran.jatuhTempoGiro).toBe("2026-11-01");
    const t = periksaPembayaran({ ...dasar, jatuhTempoGiro: "2026-11-01", uangMuka: 1 }, HARI_INI);
    expect(t.ok && t.pembayaran.jatuhTempoGiro).toBeNull();
  });
});

describe("alokasi terhadap sisa & potongan", () => {
  const sisa = new Map<string, SisaDokumen>([
    [kunciDokumenHutang("GRN", "g1"), { sisaSen: 100_000_000, porsiDasarPotong: 0 }],
    [kunciDokumenHutang("WO_STEP", "w1"), { sisaSen: 111_000_000, porsiDasarPotong: 100 / 111 }],
  ]);

  it("menolak alokasi di atas sisa dan dokumen yang tidak dikenal", () => {
    expect(periksaAlokasiTerhadapSisa([{ jenis: "GRN", id: "g1", sen: 100_000_001 }], sisa)).toEqual({ ok: false, kode: "MELEBIHI_SISA", baris: 1 });
    expect(periksaAlokasiTerhadapSisa([{ jenis: "GRN", id: "gX", sen: 1 }], sisa)).toEqual({ ok: false, kode: "DOKUMEN_TIDAK_DITEMUKAN", baris: 1 });
    expect(periksaAlokasiTerhadapSisa([{ jenis: "GRN", id: "g1", sen: 100_000_000 }], sisa)).toEqual({ ok: true });
  });

  it("PPh 23 jasa CMT: dasar = bagian jasa tanpa PPN, barang tidak ikut", () => {
    const alokasi = [
      { jenis: "GRN" as const, id: "g1", sen: 100_000_000 },
      { jenis: "WO_STEP" as const, id: "w1", sen: 111_000_000 },
    ];
    const dasarSen = dasarPotongBawaanSen("PPH23", alokasi, sisa, 211_000_000);
    expect(dasarSen).toBe(100_000_000);
    expect(hitungPembayaran(211_000_000, "PPH23", dasarSen, true)).toEqual({ brutoSen: 211_000_000, dasarPotongSen: 100_000_000, potongSen: 2_000_000, netoSen: 209_000_000 });
    expect(hitungPembayaran(211_000_000, "PPH23", dasarSen, false).potongSen).toBe(4_000_000);
    expect(dasarPotongBawaanSen("PPH4_2", alokasi, sisa, 211_000_000)).toBe(211_000_000);
    expect(dasarPotongBawaanSen(null, alokasi, sisa, 211_000_000)).toBe(0);
    expect(hitungPembayaran(5, null, 5, true)).toEqual({ brutoSen: 5, dasarPotongSen: 0, potongSen: 0, netoSen: 5 });
  });

  it("kunci cermin tandai lunas dan teks jurnal", () => {
    expect(kunciTandaiLunas("po1", 2)).toBe("tandai-lunas:po1#2");
    expect(adalahCerminTandaiLunas("tandai-lunas:po1#2")).toBe(true);
    expect(adalahCerminTandaiLunas("abc")).toBe(false);
    expect(adalahCerminTandaiLunas(null)).toBe(false);
    expect(uraianJurnalPembayaran("BYR/2026/10/0001", "PT Kain Indah", "TRX-9")).toBe("Pembayaran pemasok BYR/2026/10/0001 · PT Kain Indah · TRX-9");
    expect(memoAlokasi("GRN", "GRN/2026/0001")).toBe("Bayar penerimaan GRN/2026/0001");
  });
});

describe("umur hutang", () => {
  it("kelompok umur dari tanggal dokumen", () => {
    expect(umurHari("2026-09-08", "2026-10-08")).toBe(30);
    expect(kelompokUmur(30)).toBe("0_30");
    expect(kelompokUmur(31)).toBe("31_60");
    expect(kelompokUmur(90)).toBe("61_90");
    expect(kelompokUmur(91)).toBe("LEBIH_90");
  });

  it("kredit PO diterapkan FIFO dari dokumen tertua; sisa kredit dikembalikan", () => {
    const r = terapkanFifo(
      [
        { kunci: "b", tanggal: "2026-09-10", sisaSen: 500 },
        { kunci: "a", tanggal: "2026-08-01", sisaSen: 300 },
      ],
      600,
    );
    expect(r.dokumen.map((d) => [d.kunci, d.sisaSen])).toEqual([
      ["a", 0],
      ["b", 200],
    ]);
    expect(r.sisaKreditSen).toBe(0);
    expect(terapkanFifo([{ kunci: "a", tanggal: "2026-08-01", sisaSen: 300 }], 1000).sisaKreditSen).toBe(700);
  });

  it("menyusun dan menjumlahkan baris umur; lebih bayar masuk kredit", () => {
    const b = susunUmur(
      [
        { kunci: "1", tanggal: "2026-10-01", sisaSen: 100 },
        { kunci: "2", tanggal: "2026-08-20", sisaSen: 200 },
        { kunci: "3", tanggal: "2026-07-01", sisaSen: 400 },
        { kunci: "4", tanggal: "2026-09-01", sisaSen: -50 },
      ],
      HARI_INI,
      25,
    );
    expect(b).toEqual({ "0_30": 100, "31_60": 200, "61_90": 0, LEBIH_90: 400, kreditSen: 75, totalSen: 700, netoSen: 625 });
    expect(jumlahkanUmur([b, b]).netoSen).toBe(1250);
  });
});
