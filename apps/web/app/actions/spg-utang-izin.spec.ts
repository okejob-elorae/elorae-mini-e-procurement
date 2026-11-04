import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Utang SPG yang berhenti (P6, P6a, P67, P68): mencatat sisa minus sebagai utang, membayar
 * koreksi plus sesudah pembayaran terakhir, mencatat dan merevisi penerimaan utang =
 * `spg_commission:pay` (B33); memeriksa penerimaan terhadap mutasi rekening =
 * `payments:verify` (keputusan 11). Membatalkan: yang belum dicek dengan izin bayar, yang
 * sudah terverifikasi dengan izin periksa — penulisnya menerima keduanya sebagai tanda.
 * Tombol di halaman memakai izin yang sama dengan aksinya. Tanpa basis data: penulis,
 * kait jurnal, dan R2 ditiru.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dipanggil: [] as { fn: string; input: Record<string, unknown> }[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/r2", () => ({ uploadToR2: vi.fn(async () => {}) }));
vi.mock("@/lib/finance/operasional/kait", () => ({
  kaitBayarTambahanSpg: vi.fn(async () => {}),
  kaitPenerimaanUtangSpg: vi.fn(async () => {}),
}));
vi.mock("@/lib/spg/utang-writer", () => {
  const catat = (fn: string, hasil: Record<string, unknown>) =>
    vi.fn(async (input: Record<string, unknown>) => {
      state.dipanggil.push({ fn, input });
      return { ok: true, ...hasil };
    });
  return {
    catatSisaSpgBerhenti: catat("catatSisaSpgBerhenti", { utang: 50_000 }),
    terapkanKoreksiPlusSesudahAkhir: catat("terapkanKoreksiPlusSesudahAkhir", { payoutId: "po1", imbang: 10_000, dibayar: 0 }),
    catatPenerimaanUtangSpg: catat("catatPenerimaanUtangSpg", { id: "pn1" }),
    revisiPenerimaanUtangSpg: catat("revisiPenerimaanUtangSpg", {}),
    periksaPenerimaanUtangSpg: catat("periksaPenerimaanUtangSpg", {}),
    batalkanPenerimaanUtangSpg: catat("batalkanPenerimaanUtangSpg", { terverifikasi: false }),
  };
});

const aksi = await import("./spg-komisi-utang");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dipanggil = [];
});

const formulir = (isi: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
};

/* Empat aksi izin bayar, masing-masing dengan isian yang sah. */
const aksiBayar = {
  catatSisaSpgBerhenti: () => aksi.catatSisaSpgBerhentiAction({ spgUserId: "spg-1", jumlahDiharapkan: 50_000, kunci: "k1" }),
  terapkanKoreksiPlusSesudahAkhir: () =>
    aksi.terapkanKoreksiPlusSesudahAkhirAction(formulir({ spgUserId: "spg-1", jumlahDiharapkan: "10000", kunci: "k2" })),
  catatPenerimaanUtangSpg: () =>
    aksi.catatPenerimaanUtangSpgAction(formulir({ spgUserId: "spg-1", jumlah: "50000", cara: "TRANSFER", diterimaPada: "2026-11-03", kunci: "k3" })),
  revisiPenerimaanUtangSpg: () =>
    aksi.revisiPenerimaanUtangSpgAction(formulir({ id: "pn1", versi: "1", spgUserId: "spg-1", jumlah: "50000", cara: "TRANSFER", diterimaPada: "2026-11-03" })),
};

const periksa = () => aksi.periksaPenerimaanUtangSpgAction({ id: "pn1", versi: 1, keputusan: "TERVERIFIKASI" });
const batalkan = () => aksi.batalkanPenerimaanUtangSpgAction({ id: "pn1", alasan: "uji" });

describe("mencatat utang, koreksi plus, dan penerimaan: spg_commission:pay", () => {
  it("izin periksa saja ditolak sebelum menyentuh penulis", async () => {
    masuk(["payments:verify"]);
    for (const jalankan of Object.values(aksiBayar)) expect(await jalankan()).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin bayar sampai ke penulisnya, atas namanya sendiri", async () => {
    masuk(["spg_commission:pay"]);
    for (const jalankan of Object.values(aksiBayar)) expect((await jalankan()).ok).toBe(true);
    expect(state.dipanggil.map((d) => d.fn)).toEqual(Object.keys(aksiBayar));
    for (const d of state.dipanggil) expect(d.input).toMatchObject({ olehUserId: "u1" });
  });
});

describe("memeriksa penerimaan terhadap mutasi rekening: payments:verify", () => {
  it("izin bayar saja ditolak sebelum menyentuh penulis", async () => {
    masuk(["spg_commission:pay"]);
    expect(await periksa()).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin periksa sampai ke penulisnya, atas namanya sendiri", async () => {
    masuk(["payments:verify"]);
    expect(await periksa()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual([
      { fn: "periksaPenerimaanUtangSpg", input: expect.objectContaining({ id: "pn1", versi: 1, keputusan: "TERVERIFIKASI", olehUserId: "u1" }) },
    ]);
  });
});

describe("membatalkan penerimaan: izin bayar untuk yang belum dicek, izin periksa untuk yang terverifikasi", () => {
  it("tanpa keduanya ditolak sebelum menyentuh penulis", async () => {
    for (const izin of [[], ["receivables:manage"], ["spg_schedules:approve"]]) {
      masuk(izin);
      expect(await batalkan()).toEqual({ ok: false, code: "TANPA_AKSES" });
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("izin bayar saja hanya membawa tanda batal yang belum dicek", async () => {
    masuk(["spg_commission:pay"]);
    expect((await batalkan()).ok).toBe(true);
    expect(state.dipanggil[0].input).toMatchObject({ olehUserId: "u1", bolehBatalkanBelumDicek: true, bolehBatalkanTerverifikasi: false });
  });

  it("izin periksa saja hanya membawa tanda batal yang terverifikasi", async () => {
    masuk(["payments:verify"]);
    expect((await batalkan()).ok).toBe(true);
    expect(state.dipanggil[0].input).toMatchObject({ olehUserId: "u1", bolehBatalkanBelumDicek: false, bolehBatalkanTerverifikasi: true });
  });
});

describe("tombol di halaman memakai izin yang sama dengan aksinya", () => {
  it("Komisi SPG memberi tombol bayar dari spg_commission:pay dan tombol periksa dari payments:verify", () => {
    const halaman = readFileSync(path.join(__dirname, "../backoffice/komisi-spg/page.tsx"), "utf8");
    expect(halaman).toContain("bolehBayar={hasPermission(izin, PERMISSIONS.SPG_COMMISSION_PAY)}");
    expect(halaman).toContain("const verifikasi = bolehMemverifikasi(izin);");
    expect(halaman).toContain("bolehVerifikasi={verifikasi}");
  });
});
