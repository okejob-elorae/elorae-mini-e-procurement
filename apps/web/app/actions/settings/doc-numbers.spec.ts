import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOC_TYPE_GROUP } from "@/lib/doc-numbers/doc-type-groups";

/**
 * Pengaturan → Nomor dokumen (sesi dan Prisma ditiru, tanpa basis data):
 * - layar memuat SEMUA jenis dokumen generator: jenis yang barisnya belum ada
 *   disemai dulu (`createMany` + `skipDuplicates`), baris yang ada tidak disentuh;
 * - simpan menolak dengan kode (tidak melempar) dan tidak menulis apa pun bila
 *   satu baris salah;
 * - izin kelola diperiksa di server.
 */

type Sesi = { user: { id: string; permissions: string[] } } | null;
type Semai = { data: Array<Record<string, unknown>>; skipDuplicates?: boolean };
const keadaan = vi.hoisted(() => ({
  sesi: null as Sesi,
  baris: [] as Array<Record<string, unknown>>,
  upsert: [] as Array<Record<string, unknown>>,
  semai: [] as Semai[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => keadaan.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notifications/actor-name", () => ({ getActorName: vi.fn(async () => "Uji") }));
vi.mock("@/lib/notifications/events", () => ({ notifyDocNumberAltered: vi.fn(async () => {}) }));
vi.mock("@elorae/db", () => ({
  prisma: {
    docNumberConfig: {
      findMany: vi.fn(async () => keadaan.baris),
      /* INSERT IGNORE: hanya jenis yang belum punya baris yang bertambah. */
      createMany: vi.fn(async (args: Semai) => {
        keadaan.semai.push(args);
        const ada = new Set(keadaan.baris.map((b) => b.docType));
        const baru = args.data.filter((b) => !ada.has(b.docType));
        keadaan.baris = [...keadaan.baris, ...baru.map((b) => ({ id: `semai-${String(b.docType)}`, ...b }))];
        return { count: baru.length };
      }),
      upsert: vi.fn((args: Record<string, unknown>) => {
        keadaan.upsert.push(args);
        return args;
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

const { getDocNumberConfigs, simpanNomorDokumenAction } = await import("./doc-numbers");
const SEMUA_JENIS = Object.keys(DOC_TYPE_GROUP).sort();

const KELOLA = ["settings_documents:view", "settings_documents:manage"];

beforeEach(() => {
  keadaan.sesi = { user: { id: "u1", permissions: KELOLA } };
  keadaan.baris = [];
  keadaan.upsert = [];
  keadaan.semai = [];
});

describe("getDocNumberConfigs", () => {
  it("menyemai jenis yang belum punya baris dengan bawaan generator, lalu membaca ulang", async () => {
    keadaan.baris = [
      { id: "c1", docType: "PO", prefix: "PO/", resetPeriod: "YEARLY", padding: 4, lastNumber: 48, year: 2026, month: 10 },
    ];
    const hasil = await getDocNumberConfigs();
    expect(keadaan.semai).toHaveLength(1);
    expect(keadaan.semai[0].skipDuplicates).toBe(true);
    expect(keadaan.semai[0].data.map((b) => b.docType).sort()).toEqual(SEMUA_JENIS);
    expect(hasil.map((b) => b.docType).sort()).toEqual(SEMUA_JENIS);
    // Penghitung baris yang sudah ada tidak disentuh semaian.
    expect(hasil.find((b) => b.docType === "PO")).toMatchObject({ id: "c1", lastNumber: 48 });
    expect(hasil.find((b) => b.docType === "DELIVERY")).toMatchObject({ prefix: "DLV/", resetPeriod: "MONTHLY", lastNumber: 0 });
  });

  it("semua jenis sudah punya baris → tidak menyemai", async () => {
    keadaan.baris = SEMUA_JENIS.map((docType, i) => ({
      id: `c${i}`,
      docType,
      prefix: `${docType}/`,
      resetPeriod: "YEARLY",
      padding: 4,
      lastNumber: 1,
      year: 2026,
      month: 10,
    }));
    const hasil = await getDocNumberConfigs();
    expect(keadaan.semai).toHaveLength(0);
    expect(hasil).toHaveLength(SEMUA_JENIS.length);
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
    expect(await simpanNomorDokumenAction([{ docType: "BUKAN_JENIS" as never, prefix: "BJ/", resetPeriod: "YEARLY", padding: 4 }])).toEqual({
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
