import { describe, expect, it } from "vitest";
import {
  bacaIdFaktur,
  bacaStatusTugas,
  bolehDitutupOtomatis,
  keadaanTugas,
  periksaBatalTugas,
  periksaSudahDitagih,
  periksaTugasBaru,
  perluDitagih,
  petugasBawaan,
  type FakturTugas,
} from "./tugas-tagih";

// 1 Okt 2026, 10.00 WIB.
const HARI_INI = new Date("2026-10-01T03:00:00Z");
const tanggal = (teks: string) => new Date(`${teks}T00:00:00+07:00`);

const terbuka = (sisa: number): FakturTugas => ({ sisa, keadaan: "belum" });
const diklaim = (sisa: number): FakturTugas => ({ sisa, keadaan: "klaim" });
const lunas: FakturTugas = { sisa: 0, keadaan: "lunas" };

describe("keadaanTugas", () => {
  const dasar = { status: "TERBUKA" as const, tenggat: tanggal("2026-10-05"), hariIni: HARI_INI };

  it("status tersimpan SELESAI / DIBATALKAN menang atas keadaan fakturnya", () => {
    expect(keadaanTugas({ ...dasar, status: "SELESAI", faktur: [terbuka(100)] })).toBe("SELESAI");
    expect(keadaanTugas({ ...dasar, status: "DIBATALKAN", faktur: [lunas] })).toBe("DIBATALKAN");
  });

  it("semua faktur lunas terverifikasi → LUNAS", () => {
    expect(keadaanTugas({ ...dasar, faktur: [lunas, lunas] })).toBe("LUNAS");
  });

  it("sisanya sudah dilaporkan bayar → DILAPORKAN, BUKAN lunas (klaim bukan pembayaran)", () => {
    expect(keadaanTugas({ ...dasar, faktur: [lunas, diklaim(500)] })).toBe("DILAPORKAN");
    expect(keadaanTugas({ ...dasar, faktur: [diklaim(500)] })).toBe("DILAPORKAN");
  });

  it("sebagian saja yang dilaporkan → masih harus ditagih", () => {
    expect(keadaanTugas({ ...dasar, faktur: [diklaim(500), terbuka(100)] })).toBe("BERJALAN");
  });

  it("lewat tenggat (hari WIB) → TERLAMBAT; tenggat hari ini belum terlambat", () => {
    expect(keadaanTugas({ ...dasar, tenggat: tanggal("2026-09-30"), faktur: [terbuka(100)] })).toBe("TERLAMBAT");
    expect(keadaanTugas({ ...dasar, tenggat: tanggal("2026-10-01"), faktur: [terbuka(100)] })).toBe("BERJALAN");
  });

  it("jam 00.30 WIB masih hari yang sama dengan tenggatnya, bukan hari UTC sebelumnya", () => {
    const diniHari = new Date("2026-09-30T17:30:00Z"); // 1 Okt 00.30 WIB
    expect(keadaanTugas({ ...dasar, tenggat: tanggal("2026-10-01"), hariIni: diniHari, faktur: [terbuka(1)] })).toBe(
      "BERJALAN",
    );
  });

  it("tugas yang sudah lewat tenggat tapi fakturnya lunas tetap LUNAS, bukan terlambat", () => {
    expect(keadaanTugas({ ...dasar, tenggat: tanggal("2026-09-01"), faktur: [lunas] })).toBe("LUNAS");
  });

  it("tanpa tenggat tidak pernah terlambat", () => {
    expect(keadaanTugas({ ...dasar, tenggat: null, faktur: [terbuka(100)] })).toBe("BERJALAN");
  });

  it("fakturnya sudah tidak ada satu pun → TIDAK pernah dianggap lunas", () => {
    // Kalau dianggap lunas, penutup otomatis menulis "lunas" ke jejak untuk
    // faktur yang dihapus, bukan dibayar.
    expect(keadaanTugas({ ...dasar, faktur: [] })).toBe("BERJALAN");
    expect(keadaanTugas({ ...dasar, tenggat: tanggal("2026-09-01"), faktur: [] })).toBe("TERLAMBAT");
  });
});

describe("perluDitagih & bolehDitutupOtomatis", () => {
  it("hanya BERJALAN dan TERLAMBAT yang dihitung pekerjaan", () => {
    expect(perluDitagih("BERJALAN")).toBe(true);
    expect(perluDitagih("TERLAMBAT")).toBe(true);
    for (const k of ["DILAPORKAN", "LUNAS", "SELESAI", "DIBATALKAN"] as const) expect(perluDitagih(k)).toBe(false);
  });

  it("ditutup otomatis HANYA kalau terbuka dan lunas terverifikasi — laporan bayar tidak cukup", () => {
    expect(bolehDitutupOtomatis("TERBUKA", "LUNAS")).toBe(true);
    expect(bolehDitutupOtomatis("TERBUKA", "DILAPORKAN")).toBe(false);
    expect(bolehDitutupOtomatis("DIBATALKAN", "LUNAS")).toBe(false);
  });
});

describe("bacaIdFaktur & bacaStatusTugas", () => {
  it("hanya string tak kosong, tanpa ganda; selain larik → kosong", () => {
    expect(bacaIdFaktur(["a", " b ", "", 3, null, "a"])).toEqual(["a", "b"]);
    expect(bacaIdFaktur({ a: 1 })).toEqual([]);
    expect(bacaIdFaktur(null)).toEqual([]);
  });

  it("status tak dikenal dibaca TERBUKA", () => {
    expect(bacaStatusTugas("SELESAI")).toBe("SELESAI");
    expect(bacaStatusTugas("aneh")).toBe("TERBUKA");
    expect(bacaStatusTugas(null)).toBe("TERBUKA");
  });
});

