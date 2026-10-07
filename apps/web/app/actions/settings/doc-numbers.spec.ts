import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pengaturan → Nomor dokumen (sesi dan Prisma ditiru, tanpa basis data):
 * - layar memuat SEMUA jenis dokumen generator, termasuk yang barisnya belum ada;
 * - simpan menolak dengan kode (tidak melempar) dan tidak menulis apa pun bila
 *   satu baris salah;
 * - izin kelola diperiksa di server.
 */

type Sesi = { user: { id: string; permissions: string[] } } | null;
const keadaan = vi.hoisted(() => ({
  sesi: null as Sesi,
  baris: [] as Array<Record<string, unknown>>,
  upsert: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => keadaan.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(async () => "Uji"),
  notifyDocNumberAltered: vi.fn(async () => {}),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    docNumberConfig: {
      findMany: vi.fn(async () => keadaan.baris),
      upsert: vi.fn((args: Record<string, unknown>) => {
        keadaan.upsert.push(args);
        return args;
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

const { getDocNumberConfigs, simpanNomorDokumenAction } = await import("./doc-numbers");

const KELOLA = ["settings_documents:view", "settings_documents:manage"];

beforeEach(() => {
  keadaan.sesi = { user: { id: "u1", permissions: KELOLA } };
  keadaan.baris = [];
  keadaan.upsert = [];
});

describe("getDocNumberConfigs", () => {
  it("melengkapi jenis yang belum punya baris dengan bawaan generator", async () => {
    keadaan.baris = [
      { id: "c1", docType: "PO", prefix: "PO/", resetPeriod: "YEARLY", padding: 4, lastNumber: 48, year: 2026, month: 10 },
    ];
    const hasil = await getDocNumberConfigs();
    expect(hasil).toHaveLength(15);
    expect(hasil.find((b) => b.docType === "PO")).toMatchObject({ id: "c1", lastNumber: 48 });
    expect(hasil.find((b) => b.docType === "DELIVERY")).toMatchObject({ id: "", prefix: "DLV/", resetPeriod: "MONTHLY", lastNumber: 0 });
  });

  it("tanpa izin lihat ditolak", async () => {
    keadaan.sesi = { user: { id: "u1", permissions: [] } };
    await expect(getDocNumberConfigs()).rejects.toThrow();
  });
});

describe("simpanNomorDokumenAction", () => {
  it("menyimpan semua baris dalam satu transaksi", async () => {
    const r = await simpanNomorDokumenAction([
      { docType: "PO", prefix: " PO/ ", resetPeriod: "YEARLY", padding: 4 },
      { docType: "DELIVERY", prefix: "DLV/", resetPeriod: "MONTHLY", padding: 5 },
    ]);
    expect(r).toEqual({ ok: true, diubah: 2 });
    expect(keadaan.upsert).toHaveLength(2);
    expect(keadaan.upsert[0]).toMatchObject({ where: { docType: "PO" }, update: { prefix: "PO/", padding: 4 } });
  });

  it("satu baris salah → kode galat, tidak ada yang ditulis", async () => {
    const r = await simpanNomorDokumenAction([
      { docType: "PO", prefix: "PO/", resetPeriod: "YEARLY", padding: 4 },
      { docType: "KONSI", prefix: "", resetPeriod: "YEARLY", padding: 4 },
    ]);
    expect(r).toEqual({ ok: false, code: "AWALAN_KOSONG", docType: "KONSI" });
    expect(keadaan.upsert).toHaveLength(0);
  });

  it("jumlah digit dan periode yang tidak sah ditolak", async () => {
    expect(await simpanNomorDokumenAction([{ docType: "PO", prefix: "PO/", resetPeriod: "YEARLY", padding: 9 }])).toMatchObject({
      ok: false,
      code: "DIGIT_TIDAK_SAH",
    });
    expect(
      await simpanNomorDokumenAction([{ docType: "PO", prefix: "PO/", resetPeriod: "DAILY" as never, padding: 4 }]),
    ).toMatchObject({ ok: false, code: "PERIODE_TIDAK_SAH" });
    expect(keadaan.upsert).toHaveLength(0);
  });

  it("jumlah digit berupa teks dari pemanggil lain disimpan sebagai angka", async () => {
    const r = await simpanNomorDokumenAction([{ docType: "PO", prefix: "PO/", resetPeriod: "YEARLY", padding: "5" as never }]);
    expect(r).toEqual({ ok: true, diubah: 1 });
    expect(keadaan.upsert[0]).toMatchObject({ update: { padding: 5 }, create: { padding: 5 } });
  });

  it("jenis asing ditolak", async () => {
    expect(await simpanNomorDokumenAction([{ docType: "BKM" as never, prefix: "BKM/", resetPeriod: "YEARLY", padding: 4 }])).toEqual({
      ok: false,
      code: "JENIS_TIDAK_DIKENAL",
    });
  });

  it("tanpa izin kelola → FORBIDDEN tanpa menulis", async () => {
    keadaan.sesi = { user: { id: "u1", permissions: ["settings_documents:view"] } };
    expect(await simpanNomorDokumenAction([{ docType: "PO", prefix: "PO/", resetPeriod: "YEARLY", padding: 4 }])).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(keadaan.upsert).toHaveLength(0);
  });
});
