import { describe, expect, it } from "vitest";
import {
  BATAS_NAMA,
  TOLERANSI_JAM_MS,
  bacaWaktuInputWib,
  batasAwalTerima,
  bolehMengoreksiBuktiTerima,
  idFotoDariUrl,
  keadaanBuktiTerima,
  periksaMasukanBuktiTerima,
  periksaWaktuTerima,
  rapikanNamaPenerima,
  samaIsinya,
  sumberPencatat,
  waktuWibUntukInput,
} from "./bukti-terima";

const kiriman = {
  invoiceDate: new Date("2026-09-10T00:00:00+07:00"),
  deliveredAt: new Date("2026-09-12T09:15:00+07:00"),
  createdAt: new Date("2026-09-12T09:15:00+07:00"),
};

describe("keadaanBuktiTerima", () => {
  it("is BELUM_DITERIMA until a receipt time exists, DITERIMA after", () => {
    expect(keadaanBuktiTerima({ receivedAt: null })).toBe("BELUM_DITERIMA");
    expect(keadaanBuktiTerima({ receivedAt: new Date() })).toBe("DITERIMA");
    expect(keadaanBuktiTerima({ receivedAt: "2026-09-12T10:00:00.000Z" })).toBe("DITERIMA");
  });
});

describe("rapikanNamaPenerima", () => {
  it("trims and collapses inner whitespace", () => {
    expect(rapikanNamaPenerima("  Bu   Siti \n Rahma ")).toBe("Bu Siti Rahma");
  });

  it(`accepts ${BATAS_NAMA.min}..${BATAS_NAMA.max} characters and nothing outside`, () => {
    expect(rapikanNamaPenerima("Al")).toBe("Al");
    expect(rapikanNamaPenerima("A")).toBeNull();
    expect(rapikanNamaPenerima("   ")).toBeNull();
    expect(rapikanNamaPenerima("x".repeat(BATAS_NAMA.max))).toBe("x".repeat(BATAS_NAMA.max));
    expect(rapikanNamaPenerima("x".repeat(BATAS_NAMA.max + 1))).toBeNull();
  });

  it("refuses anything that is not a string — a server action is a network endpoint", () => {
    expect(rapikanNamaPenerima(undefined)).toBeNull();
    expect(rapikanNamaPenerima(42)).toBeNull();
    expect(rapikanNamaPenerima({ toString: () => "Siti" })).toBeNull();
  });
});

describe("idFotoDariUrl", () => {
  it("returns the id of an internal photo path", () => {
    expect(idFotoDariUrl("/api/foto/ckabc123xyz")).toBe("ckabc123xyz");
    expect(idFotoDariUrl("/api/foto/0ca71555-3272-4f49-abe0-350c587bb2aa")).toBe("0ca71555-3272-4f49-abe0-350c587bb2aa");
  });

  it("refuses external, relative-escaping, query-carrying or nested paths", () => {
    for (const url of [
      "https://evil.example/api/foto/abc",
      "//evil.example/api/foto/abc",
      "/api/foto/",
      "/api/foto/abc/def",
      "/api/foto/../users",
      "/api/foto/abc?x=1",
      "/api/foto/abc#x",
      "api/foto/abc",
      "/api/fotox/abc",
      `/api/foto/${"a".repeat(200)}`,
      "",
      null,
      7,
    ]) {
      expect(idFotoDariUrl(url), String(url)).toBeNull();
    }
  });
});

describe("batasAwalTerima", () => {
  it("is the earliest of the invoice date, the delivery moment and the record moment", () => {
    expect(batasAwalTerima(kiriman).toISOString()).toBe(kiriman.invoiceDate.toISOString());
    const nantiFaktur = { ...kiriman, invoiceDate: new Date("2026-09-20T00:00:00+07:00") };
    expect(batasAwalTerima(nantiFaktur).toISOString()).toBe(kiriman.deliveredAt.toISOString());
  });

  it("works without a createdAt (the office screen only knows the delivery dates)", () => {
    expect(batasAwalTerima({ invoiceDate: kiriman.invoiceDate, deliveredAt: kiriman.deliveredAt }).toISOString()).toBe(
      kiriman.invoiceDate.toISOString(),
    );
  });
});

