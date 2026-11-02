import { describe, expect, it } from "vitest";
import {
  BAWAAN_PESANAN_LAMA_SEBELUM,
  bacaBatasPesananLama,
  opnameTokoTerakhirSesudah,
  penerimaDiharapkan,
  peranPenerimaLama,
  periksaHitunganSampai,
  saatHitungOpnameToko,
  sisaBarisLama,
} from "./pesanan-lama-aturan";

describe("batas pesanan lama (SystemSetting konsi.pesananLamaSebelum)", () => {
  it("bawaan = saat alur per antaran sampai ke master (merge PR #318, 2026-09-23 23:50:47 WIB)", () => {
    expect(BAWAAN_PESANAN_LAMA_SEBELUM.toISOString()).toBe("2026-09-23T16:50:47.000Z");
  });

  it("membaca tanggal-waktu ISO berzona dan tanggal saja (tengah malam WIB)", () => {
    expect(bacaBatasPesananLama("2026-09-23T16:50:47Z").toISOString()).toBe("2026-09-23T16:50:47.000Z");
    expect(bacaBatasPesananLama("2026-09-24T00:00:00+07:00").toISOString()).toBe("2026-09-23T17:00:00.000Z");
    expect(bacaBatasPesananLama("2026-09-24").toISOString()).toBe("2026-09-23T17:00:00.000Z");
  });

  it("isian kosong, rusak, tanpa zona, atau tanggal bergulir kembali ke bawaan — tidak pernah membuka tombol untuk pesanan baru", () => {
    for (const v of [undefined, null, "", "  ", "kemarin", "2026-09-23T16:50:47", "2026-02-31", "2026-13-01T00:00:00Z"]) {
      expect(bacaBatasPesananLama(v).getTime()).toBe(BAWAAN_PESANAN_LAMA_SEBELUM.getTime());
    }
  });
});

describe("sisa baris pesanan lama", () => {
  it("yang lebih kecil dari sisa baris dan sisa cadangan; tanpa cadangan RESERVED = 0", () => {
    expect(sisaBarisLama({ qty: 10, deliveredQty: 0, cancelledQty: 0 }, { qty: 10, consumedQty: 0 })).toBe(10);
    expect(sisaBarisLama({ qty: 10, deliveredQty: 4, cancelledQty: 0 }, { qty: 10, consumedQty: 4 })).toBe(6);
    expect(sisaBarisLama({ qty: 10, deliveredQty: 0, cancelledQty: 0 }, { qty: 10, consumedQty: 3 })).toBe(7);
    expect(sisaBarisLama({ qty: 10, deliveredQty: 2, cancelledQty: 1 }, { qty: 10, consumedQty: 0 })).toBe(7);
    expect(sisaBarisLama({ qty: 10, deliveredQty: 0, cancelledQty: 0 }, null)).toBe(0);
    expect(sisaBarisLama({ qty: 10, deliveredQty: 10, cancelledQty: 0 }, { qty: 10, consumedQty: 10 })).toBe(0);
  });
});

describe("siapa yang boleh mengonfirmasi sudah sampai", () => {
  const dasar = { userId: "u1", storeId: "tokoA", jumlahSpg: 0, pemegangTokoId: null as string | null };

  it("SPG toko itu sendiri", () => {
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: "tokoA", jumlahSpg: 1 })).toBe("SPG");
  });

  it("SPG toko LAIN tidak pernah — juga bila ia pemegang toko ini", () => {
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: "tokoB", jumlahSpg: 1 })).toBeNull();
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: "tokoB", jumlahSpg: 0, pemegangTokoId: "u1" })).toBeNull();
  });

  it("salesman pemegang toko hanya bila toko itu tidak punya SPG", () => {
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: null, pemegangTokoId: "u1" })).toBe("SALESMAN");
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: null, pemegangTokoId: "u1", jumlahSpg: 1 })).toBeNull();
  });

  it("salesman lain dan orang kantor tidak pernah", () => {
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: null, pemegangTokoId: "u2" })).toBeNull();
    expect(peranPenerimaLama({ ...dasar, tokoTetapPengguna: null, pemegangTokoId: null })).toBeNull();
    expect(peranPenerimaLama({ ...dasar, userId: "", tokoTetapPengguna: null, pemegangTokoId: "" })).toBeNull();
  });

  it("penerima yang diharapkan untuk layar kantor", () => {
    expect(penerimaDiharapkan({ jumlahSpg: 2, pemegangTokoId: "u1" })).toBe("SPG");
    expect(penerimaDiharapkan({ jumlahSpg: 0, pemegangTokoId: "u1" })).toBe("SALESMAN");
    expect(penerimaDiharapkan({ jumlahSpg: 0, pemegangTokoId: null })).toBe("TANPA_PENERIMA");
  });
});

