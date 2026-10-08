import { describe, expect, it } from "vitest";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";
import { manusiakanKodePeran, namaTampilPeran, PERAN_BERNAMA, punyaNamaTampil, urutPeranTampil } from "./nama-peran";

const namaId = id.settings.users.roleName as Record<string, string>;
const namaEn = en.settings.users.roleName as Record<string, string>;
const terjemahId = (kode: string) => namaId[kode] ?? `?${kode}`;

describe("namaTampilPeran", () => {
  it("peran seed tampil dengan namanya, bukan kodenya", () => {
    expect(namaTampilPeran("PRODUCTION", terjemahId)).toBe("Produksi");
    expect(namaTampilPeran("ADMIN", terjemahId)).toBe("Administrator");
    expect(namaTampilPeran("KEUANGAN", terjemahId)).toBe("Keuangan");
    expect(namaTampilPeran("ADMIN_PAJAK", terjemahId)).toBe("Admin pajak");
    expect(namaTampilPeran("ADMIN_PENJUALAN", terjemahId)).toBe("Admin penjualan");
  });

  it("PURCHASER bernama Pembelian (satu nama di semua layar pengaturan)", () => {
    expect(namaTampilPeran("PURCHASER", terjemahId)).toBe("Pembelian");
  });

  it("peran buatan sendiri berkode dimanusiakan, singkatan tetap besar", () => {
    expect(namaTampilPeran("ADMIN_GUDANG", terjemahId)).toBe("Admin gudang");
    expect(namaTampilPeran("MANAJER", terjemahId)).toBe("Manajer");
    expect(namaTampilPeran("SPG_SENIOR", terjemahId)).toBe("SPG senior");
    expect(namaTampilPeran("KEPALA-PO", terjemahId)).toBe("Kepala PO");
  });

  it("nama yang ditulis seperti kalimat tampil apa adanya", () => {
    expect(namaTampilPeran("Manajer toko", terjemahId)).toBe("Manajer toko");
    expect(namaTampilPeran("  Kasir ", terjemahId)).toBe("Kasir");
    expect(namaTampilPeran("toString", terjemahId)).toBe("toString");
    expect(manusiakanKodePeran("123")).toBe("123");
  });

  it("hanya kode yang terdaftar dianggap bernama", () => {
    expect(punyaNamaTampil("SPG")).toBe(true);
    expect(punyaNamaTampil("constructor")).toBe(false);
    expect(punyaNamaTampil("spg")).toBe(false);
  });
});

describe("terjemahan nama peran", () => {
  it("setiap peran bernama punya nama di kedua bahasa", () => {
    for (const kode of PERAN_BERNAMA) {
      expect(namaId[kode], `id settings.users.roleName.${kode}`).toBeTruthy();
      expect(namaEn[kode], `en settings.users.roleName.${kode}`).toBeTruthy();
    }
  });

  it("nama Indonesia berhuruf kapital hanya di awal (kecuali singkatan)", () => {
    for (const kode of PERAN_BERNAMA) {
      const kata = namaId[kode].split(" ").slice(1);
      for (const k of kata) expect(k === k.toLowerCase() || k === k.toUpperCase(), `${kode}: ${namaId[kode]}`).toBe(true);
    }
  });
});

describe("urutPeranTampil", () => {
  it("peran sistem dulu, lalu menurut nama tampil", () => {
    const peran = [
      { nama: "WAREHOUSE", sistem: false },
      { nama: "ADMIN_PAJAK", sistem: false },
      { nama: "PURCHASER", sistem: false },
      { nama: "ADMIN", sistem: true },
      { nama: "KEUANGAN", sistem: false },
      { nama: "Kasir", sistem: false },
    ];
    const urut = urutPeranTampil(
      peran,
      (p) => namaTampilPeran(p.nama, terjemahId),
      (p) => p.sistem,
    ).map((p) => namaTampilPeran(p.nama, terjemahId));
    expect(urut).toEqual(["Administrator", "Admin pajak", "Gudang", "Kasir", "Keuangan", "Pembelian"]);
    expect(peran[0].nama).toBe("WAREHOUSE");
  });
});