describe("periksaWaktuTerima", () => {
  const sekarang = new Date("2026-09-12T12:00:00+07:00");

  it("accepts a time between the delivery start and now", () => {
    expect(periksaWaktuTerima(new Date("2026-09-12T11:00:00+07:00"), kiriman, sekarang)).toBeNull();
    expect(periksaWaktuTerima(kiriman.invoiceDate, kiriman, sekarang)).toBeNull();
  });

  it("tolerates five minutes of phone clock skew, not more", () => {
    expect(periksaWaktuTerima(new Date(sekarang.getTime() + TOLERANSI_JAM_MS), kiriman, sekarang)).toBeNull();
    expect(periksaWaktuTerima(new Date(sekarang.getTime() + TOLERANSI_JAM_MS + 1), kiriman, sekarang)).toBe(
      "WAKTU_DI_MASA_DEPAN",
    );
  });

  it("refuses a receipt dated before the delivery existed", () => {
    expect(periksaWaktuTerima(new Date(kiriman.invoiceDate.getTime() - 1), kiriman, sekarang)).toBe("WAKTU_SEBELUM_KIRIM");
  });
});

describe("waktu input WIB", () => {
  it("formats an instant as a WIB wall-clock value for a datetime-local input", () => {
    expect(waktuWibUntukInput(new Date("2026-09-12T03:05:00.000Z"))).toBe("2026-09-12T10:05");
    // Just before WIB midnight is still the previous day in UTC.
    expect(waktuWibUntukInput(new Date("2026-09-12T16:59:00.000Z"))).toBe("2026-09-12T23:59");
    expect(waktuWibUntukInput(new Date("2026-09-12T17:00:00.000Z"))).toBe("2026-09-13T00:00");
  });

  it("reads the input back as WIB regardless of the phone's own zone", () => {
    expect(bacaWaktuInputWib("2026-09-12T10:05")?.toISOString()).toBe("2026-09-12T03:05:00.000Z");
    expect(bacaWaktuInputWib("2026-09-13T00:00")?.toISOString()).toBe("2026-09-12T17:00:00.000Z");
  });

  it("round-trips", () => {
    const d = new Date("2026-02-28T22:41:00.000Z");
    expect(bacaWaktuInputWib(waktuWibUntukInput(d))?.toISOString()).toBe(d.toISOString());
  });

  it("refuses malformed or rolled-over values", () => {
    for (const teks of ["", "2026-09-12", "2026-09-12 10:05", "2026-02-30T10:00", "2026-09-12T25:00", "kemarin"]) {
      expect(bacaWaktuInputWib(teks), teks).toBeNull();
    }
  });
});

describe("periksaMasukanBuktiTerima", () => {
  const sah = {
    receivedByName: " Bu Siti ",
    receivedAt: "2026-09-12T04:00:00.000Z",
    podPhotoUrl: "/api/foto/ckfoto1",
    idempotencyKey: "kunci-1",
  };

  it("normalizes a valid record", () => {
    const h = periksaMasukanBuktiTerima(sah, "CATAT");
    expect(h).toEqual({
      ok: true,
      nilai: {
        receivedByName: "Bu Siti",
        receivedAt: new Date("2026-09-12T04:00:00.000Z"),
        podPhotoUrl: "/api/foto/ckfoto1",
        fotoId: "ckfoto1",
        idempotencyKey: "kunci-1",
        reason: null,
        jenisBukti: null,
      },
    });
  });

  it("names exactly what is wrong", () => {
    expect(periksaMasukanBuktiTerima({ ...sah, receivedByName: "A" }, "CATAT")).toEqual({ ok: false, kode: "NAMA_TIDAK_SAH" });
    expect(periksaMasukanBuktiTerima({ ...sah, receivedAt: "besok" }, "CATAT")).toEqual({ ok: false, kode: "WAKTU_TIDAK_SAH" });
    expect(periksaMasukanBuktiTerima({ ...sah, receivedAt: 12 }, "CATAT")).toEqual({ ok: false, kode: "WAKTU_TIDAK_SAH" });
    expect(periksaMasukanBuktiTerima({ ...sah, podPhotoUrl: null }, "CATAT")).toEqual({ ok: false, kode: "FOTO_WAJIB" });
    expect(periksaMasukanBuktiTerima({ ...sah, podPhotoUrl: "" }, "CATAT")).toEqual({ ok: false, kode: "FOTO_WAJIB" });
    expect(periksaMasukanBuktiTerima({ ...sah, podPhotoUrl: "https://x.example/a.jpg" }, "CATAT")).toEqual({
      ok: false,
      kode: "FOTO_TIDAK_SAH",
    });
    expect(periksaMasukanBuktiTerima({ ...sah, idempotencyKey: "" }, "CATAT")).toEqual({ ok: false, kode: "KUNCI_TIDAK_SAH" });
    expect(periksaMasukanBuktiTerima({ ...sah, idempotencyKey: "k".repeat(65) }, "CATAT")).toEqual({
      ok: false,
      kode: "KUNCI_TIDAK_SAH",
    });
    expect(periksaMasukanBuktiTerima({ ...sah, jenisBukti: "VIDEO" }, "CATAT")).toEqual({ ok: false, kode: "JENIS_BUKTI_TIDAK_SAH" });
  });

  it("keeps the evidence kind when it is one of the two", () => {
    const h = periksaMasukanBuktiTerima({ ...sah, jenisBukti: "TANDA_TANGAN" }, "CATAT");
    expect(h.ok && h.nilai.jenisBukti).toBe("TANDA_TANGAN");
  });

  it("requires a reason for a correction, and only for a correction", () => {
    expect(periksaMasukanBuktiTerima(sah, "KOREKSI")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaMasukanBuktiTerima({ ...sah, reason: "   " }, "KOREKSI")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaMasukanBuktiTerima({ ...sah, reason: "x".repeat(501) }, "KOREKSI")).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const h = periksaMasukanBuktiTerima({ ...sah, reason: "  Salah ketik nama  " }, "KOREKSI");
    expect(h.ok && h.nilai.reason).toBe("Salah ketik nama");
    const catat = periksaMasukanBuktiTerima({ ...sah, reason: "diabaikan" }, "CATAT");
    expect(catat.ok && catat.nilai.reason).toBeNull();
  });
});

