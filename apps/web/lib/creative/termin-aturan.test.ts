import { describe, expect, it } from "vitest";
import { TARIF_PAJAK_BAWAAN, type SubjekPajak } from "./pph";
import { bagiJumlah } from "./pph";
import { bayarSebelumTayang, bobotUlang, jatuhTempoTermin, nilaiBasis, rencanaBawaan, rencanakanTermin, turunkanBayar, type RencanaTermin } from "./termin-aturan";

const OP: SubjekPajak = { jenis: "ORANG_PRIBADI", adaNpwp: true };

const dasar = (rencana: RencanaTermin[], extra: Partial<Parameters<typeof rencanakanTermin>[0]> = {}) =>
  rencanakanTermin({ fee: 10_000_000, mode: "DIPOTONG", subjek: OP, tarif: TARIF_PAJAK_BAWAAN, dibayar: [], rencana, dasar: "PERSEN", ...extra });

describe("turunkanBayar", () => {
  const t = (status: "BELUM" | "DIBAYAR" | "BATAL", bruto: number, hari: string | null = null, grossUp = false, neto = bruto) => ({
    status,
    bruto,
    neto,
    grossUp,
    dibayarHari: hari,
  });

  it("fee nol atau tanpa termin hidup → TIDAK_PERLU", () => {
    expect(turunkanBayar(0, [t("DIBAYAR", 100, "2026-10-01")])).toEqual({ payStatus: "TIDAK_PERLU", paidAmount: 0, paidAtHari: null });
    expect(turunkanBayar(100, [t("BATAL", 100)])).toEqual({ payStatus: "TIDAK_PERLU", paidAmount: 0, paidAtHari: null });
  });

  it("belum / sebagian / lunas dan tanggal terakhir", () => {
    expect(turunkanBayar(1_000, [t("BELUM", 500), t("BELUM", 500)])).toEqual({ payStatus: "BELUM", paidAmount: 0, paidAtHari: null });
    expect(turunkanBayar(1_000, [t("DIBAYAR", 500, "2026-10-02"), t("BELUM", 500)])).toEqual({
      payStatus: "SEBAGIAN",
      paidAmount: 500,
      paidAtHari: "2026-10-02",
    });
    expect(turunkanBayar(1_000, [t("DIBAYAR", 500, "2026-10-02"), t("DIBAYAR", 500, "2026-10-05"), t("BATAL", 900)])).toEqual({
      payStatus: "LUNAS",
      paidAmount: 1_000,
      paidAtHari: "2026-10-05",
    });
  });

  it("gross-up dijumlah dalam neto (basis fee)", () => {
    expect(nilaiBasis({ bruto: 1_025_641, neto: 1_000_000, grossUp: true })).toBe(1_000_000);
    expect(turunkanBayar(1_000_000, [t("DIBAYAR", 1_025_641, "2026-10-01", true, 1_000_000)]).paidAmount).toBe(1_000_000);
  });
});

