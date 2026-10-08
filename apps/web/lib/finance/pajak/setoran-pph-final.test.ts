import { describe, expect, it } from "vitest";
import { INFO_SETORAN, periksaSetoran, rapikanKodeBilling, rapikanNtpn } from "./setoran";
import { barisPphFinal, hitungPphFinal } from "./pph-final";
import { periksaIdentitasPajak, nitkuEfektif, rapikanNpwp } from "./identitas";

const sah = { jenis: "PPN", masa: "2026-09", jumlah: 1_250_000, tanggalBayar: "2026-10-08", ntpn: "ab12 cd34-ef56 gh78" };

describe("setoran pajak", () => {
  it("menerima isian sah dan merapikan NTPN", () => {
    const r = periksaSetoran(sah, "2026-10-08");
    expect(r).toEqual({
      ok: true,
      setoran: { jenis: "PPN", masa: "2026-09", jumlah: 1_250_000, tanggalBayar: "2026-10-08", ntpn: "AB12CD34EF56GH78", kodeBilling: null, rekeningId: null, catatan: null },
    });
    expect(INFO_SETORAN.PPN.peranDebit).toBe("PPN_PAYABLE");
    expect(INFO_SETORAN.PPH25.peranDebit).toBe("PPH25_PREPAID");
  });

  it("menolak jenis, masa, jumlah bersen, tanggal depan, masa sesudah tanggal bayar, NTPN dan billing rusak", () => {
    expect(periksaSetoran({ ...sah, jenis: "PPH26" }, "2026-10-08")).toEqual({ ok: false, galat: "JENIS_TIDAK_SAH" });
    expect(periksaSetoran({ ...sah, masa: "2026-9" }, "2026-10-08")).toEqual({ ok: false, galat: "MASA_TIDAK_SAH" });
    expect(periksaSetoran({ ...sah, jumlah: 10.5 }, "2026-10-08")).toEqual({ ok: false, galat: "JUMLAH_TIDAK_SAH" });
    expect(periksaSetoran({ ...sah, jumlah: 0 }, "2026-10-08")).toEqual({ ok: false, galat: "JUMLAH_TIDAK_SAH" });
    expect(periksaSetoran({ ...sah, tanggalBayar: "2026-10-09" }, "2026-10-08")).toEqual({ ok: false, galat: "TANGGAL_DEPAN" });
    expect(periksaSetoran({ ...sah, masa: "2026-11", tanggalBayar: "2026-10-08" }, "2026-10-08")).toEqual({ ok: false, galat: "MASA_TIDAK_SAH" });
    expect(periksaSetoran({ ...sah, ntpn: "123" }, "2026-10-08")).toEqual({ ok: false, galat: "NTPN_TIDAK_SAH" });
    expect(periksaSetoran({ ...sah, kodeBilling: "12345" }, "2026-10-08")).toEqual({ ok: false, galat: "BILLING_TIDAK_SAH" });
    expect(rapikanKodeBilling("1234 5678 9012 345")).toBe("123456789012345");
    expect(rapikanNtpn(null)).toBeNull();
  });
});

describe("PPh final UMKM 0,5%", () => {
  it("badan: 0,5% omzet masa dibulatkan ke bawah; PPh 22 marketplace dikreditkan sampai sebesar pajak", () => {
    const h = hitungPphFinal({ omzetMasa: 100_000_399, omzetSebelumnyaTahunIni: 0, bentukUsaha: "PT_PERORANGAN", pph22Masa: 120_000 });
    expect(h).toMatchObject({ dasar: 100_000_399, pajak: 500_001, kreditPph22: 120_000, terutang: 380_001, lewatBatas: false });
    expect(barisPphFinal(h).map((b) => [b.role, b.debit, b.credit])).toEqual([
      ["PPH_FINAL_EXPENSE", 500_001, 0],
      ["PPH22_PREPAID", 0, 120_000],
      ["PPH_FINAL_PAYABLE", 0, 380_001],
    ]);
    const lebih = hitungPphFinal({ omzetMasa: 1_000_000, omzetSebelumnyaTahunIni: 0, bentukUsaha: "PT", pph22Masa: 9_000 });
    expect(lebih).toMatchObject({ pajak: 5_000, kreditPph22: 5_000, terutang: 0 });
  });

  it("orang pribadi: Rp500 juta pertama setahun bebas, dihitung kumulatif", () => {
    expect(hitungPphFinal({ omzetMasa: 100_000_000, omzetSebelumnyaTahunIni: 350_000_000, bentukUsaha: "ORANG_PRIBADI", pph22Masa: 0 }).dasar).toBe(0);
    expect(hitungPphFinal({ omzetMasa: 100_000_000, omzetSebelumnyaTahunIni: 450_000_000, bentukUsaha: "ORANG_PRIBADI", pph22Masa: 0 })).toMatchObject({ dasar: 50_000_000, pajak: 250_000 });
    expect(hitungPphFinal({ omzetMasa: 100_000_000, omzetSebelumnyaTahunIni: 600_000_000, bentukUsaha: "ORANG_PRIBADI", pph22Masa: 0 }).dasar).toBe(100_000_000);
  });

  it("omzet nol/negatif tidak berpajak; lewat Rp4,8 M ditandai", () => {
    const h = hitungPphFinal({ omzetMasa: -5_000, omzetSebelumnyaTahunIni: 0, bentukUsaha: "CV", pph22Masa: 0 });
    expect(h.pajak).toBe(0);
    expect(barisPphFinal(h)).toEqual([]);
    expect(hitungPphFinal({ omzetMasa: 1, omzetSebelumnyaTahunIni: 4_800_000_000, bentukUsaha: "CV", pph22Masa: 0 }).lewatBatas).toBe(true);
  });
});

describe("identitas pajak perusahaan", () => {
  it("NPWP 15/16 angka, NITKU harus diawali NPWP", () => {
    expect(rapikanNpwp("01.234.567.8-901.000")).toBe("0012345678901000");
    expect(rapikanNpwp("1234")).toBeNull();
    expect(periksaIdentitasPajak({ npwp: "0012345678901000", nitku: "", nama: "PT Elorae" })).toEqual({
      ok: true,
      identitas: { npwp: "0012345678901000", nitku: null, nama: "PT Elorae" },
    });
    expect(nitkuEfektif({ npwp: "0012345678901000", nitku: null, nama: null })).toBe("0012345678901000000000");
    expect(periksaIdentitasPajak({ npwp: "0012345678901000", nitku: "9912345678901000000000" })).toEqual({ ok: false, galat: "NITKU_BEDA_NPWP" });
    expect(periksaIdentitasPajak({ npwp: "12" })).toEqual({ ok: false, galat: "NPWP_TIDAK_SAH" });
  });
});
