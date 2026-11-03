import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * `buatKlaimAction` untuk tagihan konsinyasi, terhadap basis data sungguhan.
 *
 * Jawaban pemilik 2026-11-02, P31 ("pemegang toko"): nominal tagihan konsi hanya
 * untuk salesman pemegang toko SEKARANG — maka hanya dia yang boleh melaporkan
 * BKM-nya dari HP. Penjagaannya di server (`pelaporBolehMelaporkan`), dan
 * BERLAKU walau kunci "hanya toko sendiri" mati — kunci itu bawaannya mati,
 * dan tanpa penjaga ini penjual lama atau sales mana pun bisa melaporkan uang
 * atas tagihan konsi yang bukan tagihannya. Kantor (`receivables:manage`)
 * tidak melewati pemeriksaan itu, sama seperti untuk faktur putus.
 *
 * Yang ditiru hanya sesi, peran SPG, dan kunci toko — penulis BKM, kueri
 * piutang, dan penjaganya berjalan sungguhan. Pengaturan bersama tidak
 * disentuh. Teardown lewat `seededId()`; BKM dihapus sebelum piutangnya.
 */

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pwa/peran")>()),
  ambilTokoTetap: vi.fn(async () => null),
}));
// Kunci "hanya toko sendiri" MATI — penjaga P31 tidak boleh bergantung padanya.
vi.mock("@/lib/salesman/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/salesman/queries")>()),
  tokoTerkunci: vi.fn(async () => false),
}));
/* Tidak ada kabar atau lonceng yang boleh sampai ke bed bersama. */
vi.mock("@/lib/notifications/kabar-pengguna", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/kabar-pengguna")>()),
  kabariPengguna: vi.fn(async () => {}),
}));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => {}) }));

const { buatKlaimAction } = await import("./receivables");

const tag = `KKS-${Math.random().toString(36).slice(2, 8)}`;
let pemegangId = "";
let salesLainId = "";
let kantorId = "";
let tokoId = "";
let piutangId = "";

beforeEach(async () => {
  pemegangId = "";
  salesLainId = "";
  kantorId = "";
  tokoId = "";
  piutangId = "";
  state.sesi = null;

  pemegangId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-a@uji.test`, name: `${tag} pemegang` } })).id;
  salesLainId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-b@uji.test`, name: `${tag} lain` } })).id;
  kantorId = (await prisma.user.create({ data: { email: `${tag.toLowerCase()}-k@uji.test`, name: `${tag} kantor` } })).id;
  tokoId = (
    await prisma.store.create({
      data: { code: tag, name: `${tag} Konsi`, address: "uji", termsType: "KONSI", salesmanId: pemegangId, paymentTempo: 30 },
    })
  ).id;
  // Utang konsi dari kertas (P32): penjualnya tercatat sales LAIN — penjual tidak
  // pernah membuka hak melapor tagihan konsi, hanya pemegang toko yang bisa.
  piutangId = (
    await prisma.receivable.create({
      data: {
        invoiceNo: `${tag}/KNS`,
        storeId: tokoId,
        salesmanId: salesLainId,
        isConsignment: true,
        source: "MANUAL",
        invoiceDate: new Date("2091-03-31T00:00:00+07:00"),
        dueDate: new Date("2091-04-30T00:00:00+07:00"),
        amount: 1_500_000,
        outstanding: 1_500_000,
        originalAmount: 1_500_000,
        outstandingAmount: 1_500_000,
      },
    })
  ).id;
});

afterEach(async () => {
  const klaim = tokoId
    ? await prisma.paymentClaim.findMany({ where: { storeId: seededId(tokoId) }, select: { id: true } })
    : [];
  const klaimIds = klaim.map((k) => k.id);
  if (klaimIds.length) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds(klaimIds) } } });
    // Tautan klaim–piutang ikut terhapus (onDelete Cascade).
    await prisma.paymentClaim.deleteMany({ where: { id: { in: seededIds(klaimIds) } } });
  }
  if (piutangId) await prisma.receivable.delete({ where: { id: seededId(piutangId) } });
  if (tokoId) await prisma.store.delete({ where: { id: seededId(tokoId) } });
  const orang = [pemegangId, salesLainId, kantorId].filter(Boolean);
  if (orang.length) await prisma.user.deleteMany({ where: { id: { in: seededIds(orang) } } });
});

const lapor = () =>
  buatKlaimAction({
    storeId: tokoId,
    claimedTransferAt: "2091-04-25",
    method: "transfer",
    pelunasan: [{ receivableId: piutangId, nilai: 1_500_000 }],
    transferPhotoUrl: "/api/foto/uji",
  });

const jumlahBkm = () => prisma.paymentClaim.count({ where: { storeId: seededId(tokoId) } });

describe("buatKlaimAction — tagihan konsinyasi hanya dilaporkan pemegang toko (P31)", () => {
  it("pemegang toko melaporkan BKM-nya: tercatat DIKIRIM, piutangnya belum berkurang (Aturan 1)", async () => {
    state.sesi = { user: { id: pemegangId, permissions: ["pwa:access"] } };
    const hasil = await lapor();
    expect(hasil.ok).toBe(true);
    const bkm = await prisma.paymentClaim.findFirstOrThrow({
      where: { storeId: seededId(tokoId) },
      select: { status: true, salesmanId: true },
    });
    expect(bkm).toEqual({ status: "DIKIRIM", salesmanId: pemegangId });
    const p = await prisma.receivable.findUniqueOrThrow({ where: { id: seededId(piutangId) }, select: { status: true } });
    expect(p.status).not.toBe("PAID");
  });

  it("sales yang bukan pemegang — termasuk penjual faktur itu — ditolak TOKO_TIDAK_DIIZINKAN walau kunci mati", async () => {
    state.sesi = { user: { id: salesLainId, permissions: ["pwa:access"] } };
    expect(await lapor()).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(await jumlahBkm()).toBe(0);
  });

  it("begitu toko dirotasi, pemegang lama ditolak dan pemegang baru boleh", async () => {
    await prisma.store.update({ where: { id: seededId(tokoId) }, data: { salesmanId: salesLainId } });
    state.sesi = { user: { id: pemegangId, permissions: ["pwa:access"] } };
    expect(await lapor()).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(await jumlahBkm()).toBe(0);
    state.sesi = { user: { id: salesLainId, permissions: ["pwa:access"] } };
    expect((await lapor()).ok).toBe(true);
    expect(await jumlahBkm()).toBe(1);
  });

  it("kantor (receivables:manage) boleh mencatat BKM tagihan konsi", async () => {
    state.sesi = { user: { id: kantorId, permissions: ["receivables:manage"] } };
    expect((await lapor()).ok).toBe(true);
    expect(await jumlahBkm()).toBe(1);
  });
});