describe("periksaTugasBaru", () => {
  const dasar = {
    storeId: "t1",
    receivableIds: ["r1", "r2"],
    faktur: [
      { id: "r1", storeId: "t1", sisa: 400 },
      { id: "r2", storeId: "t1", sisa: 100 },
    ],
    sedangDitugaskan: new Set<string>(),
    petugasLapangan: true,
    tenggat: tanggal("2026-10-08"),
    hariIni: HARI_INI,
  };

  it("jalan mulus mengembalikan id tanpa ganda", () => {
    expect(periksaTugasBaru({ ...dasar, receivableIds: ["r1", "r2", "r1"] })).toEqual({
      ok: true,
      receivableIds: ["r1", "r2"],
    });
  });

  it("menolak daftar kosong", () => {
    expect(periksaTugasBaru({ ...dasar, receivableIds: [] })).toEqual({ ok: false, alasan: "TANPA_FAKTUR" });
  });

  it("menolak faktur yang tidak ada", () => {
    expect(periksaTugasBaru({ ...dasar, receivableIds: ["r1", "r9"] })).toEqual({
      ok: false,
      alasan: "FAKTUR_TIDAK_DITEMUKAN",
    });
  });

  it("menolak faktur toko lain", () => {
    const faktur = [...dasar.faktur, { id: "r3", storeId: "t2", sisa: 50 }];
    expect(periksaTugasBaru({ ...dasar, faktur, receivableIds: ["r1", "r3"] })).toEqual({
      ok: false,
      alasan: "BEDA_TOKO",
    });
  });

  it("menolak SELURUHNYA kalau satu faktur sudah lunas", () => {
    const faktur = [{ id: "r1", storeId: "t1", sisa: 400 }, { id: "r2", storeId: "t1", sisa: 0 }];
    expect(periksaTugasBaru({ ...dasar, faktur })).toEqual({ ok: false, alasan: "SUDAH_LUNAS" });
  });

  it("menolak faktur yang sudah di tugas terbuka lain — dua orang tidak menagih faktur yang sama", () => {
    expect(periksaTugasBaru({ ...dasar, sedangDitugaskan: new Set(["r2"]) })).toEqual({
      ok: false,
      alasan: "SUDAH_DITUGASKAN",
    });
  });

  it("menolak petugas yang bukan orang lapangan", () => {
    expect(periksaTugasBaru({ ...dasar, petugasLapangan: false })).toEqual({
      ok: false,
      alasan: "BUKAN_PETUGAS_LAPANGAN",
    });
  });

  it("tenggat kemarin ditolak, hari ini dan tanpa tenggat boleh", () => {
    expect(periksaTugasBaru({ ...dasar, tenggat: tanggal("2026-09-30") })).toEqual({
      ok: false,
      alasan: "TENGGAT_LAMPAU",
    });
    expect(periksaTugasBaru({ ...dasar, tenggat: tanggal("2026-10-01") }).ok).toBe(true);
    expect(periksaTugasBaru({ ...dasar, tenggat: null }).ok).toBe(true);
  });
});

describe("periksaSudahDitagih & periksaBatalTugas", () => {
  const dasar = { status: "TERBUKA" as const, assigneeId: "u1", userId: "u1", hasil: " Toko janji transfer Jumat " };

  it("hanya yang ditugasi, hanya yang terbuka, catatan hasil wajib", () => {
    expect(periksaSudahDitagih(dasar)).toEqual({ ok: true, hasil: "Toko janji transfer Jumat" });
    expect(periksaSudahDitagih({ ...dasar, userId: "u2" })).toEqual({ ok: false, alasan: "BUKAN_PETUGAS" });
    expect(periksaSudahDitagih({ ...dasar, status: "SELESAI" })).toEqual({ ok: false, alasan: "SUDAH_DITUTUP" });
    expect(periksaSudahDitagih({ ...dasar, hasil: "   " })).toEqual({ ok: false, alasan: "HASIL_WAJIB" });
  });

  it("batal butuh alasan dan tugas yang masih terbuka", () => {
    expect(periksaBatalTugas({ status: "TERBUKA", alasan: " salah toko " })).toEqual({ ok: true, alasan: "salah toko" });
    expect(periksaBatalTugas({ status: "TERBUKA", alasan: "" })).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(periksaBatalTugas({ status: "DIBATALKAN", alasan: "x" })).toEqual({ ok: false, alasan: "SUDAH_DITUTUP" });
  });
});

describe("petugasBawaan", () => {
  const lapangan = new Set(["s1", "s2"]);

  it("pemegang toko menang", () => {
    expect(petugasBawaan({ pemegangId: "s2", penjualIds: ["s1"], petugasLapangan: lapangan })).toBe("s2");
  });

  it("tanpa pemegang: penjualnya kalau satu orang, kosong kalau campur", () => {
    expect(petugasBawaan({ pemegangId: null, penjualIds: ["s1", "s1", null], petugasLapangan: lapangan })).toBe("s1");
    expect(petugasBawaan({ pemegangId: null, penjualIds: ["s1", "s2"], petugasLapangan: lapangan })).toBe("");
  });

  it("calon yang bukan orang lapangan tidak dipasang", () => {
    expect(petugasBawaan({ pemegangId: "admin", penjualIds: [], petugasLapangan: lapangan })).toBe("");
  });
});
