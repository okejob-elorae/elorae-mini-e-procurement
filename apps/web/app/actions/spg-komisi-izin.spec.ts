import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Menandai komisi SPG toko putus sudah dibayar: `spg_commission:pay`
 * (keputusan pemilik 2026-11-01), dulu `receivables:manage`. Menetapkan
 * komisinya tetap `receivables:manage` — yang menghitung tidak otomatis yang
 * mengeluarkan uang. "Tandai laporan dicek" dan pembatalannya memakai izin
 * yang sama dengan menetapkan, dan tombolnya di halaman memakai izin yang sama
 * dengan aksinya. Tanpa basis data: penulisnya ditiru.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dipanggil: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/spg/komisi-writer", () => ({
  tandaiKomisiDibayar: vi.fn(async () => {
    state.dipanggil.push("tandaiKomisiDibayar");
    return { ok: true, storeId: "s1", periode: "2026-10", diubah: false, dibayar: 20_000, koreksi: 0 };
  }),
  tetapkanKomisiToko: vi.fn(async () => {
    state.dipanggil.push("tetapkanKomisiToko");
    return { ok: true, ulang: false, ditulis: 1, dihapus: 0 };
  }),
  tandaiLaporanDicek: vi.fn(async () => {
    state.dipanggil.push("tandaiLaporanDicek");
    return { ok: true, bulanBayar: "2026-11" };
  }),
  batalkanTandaDicek: vi.fn(async () => {
    state.dipanggil.push("batalkanTandaDicek");
    return { ok: true, dihapus: 0 };
  }),
}));
vi.mock("@/lib/finance/operasional/kait", () => ({
  kaitBayarKomisiSpg: vi.fn(async () => {}),
  kaitKomisiSpg: vi.fn(async () => {}),
}));

const aksi = await import("./spg-komisi");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dipanggil = [];
});

const bayar = () => aksi.tandaiKomisiSpgDibayarAction({ commissionId: "k1", jumlahDiharapkan: 20_000 });

describe("menandai komisi SPG toko putus dibayar: spg_commission:pay", () => {
  it("pengelola piutang dan pengatur tarif komisi ditolak sebelum menyentuh penulis", async () => {
    for (const izin of [["receivables:manage"], ["spg_commission:manage"], ["consignment:manage"]]) {
      masuk(izin);
      expect(await bayar()).toEqual({ ok: false, code: "FORBIDDEN" });
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin bayar menandai dibayar", async () => {
    masuk(["spg_commission:pay"]);
    expect(await bayar()).toEqual({ ok: true, dibayar: 20_000, koreksi: 0 });
    expect(state.dipanggil).toEqual(["tandaiKomisiDibayar"]);
  });

  it("yang dilihat di layar wajib ikut: tanpa, bukan angka, atau minus ditolak INVALID sebelum menyentuh penulis", async () => {
    masuk(["spg_commission:pay"]);
    for (const jumlahDiharapkan of [undefined, null, "20000", Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(await aksi.tandaiKomisiSpgDibayarAction({ commissionId: "k1", jumlahDiharapkan })).toEqual({ ok: false, code: "INVALID" });
    }
    expect(state.dipanggil).toEqual([]);
    // Tanpa izin tetap FORBIDDEN lebih dulu, apa pun isiannya.
    masuk(["receivables:manage"]);
    expect(await aksi.tandaiKomisiSpgDibayarAction({ commissionId: "k1", jumlahDiharapkan: -1 })).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("menetapkan komisi tetap milik pengelola piutang, bukan pemegang izin bayar", async () => {
    masuk(["spg_commission:pay"]);
    expect(await aksi.tetapkanKomisiSpgAction({ storeId: "s1", periode: "2026-10" })).toEqual({ ok: false, code: "FORBIDDEN" });
    masuk(["receivables:manage"]);
    expect((await aksi.tetapkanKomisiSpgAction({ storeId: "s1", periode: "2026-10" })).ok).toBe(true);
    expect(state.dipanggil).toEqual(["tetapkanKomisiToko"]);
  });
});

describe("tandai laporan dicek dan pembatalannya: receivables:manage, seperti menetapkan", () => {
  const cek = () => aksi.tandaiLaporanDicekAction({ storeId: "s1", periode: "2026-10" });
  const batal = () => aksi.batalkanTandaDicekAction({ storeId: "s1", periode: "2026-10", alasan: "uji" });

  it("pemegang izin bayar, pengatur tarif, dan pengelola konsinyasi ditolak sebelum menyentuh penulis", async () => {
    for (const izin of [["spg_commission:pay"], ["spg_commission:manage"], ["consignment:manage"], ["spg_sales:view"]]) {
      masuk(izin);
      expect(await cek()).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(await batal()).toEqual({ ok: false, code: "FORBIDDEN" });
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pengelola piutang mencatat dan membatalkan; isian tidak sah ditolak", async () => {
    masuk(["receivables:manage"]);
    expect(await cek()).toEqual({ ok: true, bulanBayar: "2026-11" });
    expect(await batal()).toEqual({ ok: true, dihapus: 0 });
    expect(await aksi.tandaiLaporanDicekAction({ storeId: "s1", periode: "2026-1" })).toEqual({ ok: false, code: "INVALID" });
    expect(await aksi.batalkanTandaDicekAction({ storeId: "", periode: "2026-10", alasan: "x" })).toEqual({ ok: false, code: "INVALID" });
    expect(state.dipanggil).toEqual(["tandaiLaporanDicek", "batalkanTandaDicek"]);
  });

  it("halaman Komisi SPG memakai izin yang sama dengan aksinya", () => {
    const halaman = readFileSync(path.join(__dirname, "../backoffice/komisi-spg/page.tsx"), "utf8");
    expect(halaman).toContain("bolehKelola={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)}");
    expect(halaman).toContain("bolehBayar={hasPermission(izin, PERMISSIONS.SPG_COMMISSION_PAY)}");
    const klien = readFileSync(path.join(__dirname, "../backoffice/komisi-spg/KomisiSpgClient.tsx"), "utf8");
    // Tandai dicek hanya untuk pengelola; tandai dibayar hanya untuk pemegang izin bayar.
    expect(klien).toMatch(/bolehKelola \? \(\s*<TombolDicek/);
    expect(klien).toMatch(/\{bolehBayar \? \(\s*<TableCell className="text-right">/);
  });
});
