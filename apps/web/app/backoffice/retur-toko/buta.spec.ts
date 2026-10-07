import { describe, expect, it } from "vitest";
import type { BarisKerjaRetur } from "@/lib/receivables/return-queries";
import { ringkasKerjaRetur } from "@/lib/receivables/return-queries";
import {
  bacaSaringRetur,
  butakan,
  calonUntukPenonton,
  klaimDisembunyikan,
  pelaporNota,
  saringKerjaRetur,
} from "./buta";

/*
 * Hitungan gudang yang seharusnya buta bocor di /backoffice/retur-toko: dialog
 * "Cek fisik barang" berkata klaim toko sengaja disembunyikan, padahal tabel di
 * belakangnya menampilkan "KLAIM TOKO Rp 640.000" pada baris yang sama. Dan
 * pelapor nota bisa membuka dialog hitungnya — penolakannya baru datang dari
 * server (PENGHITUNG_SAMA_PELAPOR) sesudah formulirnya diisi.
 */
const nrt = (p: Partial<BarisKerjaRetur> = {}): BarisKerjaRetur => ({
  jenis: "NRT",
  id: "nrt-1",
  nomor: "NRT-4510",
  nomorPasangan: null,
  storeId: "s1",
  storeName: "Toko Sinar Jaya",
  salesmanId: "budi",
  salesmanName: "Budi",
  tanggal: "2026-10-01T00:00:00.000Z",
  caraKirim: "SALES",
  adaFoto: true,
  nilaiKlaim: 640_000,
  nilaiFisik: null,
  selisih: 0,
  langkah: "cek",
  giliran: "gudang",
  bebanId: null,
  bebanStatus: null,
  penanggung: null,
  jumlahPotongan: 1,
  nilaiDipotong: 640_000,
  ...p,
});

describe("klaimDisembunyikan", () => {
  it("menyembunyikan klaim nota yang belum dihitung dari orang yang boleh menghitungnya", () => {
    expect(klaimDisembunyikan(nrt(), { bolehMenghitung: true, penggunaId: "gudang-1" })).toBe(true);
  });

  it("pelapornya sendiri tetap melihat — ia yang mengetik klaimnya, dan ia tidak boleh menghitung", () => {
    expect(klaimDisembunyikan(nrt(), { bolehMenghitung: true, penggunaId: "budi" })).toBe(false);
  });

  it("yang tidak boleh menghitung (keuangan saja) tetap melihat", () => {
    expect(klaimDisembunyikan(nrt(), { bolehMenghitung: false, penggunaId: "keuangan" })).toBe(false);
  });

  it("sesudah dihitung klaimnya terlihat lagi", () => {
    for (const langkah of ["keputusan", "beres", "batal"] as const) {
      expect(klaimDisembunyikan(nrt({ langkah }), { bolehMenghitung: true, penggunaId: "gudang-1" })).toBe(false);
    }
  });
});

describe("butakan", () => {
  it("membuang angka klaim dan potongannya DI SERVER, bukan hanya di tampilan", () => {
    const [b] = butakan([nrt()], { bolehMenghitung: true, penggunaId: "gudang-1" });
    expect(b).toMatchObject({ nilaiKlaim: null, nilaiDipotong: 0, jumlahPotongan: 0, klaimTersembunyi: true });
    expect(JSON.stringify(b)).not.toContain("640000");
  });

  it("baris lain tidak disentuh", () => {
    const asli = nrt({ langkah: "beres", nilaiFisik: 640_000 });
    expect(butakan([asli], { bolehMenghitung: true, penggunaId: "gudang-1" })[0]).toEqual({ ...asli, klaimTersembunyi: false });
  });
});

describe("pelaporNota", () => {
  it("hanya nota toko yang punya pelapor", () => {
    expect(pelaporNota(nrt(), "budi")).toBe(true);
    expect(pelaporNota(nrt(), "gudang-1")).toBe(false);
    expect(pelaporNota(nrt({ salesmanId: null }), "")).toBe(false);
    expect(pelaporNota(nrt({ jenis: "GUDANG_YATIM" }), "budi")).toBe(false);
  });
});

