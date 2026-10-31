import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ambilTitipan, titipKembali, tujuanSesudahCheckIn } from "@/lib/pwa/kembali-setelah-checkin";

/*
 * SPG yang check-in tanpa layar tujuan mendarat di BERANDA-nya (tombol Jual ada
 * di sana), bukan di halaman toko. `checkIn` selalu mengalihkan ke halaman toko;
 * `CheckInButton` menitipkan tujuan SETIAP kali, dan halaman toko hanya
 * meneruskannya untuk toko TETAP milik SPG — salesman tetap di halaman toko.
 */

const DIR = path.resolve(__dirname);
const baca = (berkas: string) => readFileSync(path.join(DIR, berkas), "utf8");

describe("sambungan check-in → beranda SPG (pemeriksaan statis)", () => {
  it("CheckInButton menitipkan tujuan pada setiap check-in, bukan hanya bila ada `kembali`", () => {
    const isi = baca("CheckInButton.tsx");
    expect(isi).toMatch(/titipKembali\(storeId, tujuanSesudahCheckIn\(kembali\)\)/);
    expect(isi).not.toMatch(/if \(kembali\)\s*titipKembali/);
  });

  it("titipan hanya dibaca halaman toko tetap milik SPG yang sedang check-in", () => {
    const isi = baca("page.tsx");
    const pasang = isi.match(/\{([^{}]*)\?\s*<LanjutSetelahCheckIn\b/);
    expect(pasang?.[1]).toMatch(/tokoTetap/);
    expect(isi.match(/<LanjutSetelahCheckIn\b/g)).toHaveLength(1);
  });
});

describe("titipan sesudah check-in (sessionStorage)", () => {
  const simpanan = new Map<string, string>();
  beforeEach(() => {
    simpanan.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => simpanan.get(k) ?? null,
        setItem: (k: string, v: string) => void simpanan.set(k, v),
        removeItem: (k: string) => void simpanan.delete(k),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tanpa layar tujuan: halaman toko meneruskan ke beranda, sekali saja", () => {
    titipKembali("toko-1", tujuanSesudahCheckIn(null));
    expect(ambilTitipan("toko-1")).toBe("/pwa");
    // Membuka halaman toko lagi sesudahnya tidak dialihkan.
    expect(ambilTitipan("toko-1")).toBeNull();
  });

  it("layar yang meminta check-in tetap menang (opname, terima, jual)", () => {
    titipKembali("toko-1", tujuanSesudahCheckIn("/pwa/spg/opname"));
    expect(ambilTitipan("toko-1")).toBe("/pwa/spg/opname");
  });

  it("titipan untuk toko lain tidak membajak halaman toko ini", () => {
    titipKembali("toko-2", tujuanSesudahCheckIn(null));
    expect(ambilTitipan("toko-1")).toBeNull();
  });
});
