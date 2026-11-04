import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@elorae/db";
import { formatRupiah } from "@/lib/format/rupiah";
import { formatIDR } from "@/lib/sales-orders/format";
import { rangkaiDalamBatas } from "./antaran";
import { kalimatPotongDanBebanKabar, type BarisBebanDipotongRencana, type RencanaBayarKomisi } from "./koreksi";
import { kalimatBebanRencana } from "./koreksi-writer";

/**
 * Kabar pembayaran SPG menyebut beban retur pembeli yang dipotong dan pengembalian bebannya dengan
 * nomor notanya, sekali saja (P13a/P79). Tanpa basis data: `spgCharge.findMany` ditiru.
 */

type Muatan = { id: string; sourceId: string; sourceDocNo: string; sourceKind: string };

function txPalsu(baris: Muatan[]) {
  const findMany = vi.fn(async () => baris);
  return { tx: { spgCharge: { findMany } } as unknown as Prisma.TransactionClient, findMany };
}

const potong = (m: Partial<BarisBebanDipotongRencana> & { chargeId: string }): BarisBebanDipotongRencana => ({
  storeId: "toko",
  sisaSebelum: 5_000,
  diterapkan: 5_000,
  dariKomisi: 5_000,
  dariGaji: 0,
  dibawa: 0,
  ...m,
});