describe("hitungan sampai", () => {
  const sisa = new Map([
    ["l1", 10],
    ["l2", 4],
  ]);

  it("sebagian boleh: yang nol tidak ikut, sisanya tetap menunggu", () => {
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: 7 },
        { lineId: "l2", qty: 0 },
      ]),
    ).toEqual({ ok: true, baris: [{ lineId: "l1", qty: 7 }], total: 7 });
  });

  it("lebih dari sisa ditolak", () => {
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: 11 },
        { lineId: "l2", qty: 0 },
      ]),
    ).toEqual({ ok: false, alasan: "LEBIH_DARI_SISA" });
  });

  it("semua nol bukan konfirmasi", () => {
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: 0 },
        { lineId: "l2", qty: 0 },
      ]),
    ).toEqual({ ok: false, alasan: "KOSONG" });
  });

  it("setiap baris dijawab tepat sekali, bilangan bulat ≥ 0, tanpa baris asing", () => {
    expect(periksaHitunganSampai(sisa, [{ lineId: "l1", qty: 3 }])).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: 3 },
        { lineId: "l1", qty: 1 },
      ]),
    ).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: 1.5 },
        { lineId: "l2", qty: 0 },
      ]),
    ).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: -1 },
        { lineId: "l2", qty: 0 },
      ]),
    ).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
    expect(
      periksaHitunganSampai(sisa, [
        { lineId: "l1", qty: 1 },
        { lineId: "l2", qty: 0 },
        { lineId: "lain", qty: 0 },
      ]),
    ).toEqual({ ok: false, alasan: "JUMLAH_TIDAK_VALID" });
  });
});

describe("opname toko sesudah pesanan lama disetujui (peringatan di HP)", () => {
  const disetujui = new Date("2026-08-01T03:00:00.000Z");

  it("saat hitung opname tim = countFinishedAt, atau approvedAt untuk hitungan lama; bukan saat dokumen dibuka", () => {
    const selesai = new Date("2026-08-10T05:00:00.000Z");
    const disahkan = new Date("2026-08-12T05:00:00.000Z");
    expect(saatHitungOpnameToko({ countFinishedAt: selesai, approvedAt: disahkan })).toBe(selesai);
    expect(saatHitungOpnameToko({ countFinishedAt: null, approvedAt: disahkan })).toBe(disahkan);
    expect(saatHitungOpnameToko({ countFinishedAt: null, approvedAt: null })).toBeNull();
  });

  it("yang paling akhir dari kedua jenis opname, hanya yang SESUDAH pesanan disetujui", () => {
    const opnameSpg = new Date("2026-08-05T03:00:00.000Z");
    const opnameTim = new Date("2026-09-02T03:00:00.000Z");
    expect(opnameTokoTerakhirSesudah(disetujui, [opnameSpg, opnameTim])).toBe(opnameTim);
    expect(opnameTokoTerakhirSesudah(disetujui, [opnameTim, opnameSpg])).toBe(opnameTim);
    expect(opnameTokoTerakhirSesudah(disetujui, [null, undefined, opnameSpg])).toBe(opnameSpg);
  });

  it("sebelum atau tepat saat disetujui, kosong, atau tanggal rusak: tidak ada peringatan", () => {
    expect(opnameTokoTerakhirSesudah(disetujui, [])).toBeNull();
    expect(opnameTokoTerakhirSesudah(disetujui, [null, undefined])).toBeNull();
    expect(opnameTokoTerakhirSesudah(disetujui, [new Date("2026-07-31T03:00:00.000Z"), new Date(disetujui.getTime())])).toBeNull();
    expect(opnameTokoTerakhirSesudah(disetujui, [new Date("bukan tanggal")])).toBeNull();
  });
});
