import { describe, expect, it } from "vitest";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";
import type { DokumenTanpaJurnal, OpsiCariSapuan, SumberSapuan } from "./registri";
import { cariSemuaTanpaJurnal, jalankanSapuan, rentangSapuan, ringkasLogSapuan } from "./runner";

/*
 * Runner sapuan dengan sumber tiruan — tanpa basis data: lantai tanggal mulai,
 * batas & tanda terpotong, cakupan id, dan galat satu sumber yang tidak
 * menghentikan sumber lain.
 */

const hari = (t: string) => new Date(`${t}T00:00:00.000+07:00`);

function sumberTiruan(
  sourceType: string,
  dokumen: DokumenTanpaJurnal[],
  hasil: (id: string) => GenerateAutoJournalResult | Error = () => ({ ok: true, journalId: "j", created: true }),
): SumberSapuan & { panggilan: OpsiCariSapuan[]; diposting: string[] } {
  const s = {
    sourceType,
    label: sourceType,
    panggilan: [] as OpsiCariSapuan[],
    diposting: [] as string[],
    cariTanpaJurnal: async (opsi: OpsiCariSapuan) => {
      s.panggilan.push(opsi);
      return dokumen.filter((d) => d.tanggal >= opsi.sejak && d.tanggal <= opsi.sampai).slice(0, opsi.batas);
    },
    posting: async (id: string) => {
      s.diposting.push(id);
      const h = hasil(id);
      if (h instanceof Error) throw h;
      return h;
    },
  };
  return s;
}

const dok = (id: string, t: string): DokumenTanpaJurnal => ({ id, tanggal: hari(t), label: id.toUpperCase() });

describe("rentangSapuan", () => {
  it("tanpa tanggal mulai → null (sapuan tidak berjalan)", async () => {
    expect(await rentangSapuan({ sampai: hari("2026-10-01"), tanggalMulai: null })).toBeNull();
  });

  it("`sejak` sebelum tanggal mulai dipotong ke tanggal mulai; rentang yang seluruhnya sebelum tanggal mulai → null", async () => {
    const r = await rentangSapuan({ sejak: hari("2026-01-01"), sampai: hari("2026-10-01"), tanggalMulai: hari("2026-08-01") });
    expect(r?.sejak.toISOString()).toBe(hari("2026-08-01").toISOString());
    expect(await rentangSapuan({ sejak: hari("2026-01-01"), sampai: hari("2026-07-01"), tanggalMulai: hari("2026-08-01") })).toBeNull();
    const sesudah = await rentangSapuan({ sejak: hari("2026-09-01"), sampai: hari("2026-10-01"), tanggalMulai: hari("2026-08-01") });
    expect(sesudah?.sejak.toISOString()).toBe(hari("2026-09-01").toISOString());
  });
});

describe("cariSemuaTanpaJurnal", () => {
  it("meminta batas + 1 untuk tahu terpotong, mengembalikan paling banyak `batas`; galat satu sumber tidak menghentikan yang lain", async () => {
    const a = sumberTiruan("A", [dok("a1", "2026-08-02"), dok("a2", "2026-08-03"), dok("a3", "2026-08-04")]);
    const rusak: SumberSapuan = {
      sourceType: "RUSAK",
      label: "Rusak",
      cariTanpaJurnal: async () => {
        throw new Error("kueri gagal");
      },
      posting: async () => ({ ok: false, code: "NOTHING_TO_POST" }),
    };
    const b = sumberTiruan("B", [dok("b1", "2026-08-05")]);
    const hasil = await cariSemuaTanpaJurnal({
      sejak: hari("2026-08-01"),
      sampai: hari("2026-08-31"),
      batasPerSumber: 2,
      sumber: [a, rusak, b],
    });
    expect(a.panggilan[0].batas).toBe(3);
    expect(hasil.map((h) => [h.sourceType, h.dokumen.map((d) => d.id), h.terpotong, h.galat])).toEqual([
      ["A", ["a1", "a2"], true, null],
      ["RUSAK", [], false, "kueri gagal"],
      ["B", ["b1"], false, null],
    ]);
  });
});

describe("jalankanSapuan", () => {
  it("tanpa tanggal mulai tidak menyapu apa pun", async () => {
    const a = sumberTiruan("A", [dok("a1", "2026-08-02")]);
    const r = await jalankanSapuan({ sumber: [a], tanggalMulai: null, olehUserId: "u" });
    expect(r.dilewati).toBe("TANPA_TANGGAL_MULAI");
    expect(a.panggilan).toHaveLength(0);
  });

  it("dokumen sebelum tanggal mulai tidak pernah dicari, walau `sejak` lebih awal", async () => {
    const a = sumberTiruan("A", [dok("lama", "2026-07-15"), dok("baru", "2026-08-15")]);
    const r = await jalankanSapuan({
      sumber: [a],
      tanggalMulai: hari("2026-08-01"),
      sejak: hari("2026-01-01"),
      sampai: hari("2026-09-01"),
      olehUserId: "u",
    });
    expect(a.diposting).toEqual(["baru"]);
    expect(r.dilewati).toBeNull();
  });

  it("menghitung diposting / sudah ada / nihil / gagal; posting yang melempar terhitung ERROR dan tidak menghentikan dokumen berikutnya", async () => {
    const a = sumberTiruan(
      "A",
      [dok("baru", "2026-08-02"), dok("ada", "2026-08-03"), dok("nol", "2026-08-04"), dok("petakan", "2026-08-05"), dok("meledak", "2026-08-06"), dok("akhir", "2026-08-07")],
      (id) => {
        if (id === "ada") return { ok: true, journalId: "j", created: false };
        if (id === "nol") return { ok: false, code: "NOTHING_TO_POST" };
        if (id === "petakan") return { ok: false, code: "UNMAPPED_ROLE", role: "AR_STORE" };
        if (id === "meledak") return new Error("boom");
        return { ok: true, journalId: "j", created: true };
      },
    );
    const r = await jalankanSapuan({ sumber: [a], tanggalMulai: hari("2026-08-01"), sampai: hari("2026-09-01"), olehUserId: "u" });
    if (r.dilewati) throw new Error("tidak boleh dilewati");
    expect(r.sumber[0]).toMatchObject({
      ditemukan: 6,
      diposting: 2,
      sudahAda: 1,
      nihil: 1,
      gagal: [
        { id: "petakan", label: "PETAKAN", kode: "UNMAPPED_ROLE" },
        { id: "meledak", label: "MELEDAK", kode: "ERROR" },
      ],
    });
    expect(ringkasLogSapuan(r)).toBe("A: 2 diposting, 2 gagal");
  });

  it("cakupan: hanya id yang disebut, dan sumber yang tidak disebut tidak dicari sama sekali", async () => {
    const a = sumberTiruan("A", [dok("a1", "2026-08-02"), dok("a2", "2026-08-03")]);
    const b = sumberTiruan("B", [dok("b1", "2026-08-02")]);
    await jalankanSapuan({
      sumber: [a, b],
      cakupan: { A: ["a2"] },
      tanggalMulai: hari("2026-08-01"),
      sampai: hari("2026-09-01"),
      olehUserId: "u",
    });
    expect(a.diposting).toEqual(["a2"]);
    expect(b.panggilan).toHaveLength(0);
  });
});