describe("kalimatBebanRencana", () => {
  it("tanpa beban dan tanpa pengembalian: kosong, tanpa membaca basis data", async () => {
    const { tx, findMany } = txPalsu([]);
    expect(await kalimatBebanRencana(tx, { beban: [], kembaliBeban: [], akhir: false })).toBe("");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("nomor nota dibaca dari bebannya; sisa yang dibawa disebut di pembayaran biasa", async () => {
    const { tx } = txPalsu([{ id: "c1", sourceId: "r1", sourceDocNo: "NRT-4471", sourceKind: "PUTUS" }]);
    const teks = await kalimatBebanRencana(tx, { beban: [potong({ chargeId: "c1", sisaSebelum: 8_000, diterapkan: 5_000, dibawa: 3_000 })], kembaliBeban: [], akhir: false });
    expect(teks).toBe(
      `Dipotong beban retur pembeli ditolak (nota NRT-4471) ${formatRupiah(5_000)}. Sisa beban ${formatRupiah(3_000)} dipotong di pembayaran berikutnya.`,
    );
  });

  it("pembayaran terakhir: sisa yang tidak terpotong menjadi utang SPG, bukan 'dipotong di pembayaran berikutnya'", async () => {
    const { tx } = txPalsu([{ id: "c1", sourceId: "r1", sourceDocNo: "NRT-4471", sourceKind: "KONSI" }]);
    const teks = await kalimatBebanRencana(tx, { beban: [potong({ chargeId: "c1", sisaSebelum: 8_000, diterapkan: 5_000, dibawa: 3_000 })], kembaliBeban: [], akhir: true });
    expect(teks).toBe(`Dipotong beban retur pembeli ditolak (nota NRT-4471) ${formatRupiah(5_000)}.`);
  });

  it("pengembalian beban disebut dengan notanya; beban yang barisnya tidak ditemukan tidak disebut", async () => {
    const { tx } = txPalsu([{ id: "c2", sourceId: "r2", sourceDocNo: "NRT-5000", sourceKind: "PUTUS" }]);
    const teks = await kalimatBebanRencana(tx, {
      beban: [potong({ chargeId: "hilang" })],
      kembaliBeban: [{ chargeId: "c2", storeId: "toko", jumlah: 2_500 }],
      akhir: false,
    });
    expect(teks).toBe(`Pengembalian beban (nota NRT-5000) ${formatRupiah(2_500)}.`);
  });
});

describe("kalimatPotongDanBebanKabar", () => {
  const rencana = (m: Partial<Pick<RencanaBayarKomisi, "potonganHilang" | "potonganRetur" | "potonganUtang" | "dariGaji" | "beban">>) => ({
    potonganHilang: 0,
    potonganRetur: 0,
    potonganUtang: 0,
    dariGaji: 0,
    beban: [] as BarisBebanDipotongRencana[],
    ...m,
  });
  const kalimatBeban = `Dipotong beban retur pembeli ditolak (nota NRT-4471) ${formatRupiah(5_000)}.`;

  it("beban retur yang disebut dengan notanya tidak diulang di kalimat potong umum; kalimat umum yang lengkap jadi pilihan kedua", () => {
    const r = rencana({ potonganHilang: 1_000, potonganRetur: 5_000, beban: [potong({ chargeId: "c1" })] });
    expect(kalimatPotongDanBebanKabar(r, kalimatBeban)).toEqual([
      [`Dipotong beban barang hilang ${formatIDR(1_000)}. ${kalimatBeban}`, `Dipotong beban barang hilang ${formatIDR(1_000)}, beban retur pembeli ${formatIDR(5_000)}.`],
    ]);
  });

  it("hanya beban retur: satu kalimat saja, yang bernota — atau kalimat umum kalau tidak muat", () => {
    const r = rencana({ potonganRetur: 5_000, beban: [potong({ chargeId: "c1" })] });
    expect(kalimatPotongDanBebanKabar(r, kalimatBeban)).toEqual([[kalimatBeban, `Dipotong beban retur pembeli ${formatIDR(5_000)}.`]]);
  });

  describe("di kolom kabar 191 karakter (`rangkaiDalamBatas`, seperti kedua penulis bayar)", () => {
    const BATAS = 191;
    const kepala = (namaToko: string) =>
      `${namaToko}: diterima ${formatIDR(1_245_000)} (gaji pokok ${formatIDR(1_000_000)} + komisi ${formatIDR(250_000)}).`;
    const sebagian = `Dipotong beban retur pembeli ditolak (nota NRT-4471) ${formatRupiah(5_000)}. Sisa beban ${formatRupiah(3_000)} dipotong di pembayaran berikutnya.`;
    const panjang = (t: string) => Array.from(t).length;

    it("potongan sebagian dengan nama toko panjang: gabungannya tidak muat, kabarnya tetap menyebut beban retur yang dipotong", () => {
      const nama = "Toko Sinar Jaya Abadi Makmur Sentosa Cabang Pasar Baru Bandung";
      const r = rencana({ potonganRetur: 5_000, beban: [potong({ chargeId: "c1", sisaSebelum: 8_000, dibawa: 3_000 })] });
      expect(panjang(`${kepala(nama)} ${sebagian}`)).toBeGreaterThan(BATAS);
      const isi = rangkaiDalamBatas([kepala(nama), ...kalimatPotongDanBebanKabar(r, sebagian)], BATAS);
      expect(isi).toBe(`${kepala(nama)} Dipotong beban retur pembeli ${formatIDR(5_000)}.`);
      expect(panjang(isi)).toBeLessThanOrEqual(BATAS);
    });

    it("nama toko pendek pun bisa tidak muat; kalimat umum menyebut juga bagian dari gaji pokok", () => {
      const r = rencana({ potonganRetur: 5_000, dariGaji: 2_000, beban: [potong({ chargeId: "c1", sisaSebelum: 8_000, dariKomisi: 3_000, dariGaji: 2_000, dibawa: 3_000 })] });
      expect(panjang(`${kepala("Toko A")} ${sebagian}`)).toBeGreaterThan(BATAS);
      expect(rangkaiDalamBatas([kepala("Toko A"), ...kalimatPotongDanBebanKabar(r, sebagian)], BATAS)).toBe(
        `${kepala("Toko A")} Dipotong beban retur pembeli ${formatIDR(5_000)} (sebagian dari gaji pokok ${formatIDR(2_000)}).`,
      );
    });

    it("yang muat tetap kalimat bernota, tanpa kalimat umum", () => {
      const r = rencana({ potonganRetur: 5_000, beban: [potong({ chargeId: "c1" })] });
      expect(rangkaiDalamBatas([kepala("Toko A"), ...kalimatPotongDanBebanKabar(r, kalimatBeban)], BATAS)).toBe(`${kepala("Toko A")} ${kalimatBeban}`);
    });
  });

  it("tanpa kalimat bernota (bebannya tidak ditemukan), beban retur tetap disebut di kalimat umum", () => {
    const r = rencana({ potonganRetur: 5_000, potonganUtang: 2_000, beban: [potong({ chargeId: "c1" })] });
    expect(kalimatPotongDanBebanKabar(r, "")).toEqual([`Dipotong beban retur pembeli ${formatIDR(5_000)}, utang ${formatIDR(2_000)}.`]);
  });

  it("kalimat bernota yang hanya menyebut pengembalian tidak membuang beban retur yang dipotong", () => {
    const kembali = `Pengembalian beban (nota NRT-5000) ${formatRupiah(2_500)}.`;
    const r = rencana({ potonganRetur: 5_000 });
    expect(kalimatPotongDanBebanKabar(r, kembali)).toEqual([`Dipotong beban retur pembeli ${formatIDR(5_000)}.`, kembali]);
  });
});
