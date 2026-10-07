import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Jurnal terima GRN untuk GRN yang DITOLAK pemilik ditolak server
 * (`DITOLAK_PEMILIK`), bukan hanya disembunyikan layar. Barangnya sudah dibalik
 * dari persediaan; jurnal terimanya memesan hutang untuk barang yang tidak
 * diterima. Tanpa basis data: dokumen GRN dan penulis jurnal ditiru.
 */

const keadaan = vi.hoisted(() => ({ grn: null as { id: string; ownerDeclinedAt: Date | null } | null }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "penguji", permissions: ["journals:manage"] } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const prisma = new Proxy(asli.prisma, {
    get(t, p) {
      if (p === "gRN") return { findUnique: async () => keadaan.grn };
      const v = Reflect.get(t, p);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { ...asli, prisma };
});
vi.mock("@/lib/inventory/grn-journal", () => ({
  postGrnJournal: vi.fn(async () => ({ ok: true, journalId: "j1", created: true })),
  postGrnReversalJournal: vi.fn(async () => ({ ok: true, journalId: "j2", created: true })),
}));
vi.mock("@/lib/finance/jurnal-tertunda", () => ({
  dokumenJurnal: (sourceType: string, id: string) => ({ sourceType, id }),
  tandaiJurnalTertundaSelesai: vi.fn(async () => {}),
}));

const { postGrnReceiptJournalAction } = await import("./grn");
const { postGrnJournal } = await import("@/lib/inventory/grn-journal");

beforeEach(() => {
  vi.mocked(postGrnJournal).mockClear();
});

describe("postGrnReceiptJournalAction — GRN ditolak pemilik", () => {
  it("menolak dengan DITOLAK_PEMILIK dan tidak memposting apa pun", async () => {
    keadaan.grn = { id: "grn-1", ownerDeclinedAt: new Date("2026-10-01T00:00:00Z") };
    expect(await postGrnReceiptJournalAction("grn-1")).toEqual({ ok: false, code: "DITOLAK_PEMILIK" });
    expect(postGrnJournal).not.toHaveBeenCalled();
  });

  it("GRN yang tidak ditolak tetap bisa diposting", async () => {
    keadaan.grn = { id: "grn-2", ownerDeclinedAt: null };
    expect(await postGrnReceiptJournalAction("grn-2")).toMatchObject({ ok: true });
    expect(postGrnJournal).toHaveBeenCalledTimes(1);
  });

  it("GRN yang tidak ada → BAD_STATE", async () => {
    keadaan.grn = null;
    expect(await postGrnReceiptJournalAction("grn-x")).toEqual({ ok: false, code: "BAD_STATE" });
  });
});
