import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import {
  kunciNomorFaktur,
  markTaxInvoiceCreated,
  NomorFakturError,
  normalisasiNomorFaktur,
  periksaFormatNomorFaktur,
  revertTaxInvoiceToPending,
} from "./writer";
import { TaxInvoiceError } from "./errors";

describe("format nomor seri faktur pajak (murni)", () => {
  it("tanda baca dan spasi diabaikan", () => {
    expect(normalisasiNomorFaktur(" 010.000-24.00000001 ")).toBe("0100002400000001");
    expect(normalisasiNomorFaktur("010 000 24 0000 0001")).toBe("0100002400000001");
    expect(normalisasiNomorFaktur("010/000_24,00000001")).toBe("0100002400000001");
  });

  it("menerima e-Faktur 16 digit, NSFP 13 digit, dan Coretax 17 digit", () => {
    expect(periksaFormatNomorFaktur("010.000-24.00000001")).toBe(true);
    expect(periksaFormatNomorFaktur("000-24.00000001")).toBe(true);
    expect(periksaFormatNomorFaktur("04002500012345678")).toBe(true);
  });

  it("menolak huruf, terlalu pendek, atau terlalu panjang", () => {
    expect(periksaFormatNomorFaktur("FP-2024-001")).toBe(false);
    expect(periksaFormatNomorFaktur("010.000-24.0000000A")).toBe(false);
    expect(periksaFormatNomorFaktur("12345")).toBe(false);
    expect(periksaFormatNomorFaktur("010.000-24.000000001234")).toBe(false);
    expect(periksaFormatNomorFaktur("   ")).toBe(false);
  });

  it("e-Faktur 16 digit: kode transaksi + status tidak membedakan NSFP-nya", () => {
    const k = kunciNomorFaktur("010.000-24.00000001");
    expect(kunciNomorFaktur("011.000-24.00000001")).toBe(k); // faktur pengganti, NSFP sama
    expect(kunciNomorFaktur("070.000-24.00000001")).toBe(k);
    expect(kunciNomorFaktur("000-24.00000001")).toBe(k); // NSFP alokasi tanpa kode transaksi
    expect(kunciNomorFaktur("010.000-24.00000002")).not.toBe(k);
    // Coretax 17 digit dibandingkan utuh.
    expect(kunciNomorFaktur("04002500012345678")).toBe("04002500012345678");
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

/**
 * NSFP yang sama tidak boleh menempel di dua nota. Terhadap basis data
 * sungguhan karena penjaganya hidup di transaksi (termasuk balapan dua klik).
 * Baris TaxInvoice dibuat langsung dengan deliveryId acak: relationMode prisma,
 * tidak ada foreign key, dan writer tidak membaca deliverynya.
 */
d("nomor faktur ganda (test bed only)", () => {
  let token = "";
  let userId = "";
  const ids: string[] = [];

  /** Nomor urut 8 digit acak per tes, tahun 31: tidak bertabrakan dengan data dev. */
  function nomor(urut: number): string {
    return `010.000-31.${token.slice(0, 6)}${String(urut).padStart(2, "0")}`;
  }

  /** NPWP dan nilai tidak diuji di sini; penulis mewajibkannya. */
  function tandai(taxInvoiceId: string, invoiceNo: string) {
    return markTaxInvoiceCreated({
      taxInvoiceId,
      invoiceNo,
      buyerNpwp: "01.234.567.8-901.000",
      taxableAmount: 100_000,
      ppnAmount: 11_000,
      userId,
    });
  }

  async function barisBaru(): Promise<string> {
    const r = await prisma.taxInvoice.create({
      data: { deliveryId: `uji-dlv-${token}-${ids.length}`, status: "PENDING" },
      select: { id: true },
    });
    ids.push(r.id);
    return r.id;
  }

  beforeEach(async () => {
    token = "";
    userId = "";
    ids.length = 0;
    token = `${Math.floor(Math.random() * 1e6)}`.padStart(6, "0") + Math.random().toString(36).slice(2, 6);
    userId = (await prisma.user.create({ data: { email: `nsfp-${token}@uji.local`, name: "Uji NSFP" } })).id;
  });

  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: "TaxInvoice", entityId: { in: seededIds([...ids]) } } });
    await prisma.taxInvoice.deleteMany({ where: { id: { in: seededIds([...ids]) } } });
    await prisma.user.delete({ where: { id: seededId(userId) } });
  });

  it("menolak NSFP yang sudah dipakai nota lain, walau ditulis dengan tanda baca berbeda", async () => {
    const a = await barisBaru();
    const b = await barisBaru();
    const no = nomor(1);
    await tandai(a, no);

    const ditulisLain = no.replace(/[.-]/g, " ");
    const e = await tandai(b, ditulisLain).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NomorFakturError);
    expect(e).toBeInstanceOf(TaxInvoiceError);
    expect((e as NomorFakturError).sebab).toBe("GANDA");
    expect((e as NomorFakturError).code).toBe("INVALID_REQUEST");
    expect((e as NomorFakturError).dipakai?.taxInvoiceId).toBe(a);

    // Faktur pengganti (status 1) dengan NSFP yang sama di nota lain juga ditolak.
    const pengganti = `011${no.slice(3)}`;
    await expect(tandai(b, pengganti)).rejects.toBeInstanceOf(NomorFakturError);

    const rowB = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(b) } });
    expect(rowB.status).toBe("PENDING");
    expect(rowB.invoiceNo).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityType: "TaxInvoice", entityId: seededId(b) } })).toBe(0);
  });

  it("tanda baca yang memotong nomor urut di nota pertama tidak meloloskan nomor yang sama", async () => {
    const a = await barisBaru();
    const b = await barisBaru();
    const no = nomor(3);
    // Nota pertama ditulis dengan titik di tengah 4 digit terakhir nomor urut.
    const dipotong = `${no.slice(0, -2)}.${no.slice(-2)}`;
    await tandai(a, dipotong);

    const e = await tandai(b, no).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NomorFakturError);
    expect((e as NomorFakturError).sebab).toBe("GANDA");
    expect((e as NomorFakturError).dipakai?.taxInvoiceId).toBe(a);
    expect((await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(b) } })).status).toBe("PENDING");
  });

  it("nomor yang dilepas (nota dikembalikan ke PENDING) boleh dipakai nota lain", async () => {
    const a = await barisBaru();
    const b = await barisBaru();
    const no = nomor(2);
    await tandai(a, no);
    await revertTaxInvoiceToPending({ taxInvoiceId: a, reason: "salah nota", userId });
    await tandai(b, no);
    expect((await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(b) } })).status).toBe("CREATED");
  });

  it("menolak format yang bukan NSFP tanpa menyentuh baris", async () => {
    const a = await barisBaru();
    const e = await tandai(a, "FP/2024/001").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NomorFakturError);
    expect((e as NomorFakturError).sebab).toBe("FORMAT");
    expect((await prisma.taxInvoice.findUniqueOrThrow({ where: { id: seededId(a) } })).status).toBe("PENDING");
  });

  it("dua nota diberi NSFP yang sama bersamaan: tepat satu yang tercatat", async () => {
    for (let putaran = 0; putaran < 3; putaran += 1) {
      const a = await barisBaru();
      const b = await barisBaru();
      const no = nomor(5 + putaran);
      const hasil = await Promise.allSettled([
        tandai(a, no),
        tandai(b, no),
      ]);
      const berhasil = hasil.filter((h) => h.status === "fulfilled");
      const ditolak = hasil.filter((h): h is PromiseRejectedResult => h.status === "rejected");
      expect(berhasil).toHaveLength(1);
      expect(ditolak).toHaveLength(1);
      expect(ditolak[0].reason).toBeInstanceOf(NomorFakturError);
      expect(
        await prisma.taxInvoice.count({ where: { id: { in: seededIds([a, b]) }, status: "CREATED" } }),
      ).toBe(1);
    }
  });
});