describe("rencanakanTermin", () => {
  it("bawaan: satu Pelunasan 100% sesudah tayang", () => {
    const r = dasar(rencanaBawaan(14));
    if (!r.ok) throw new Error(r.kode);
    expect(r.baris).toHaveLength(1);
    expect(r.baris[0]).toMatchObject({ label: "Pelunasan", persenFee: 100, jumlah: 10_000_000, pemicu: "TAYANG", hariSesudah: 14 });
    expect(r.baris[0].rincian).toMatchObject({ bruto: 10_000_000, pph: 250_000, neto: 9_750_000 });
  });

  it("DP 50% deal + pelunasan 50% tayang+14 — PPh per termin", () => {
    const r = dasar([
      { label: "DP", persen: 50, pemicu: "DEAL" },
      { label: "Pelunasan", persen: 50, pemicu: "TAYANG", hariSesudah: 14 },
    ]);
    if (!r.ok) throw new Error(r.kode);
    expect(r.baris.map((b) => b.jumlah)).toEqual([5_000_000, 5_000_000]);
    expect(r.baris.map((b) => b.rincian.pph)).toEqual([125_000, 125_000]);
  });

  it("jumlah termin selalu persis sama dengan fee (sisa terbesar)", () => {
    const r = rencanakanTermin({
      fee: 1_000_000,
      mode: "DIPOTONG",
      subjek: OP,
      tarif: TARIF_PAJAK_BAWAAN,
      dibayar: [],
      dasar: "PERSEN",
      rencana: [
        { label: "A", persen: 33.33, pemicu: "DEAL" },
        { label: "B", persen: 33.33, pemicu: "DEAL" },
        { label: "C", persen: 33.34, pemicu: "TAYANG" },
      ],
    });
    if (!r.ok) throw new Error(r.kode);
    expect(r.baris.reduce((s, b) => s + b.jumlah, 0)).toBe(1_000_000);
  });

  it("gross-up: jumlah = neto, bruto dicari per termin", () => {
    const r = dasar([{ label: "Pelunasan", persen: 100, pemicu: "TAYANG" }], { mode: "GROSS_UP", fee: 9_750_000 });
    if (!r.ok) throw new Error(r.kode);
    expect(r.baris[0].jumlah).toBe(9_750_000);
    expect(r.baris[0].rincian).toMatchObject({ neto: 9_750_000, grossUp: true });
    expect(r.baris[0].rincian.bruto).toBeGreaterThan(9_750_000);
  });

  it("termin dibayar terkunci: rencana hanya membagi sisa", () => {
    const r = dasar([{ label: "Pelunasan", persen: 100, pemicu: "TAYANG" }], { dibayar: [4_000_000] });
    if (!r.ok) throw new Error(r.kode);
    expect(r.sisa).toBe(6_000_000);
    expect(r.baris[0]).toMatchObject({ jumlah: 6_000_000, persenFee: 60 });
  });

  it("dasar JUMLAH: total harus sama dengan sisa", () => {
    expect(dasar([{ label: "A", jumlah: 3_000_000, pemicu: "DEAL" }], { dasar: "JUMLAH" })).toEqual({ ok: false, kode: "TOTAL_JUMLAH" });
    const r = dasar(
      [
        { label: "A", jumlah: 3_000_000, pemicu: "DEAL" },
        { label: "B", jumlah: 7_000_000, pemicu: "TANGGAL", tanggal: "2026-11-01" },
      ],
      { dasar: "JUMLAH" },
    );
    expect(r).toMatchObject({ ok: true });
  });

  it("penolakan", () => {
    expect(dasar([{ label: "A", persen: 60, pemicu: "DEAL" }])).toEqual({ ok: false, kode: "TOTAL_PERSEN" });
    expect(dasar([{ label: " ", persen: 100, pemicu: "DEAL" }])).toEqual({ ok: false, kode: "LABEL_WAJIB", indeks: 0 });
    expect(dasar([{ label: "A", persen: 100, pemicu: "TANGGAL" }])).toEqual({ ok: false, kode: "TANGGAL_WAJIB", indeks: 0 });
    expect(dasar([{ label: "A", persen: 100, pemicu: "TAYANG", hariSesudah: -1 }])).toEqual({ ok: false, kode: "HARI_TIDAK_VALID", indeks: 0 });
    expect(dasar([])).toEqual({ ok: false, kode: "KOSONG" });
    expect(dasar([{ label: "A", persen: 100, pemicu: "DEAL" }], { dibayar: [11_000_000] })).toEqual({ ok: false, kode: "SISA_NEGATIF" });
    expect(dasar([{ label: "A", persen: 100, pemicu: "DEAL" }], { dibayar: [10_000_000] })).toEqual({ ok: false, kode: "SUDAH_LUNAS" });
    expect(dasar([], { dibayar: [10_000_000] })).toEqual({ ok: true, sisa: 0, baris: [] });
    const banyak = Array.from({ length: 13 }, (_, i) => ({ label: `T${i}`, persen: 100 / 13, pemicu: "DEAL" as const }));
    expect(dasar(banyak)).toEqual({ ok: false, kode: "TERLALU_BANYAK" });
  });
});

describe("jatuhTempoTermin", () => {
  it("dari deal / tayang + hari, atau tanggal tetap; null selama pemicu belum terjadi", () => {
    expect(jatuhTempoTermin({ pemicu: "TAYANG", hariSesudah: 14 }, { dealHari: "2026-10-01", tayangHari: "2026-10-10" })).toBe("2026-10-24");
    expect(jatuhTempoTermin({ pemicu: "TAYANG", hariSesudah: 14 }, { dealHari: "2026-10-01", tayangHari: null })).toBeNull();
    expect(jatuhTempoTermin({ pemicu: "DEAL", hariSesudah: 0 }, { dealHari: "2026-10-01", tayangHari: null })).toBe("2026-10-01");
    expect(jatuhTempoTermin({ pemicu: "TANGGAL", hariSesudah: 0, tanggal: "2026-12-01" }, { dealHari: null, tayangHari: null })).toBe("2026-12-01");
  });
});

describe("bobotUlang", () => {
  it("membagi ulang sisa mengikuti proporsi lama, jumlahnya persis", () => {
    const bobot = bobotUlang([5_000_000, 5_000_000]);
    expect(bagiJumlah(12_000_001, bobot)).toEqual([6_000_001, 6_000_000]);
    expect(bobotUlang([0, 0])).toEqual([100, 0]);
    expect(bobotUlang([])).toEqual([]);
  });
});

describe("bayarSebelumTayang", () => {
  it("hanya termin belum dibayar yang dipicu tayang dan belum punya jatuh tempo", () => {
    const tempo = { tanggal: "2026-10-20", lewat: false, lewatHari: 0 };
    expect(bayarSebelumTayang({ status: "BELUM", pemicu: "TAYANG", jatuhTempo: null })).toBe(true);
    expect(bayarSebelumTayang({ status: "BELUM", pemicu: "TAYANG", jatuhTempo: tempo })).toBe(false);
    expect(bayarSebelumTayang({ status: "BELUM", pemicu: "DEAL", jatuhTempo: null })).toBe(false);
    expect(bayarSebelumTayang({ status: "DIBAYAR", pemicu: "TAYANG", jatuhTempo: null })).toBe(false);
    expect(bayarSebelumTayang({ status: "BELUM", pemicu: "TANGGAL", jatuhTempo: null })).toBe(false);
  });
});