describe("sumberPencatat", () => {
  const salesmanId = "u-sales";

  it("lets the order's own salesman record from the phone", () => {
    expect(sumberPencatat({ izin: ["pwa:access"], userId: salesmanId, salesmanId })).toBe("SALESMAN");
  });

  it("refuses another salesman, even with the phone permission", () => {
    expect(sumberPencatat({ izin: ["pwa:access"], userId: "u-lain", salesmanId })).toBeNull();
  });

  it("refuses the owner without the phone permission", () => {
    expect(sumberPencatat({ izin: [], userId: salesmanId, salesmanId })).toBeNull();
  });

  it("lets the office record with deliver or approve", () => {
    expect(sumberPencatat({ izin: ["field_sales_orders:deliver"], userId: "u-kantor", salesmanId })).toBe("KANTOR");
    expect(sumberPencatat({ izin: ["field_sales_orders:approve"], userId: "u-kantor", salesmanId })).toBe("KANTOR");
    expect(sumberPencatat({ izin: ["*"], userId: "u-admin", salesmanId })).toBe("KANTOR");
    expect(sumberPencatat({ izin: ["field_sales_orders:view"], userId: "u-kantor", salesmanId })).toBeNull();
  });
});

describe("bolehMengoreksiBuktiTerima", () => {
  it("is the office's call — the salesman who recorded it does not get to rewrite it", () => {
    expect(bolehMengoreksiBuktiTerima(["field_sales_orders:deliver"])).toBe(true);
    expect(bolehMengoreksiBuktiTerima(["field_sales_orders:approve"])).toBe(true);
    expect(bolehMengoreksiBuktiTerima(["pwa:access"])).toBe(false);
    expect(bolehMengoreksiBuktiTerima(undefined)).toBe(false);
  });
});

describe("samaIsinya", () => {
  const a = { receivedByName: "Bu Siti", receivedAt: new Date("2026-09-12T04:00:00.000Z"), podPhotoUrl: "/api/foto/x" };

  it("compares name, instant and photo", () => {
    expect(samaIsinya(a, { ...a, receivedAt: new Date(a.receivedAt.getTime()) })).toBe(true);
    expect(samaIsinya(a, { ...a, receivedByName: "Bu Sita" })).toBe(false);
    expect(samaIsinya(a, { ...a, receivedAt: new Date(a.receivedAt.getTime() + 1) })).toBe(false);
    expect(samaIsinya(a, { ...a, podPhotoUrl: "/api/foto/y" })).toBe(false);
  });

  it("treats an unrecorded side as different", () => {
    expect(samaIsinya(a, { receivedByName: null, receivedAt: null, podPhotoUrl: null })).toBe(false);
  });
});