describe("saringKerjaRetur", () => {
  const baris = [
    nrt(),
    nrt({ id: "nrt-2", nomor: "NRT-4511", langkah: "beres", storeName: "Toko Makmur" }),
    nrt({ id: "nri-1", jenis: "GUDANG_YATIM", nomor: "NRI/2026/0003", langkah: "jodoh", salesmanName: null }),
  ];

  it("bawaan: yang masih perlu dikerjakan", () => {
    expect(saringKerjaRetur(baris, { saring: "kerja", cari: "", koreksi: new Set() }).map((b) => b.id)).toEqual(["nrt-1", "nri-1"]);
  });

  it("per langkah, semua, dan permintaan koreksi", () => {
    expect(saringKerjaRetur(baris, { saring: "beres", cari: "", koreksi: new Set() }).map((b) => b.id)).toEqual(["nrt-2"]);
    expect(saringKerjaRetur(baris, { saring: "semua", cari: "", koreksi: new Set() })).toHaveLength(3);
    expect(saringKerjaRetur(baris, { saring: "koreksi", cari: "", koreksi: new Set(["nrt-2"]) }).map((b) => b.id)).toEqual(["nrt-2"]);
  });

  it("mencari nomor nota, toko, dan salesman", () => {
    expect(saringKerjaRetur(baris, { saring: "semua", cari: "makmur", koreksi: new Set() }).map((b) => b.id)).toEqual(["nrt-2"]);
    expect(saringKerjaRetur(baris, { saring: "semua", cari: "nri/2026", koreksi: new Set() }).map((b) => b.id)).toEqual(["nri-1"]);
  });
});

describe("bacaSaringRetur", () => {
  it("membaca ?langkah= dan ?koreksi=1, bawaannya daftar kerja", () => {
    expect(bacaSaringRetur({})).toBe("kerja");
    expect(bacaSaringRetur({ koreksi: "1" })).toBe("koreksi");
    expect(bacaSaringRetur({ langkah: "cek" })).toBe("cek");
    expect(bacaSaringRetur({ langkah: "semua" })).toBe("semua");
    expect(bacaSaringRetur({ langkah: "ngawur" })).toBe("kerja");
  });
});

describe("calonUntukPenonton (dialog Jodohkan)", () => {
  const calon = [
    { id: "nrt-1", noNrt: "NRT-4510", storeId: "s1", storeName: "Toko Sinar Jaya", nilaiKlaim: 640_000, tanggal: "2026-10-01" },
    { id: "nrt-9", noNrt: "NRT-4599", storeId: "s1", storeName: "Toko Sinar Jaya", nilaiKlaim: 125_000, tanggal: "2026-10-02" },
  ];
  const semua = [nrt(), nrt({ id: "nrt-9", nomor: "NRT-4599", salesmanId: "gudang-1" })];

  it("gudang yang tidak boleh menjodohkan tidak menerima daftarnya sama sekali — dulu klaimnya ikut di payload", () => {
    const hasil = calonUntukPenonton(calon, semua, { bolehMengelola: false, bolehMenghitung: true, penggunaId: "gudang-1" });
    expect(hasil).toEqual([]);
    expect(JSON.stringify(hasil)).not.toContain("640000");
  });

  it("pengelola yang juga boleh menghitung tidak melihat klaim nota yang belum dihitung, kecuali notanya sendiri", () => {
    const hasil = calonUntukPenonton(calon, semua, { bolehMengelola: true, bolehMenghitung: true, penggunaId: "gudang-1" });
    expect(hasil.map((c) => [c.noNrt, c.nilaiKlaim])).toEqual([
      ["NRT-4510", null],
      ["NRT-4599", 125_000],
    ]);
  });

  it("pengelola yang tidak menghitung tetap melihat klaimnya; nota tak dikenal dianggap buta bagi penghitung", () => {
    expect(
      calonUntukPenonton(calon, semua, { bolehMengelola: true, bolehMenghitung: false, penggunaId: "keuangan" }).map((c) => c.nilaiKlaim),
    ).toEqual([640_000, 125_000]);
    expect(
      calonUntukPenonton(calon, [], { bolehMengelola: true, bolehMenghitung: true, penggunaId: "x" }).map((c) => c.nilaiKlaim),
    ).toEqual([null, null]);
  });
});

describe("ringkasan kepala atas baris yang dibutakan", () => {
  it("\"tertahan dari piutang\" tidak menjumlah potongan nota buta — satu nota buta = klaimnya sendiri", () => {
    const semua = [nrt()];
    expect(ringkasKerjaRetur(semua).nilaiTertahan).toBe(640_000);
    const tampil = ringkasKerjaRetur(butakan(semua, { bolehMenghitung: true, penggunaId: "gudang-1" }));
    expect(tampil.nilaiTertahan).toBe(0);
    expect(tampil.perLangkah.cek).toBe(1);
  });
});
