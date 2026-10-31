import { describe, expect, it } from "vitest";
import { bacaPengaturanKasKecil, hitungIsiUlangSen, periksaPengaturanKasKecil, persenTerpakai } from "./kas-kecil";

describe("kas kecil", () => {
  it("membaca pengaturan longgar dan membuang baris rusak/ganda", () => {
    expect(bacaPengaturanKasKecil(null)).toEqual({ dana: [] });
    expect(bacaPengaturanKasKecil("rusak{")).toEqual({ dana: [] });
    const p = bacaPengaturanKasKecil(
      JSON.stringify({
        dana: [
          { akunId: "kk", danaTetap: 2000000, pemegang: " Rina ", rekeningSumberId: "bca" },
          { akunId: "kk", danaTetap: 5 },
          { akunId: "x", danaTetap: -1 },
          { danaTetap: 1 },
        ],
      }),
    );
    expect(p).toEqual({ dana: [{ akunId: "kk", danaTetap: 2_000_000, pemegang: "Rina", rekeningSumberId: "bca" }] });
  });

  it("memeriksa ketat: akun dan sumber harus rekening kas, tidak boleh sama", () => {
    const kas = new Set(["kk", "bca"]);
    expect(periksaPengaturanKasKecil({ dana: [{ akunId: "beban", danaTetap: 1 }] }, kas)).toEqual({ ok: false, kode: "AKUN_BUKAN_KAS", baris: 1 });
    expect(periksaPengaturanKasKecil({ dana: [{ akunId: "kk", danaTetap: "0" }] }, kas)).toEqual({ ok: false, kode: "DANA_TIDAK_SAH", baris: 1 });
    expect(periksaPengaturanKasKecil({ dana: [{ akunId: "kk", danaTetap: 1, rekeningSumberId: "kk" }] }, kas)).toEqual({ ok: false, kode: "SUMBER_SAMA", baris: 1 });
    expect(periksaPengaturanKasKecil({ dana: [{ akunId: "kk", danaTetap: 1 }, { akunId: "kk", danaTetap: 2 }] }, kas)).toEqual({ ok: false, kode: "AKUN_GANDA", baris: 2 });
    const r = periksaPengaturanKasKecil({ dana: [{ akunId: "kk", danaTetap: "1.000.000", rekeningSumberId: "bca" }] }, kas);
    expect(r).toEqual({ ok: true, pengaturan: { dana: [{ akunId: "kk", danaTetap: 1_000_000, pemegang: null, rekeningSumberId: "bca" }] } });
  });

  it("isi ulang = dana tetap − saldo, tidak pernah negatif", () => {
    expect(hitungIsiUlangSen(2_000_000, 350_500.25)).toBe(164_949_975);
    expect(hitungIsiUlangSen(2_000_000, 2_000_000)).toBe(0);
    expect(hitungIsiUlangSen(2_000_000, 2_100_000)).toBe(0);
    expect(hitungIsiUlangSen(1_000_000, -50_000)).toBe(105_000_000);
    expect(persenTerpakai(2_000_000, 500_000)).toBe(75);
    expect(persenTerpakai(2_000_000, 3_000_000)).toBe(0);
    expect(persenTerpakai(0, 0)).toBe(0);
  });
});
