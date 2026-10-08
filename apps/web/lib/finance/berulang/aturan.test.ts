import { describe, expect, it } from "vitest";
import {
  bacaIdSumberBerulang,
  idSumberBerulang,
  keadaanTemplat,
  periksaBarisJurnal,
  periksaTemplat,
  periodeJatuhTempo,
  postingBerikutnya,
  tanggalBalikBulan,
  tanggalPostingBulan,
  type IsianTemplat,
} from "./aturan";

const kunci = (xs: Array<{ tahun: number; bulan: number }>) => xs.map((x) => `${x.tahun}-${String(x.bulan).padStart(2, "0")}`);

describe("jadwal jurnal berulang", () => {
  it("hari yang tidak ada di bulan pendek jatuh ke hari terakhirnya", () => {
    expect(tanggalPostingBulan({ tahun: 2026, bulan: 2 }, 31)).toBe("2026-02-28");
    expect(tanggalPostingBulan({ tahun: 2028, bulan: 2 }, 30)).toBe("2028-02-29");
    expect(tanggalPostingBulan({ tahun: 2026, bulan: 4 }, 31)).toBe("2026-04-30");
    expect(tanggalPostingBulan({ tahun: 2026, bulan: 10 }, 5)).toBe("2026-10-05");
  });

  it("pembalik akrual tanggal 1 bulan berikutnya, termasuk lintas tahun", () => {
    expect(tanggalBalikBulan({ tahun: 2026, bulan: 10 })).toBe("2026-11-01");
    expect(tanggalBalikBulan({ tahun: 2026, bulan: 12 })).toBe("2027-01-01");
  });

  it("bulan jatuh tempo: sejak mulai sampai hari ini; tanggal posting sebelum tanggal mulai tidak ikut", () => {
    const j = { hari: 25, mulai: "2026-07-26", selesai: null };
    // Juli tanggal 25 < tanggal mulai 26 → Juli tidak; Oktober 25 > hari ini 8 → belum.
    expect(kunci(periodeJatuhTempo(j, "2026-10-08"))).toEqual(["2026-08", "2026-09"]);
    expect(kunci(periodeJatuhTempo(j, "2026-10-25"))).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("tanggal selesai menghentikan jadwal; lantai tanggal mulai buku besar memotong bulan sebelumnya", () => {
    expect(kunci(periodeJatuhTempo({ hari: 1, mulai: "2026-01-01", selesai: "2026-03-15" }, "2026-10-08"))).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(kunci(periodeJatuhTempo({ hari: 1, mulai: "2026-01-01", selesai: null }, "2026-04-02", { tahun: 2026, bulan: 3 }))).toEqual(["2026-03", "2026-04"]);
  });

  it("posting berikutnya", () => {
    expect(postingBerikutnya({ hari: 25, mulai: "2026-07-26", selesai: null }, "2026-10-08")).toBe("2026-10-25");
    expect(postingBerikutnya({ hari: 1, mulai: "2026-07-01", selesai: null }, "2026-10-08")).toBe("2026-11-01");
    expect(postingBerikutnya({ hari: 1, mulai: "2027-03-01", selesai: null }, "2026-10-08")).toBe("2027-03-01");
    expect(postingBerikutnya({ hari: 1, mulai: "2026-07-01", selesai: "2026-10-31" }, "2026-10-08")).toBeNull();
  });

  it("sourceId <templat>/<YYYY-MM> bolak-balik", () => {
    expect(bacaIdSumberBerulang(idSumberBerulang("ctpl1", "2026-10"))).toEqual({ templatId: "ctpl1", periode: "2026-10", tb: { tahun: 2026, bulan: 10 } });
    expect(bacaIdSumberBerulang("ctpl1")).toBeNull();
  });
});

describe("baris jurnal manual / templat", () => {
  it("baris kosong dibuang; minimal dua baris; seimbang per sen", () => {
    const r = periksaBarisJurnal([
      { akunId: "a", debit: "1500000", kredit: "" },
      { akunId: "", debit: "", kredit: "" },
      { akunId: "b", debit: "", kredit: 1_500_000, memo: " sewa ", kanal: "SHOPEE" },
    ]);
    expect(r).toEqual({
      ok: true,
      total: 1_500_000,
      baris: [
        { akunId: "a", debit: 1_500_000, kredit: 0, memo: null, kanal: null },
        { akunId: "b", debit: 0, kredit: 1_500_000, memo: "sewa", kanal: "SHOPEE" },
      ],
    });
  });

  it("menolak: tanpa akun, dua sisi, lebih dari dua desimal, tidak seimbang, kanal asing", () => {
    expect(periksaBarisJurnal([{ akunId: "", debit: 5, kredit: 0 }, { akunId: "b", debit: 0, kredit: 5 }])).toEqual({ ok: false, kode: "AKUN_BARIS_WAJIB", baris: 1 });
    expect(periksaBarisJurnal([{ akunId: "a", debit: 5, kredit: 5 }, { akunId: "b", debit: 0, kredit: 5 }])).toEqual({ ok: false, kode: "BARIS_TIDAK_SAH", baris: 1 });
    expect(periksaBarisJurnal([{ akunId: "a", debit: "1.005", kredit: 0 }, { akunId: "b", debit: 0, kredit: 5 }])).toEqual({ ok: false, kode: "JUMLAH_TIDAK_SAH", baris: 1 });
    expect(periksaBarisJurnal([{ akunId: "a", debit: 5, kredit: 0 }, { akunId: "b", debit: 0, kredit: 4.99 }])).toEqual({ ok: false, kode: "TIDAK_SEIMBANG" });
    expect(periksaBarisJurnal([{ akunId: "a", debit: 5, kredit: 0 }])).toEqual({ ok: false, kode: "BARIS_KURANG" });
    expect(periksaBarisJurnal([{ akunId: "a", debit: 5, kredit: 0, kanal: "PASAR" }, { akunId: "b", debit: 0, kredit: 5 }])).toEqual({ ok: false, kode: "KANAL_TIDAK_SAH", baris: 1 });
    expect(periksaBarisJurnal([{ akunId: "a", debit: 0.1, kredit: 0 }, { akunId: "b", debit: 0, kredit: 0.1 }])).toMatchObject({ ok: true, total: 0.1 });
  });
});

describe("isian templat", () => {
  const dasar: IsianTemplat = {
    nama: "Sewa toko",
    hari: 1,
    mulai: "2026-11-01",
    balikOtomatis: false,
    baris: [
      { akunId: "beban", debit: 2_000_000, kredit: 0 },
      { akunId: "bank", debit: 0, kredit: 2_000_000 },
    ],
  };

  it("sah", () => {
    expect(periksaTemplat(dasar)).toMatchObject({ ok: true, templat: { nama: "Sewa toko", hari: 1, selesai: null, total: 2_000_000 } });
  });

  it("menolak nama kosong, hari di luar 1–31, selesai sebelum mulai", () => {
    expect(periksaTemplat({ ...dasar, nama: " " })).toEqual({ ok: false, kode: "NAMA_WAJIB" });
    expect(periksaTemplat({ ...dasar, hari: 0 })).toEqual({ ok: false, kode: "HARI_TIDAK_SAH" });
    expect(periksaTemplat({ ...dasar, hari: 32 })).toEqual({ ok: false, kode: "HARI_TIDAK_SAH" });
    expect(periksaTemplat({ ...dasar, selesai: "2026-10-31" })).toEqual({ ok: false, kode: "SELESAI_SEBELUM_MULAI" });
    expect(periksaTemplat({ ...dasar, mulai: "2026-13-01" })).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
  });

  it("keadaan templat", () => {
    const dasarK = { selesai: null, hariIni: "2026-10-08" };
    expect(keadaanTemplat({ ...dasarK, aktif: false, sudahDisetujui: false })).toBe("MENUNGGU_PERSETUJUAN");
    expect(keadaanTemplat({ ...dasarK, aktif: true, sudahDisetujui: true })).toBe("AKTIF");
    expect(keadaanTemplat({ ...dasarK, aktif: false, sudahDisetujui: true })).toBe("DIHENTIKAN");
    expect(keadaanTemplat({ aktif: true, sudahDisetujui: true, selesai: "2026-09-30", hariIni: "2026-10-08" })).toBe("SELESAI");
  });
});
