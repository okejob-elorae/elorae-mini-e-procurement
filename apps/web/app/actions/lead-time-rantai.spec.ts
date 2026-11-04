import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi seret-lepas dan "Centang pemasok…" di Papan Pemasok — pagar izin,
 * pelaku dari sesi, dan penolakan berkode. Tanpa basis data: sesi dan penulis
 * ditiru; yang diperiksa adalah apakah penulis DIPANGGIL dan dengan isian apa.
 */

const keadaan = vi.hoisted(() => ({
  sesi: { user: { id: "u1", permissions: ["*"] as string[] } } as null | { user: { id?: string; permissions?: string[] } },
}));

const tiru = vi.hoisted(() => ({
  writer: {
    MAKS_PEMASOK_MASSAL: 500,
    sisipkanLangkahPemasok: vi.fn(async () => ({ ok: true, id: "sp-baru", sequence: 2 })),
    aturProsesBanyakPemasok: vi.fn(async () => ({ ok: true, ditambah: ["p1"], dilepas: [] })),
  },
  revalidate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => keadaan.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: tiru.revalidate }));
vi.mock("@/lib/leadtime/rantai-pemasok-writer", () => tiru.writer);

const aksi = await import("./lead-time");

const SISIP = { supplierId: "p1", processTemplateId: "t1", celah: 1 };
const MASSAL = { processTemplateId: "t1", tambah: ["p1"], lepas: ["p2"] };

beforeEach(() => {
  keadaan.sesi = { user: { id: "u1", permissions: ["*"] } };
  tiru.writer.sisipkanLangkahPemasok.mockClear();
  tiru.writer.aturProsesBanyakPemasok.mockClear();
  tiru.revalidate.mockClear();
});

describe("aksi rantai pemasok", () => {
  it("tanpa sesi, tanpa id pengguna, atau hanya lead_time:view → TANPA_AKSES, penulis tidak dipanggil", async () => {
    for (const sesi of [null, { user: { permissions: ["*"] } }, { user: { id: "u1", permissions: ["lead_time:view", "production_planning:manage"] } }]) {
      keadaan.sesi = sesi;
      expect(await aksi.sisipkanProsesPemasokAction(SISIP)).toEqual({ ok: false, code: "TANPA_AKSES" });
      expect(await aksi.aturProsesBanyakPemasokAction(MASSAL)).toEqual({ ok: false, code: "TANPA_AKSES" });
    }
    expect(tiru.writer.sisipkanLangkahPemasok).not.toHaveBeenCalled();
    expect(tiru.writer.aturProsesBanyakPemasok).not.toHaveBeenCalled();
    expect(tiru.revalidate).not.toHaveBeenCalled();
  });

  it("dengan lead_time:manage: pelaku dari SESI, olehUserId kiriman klien dibuang", async () => {
    keadaan.sesi = { user: { id: "u1", permissions: ["lead_time:manage"] } };
    expect(await aksi.sisipkanProsesPemasokAction({ ...SISIP, olehUserId: "penyusup" } as never)).toEqual({ ok: true, id: "sp-baru", sequence: 2 });
    expect(tiru.writer.sisipkanLangkahPemasok).toHaveBeenCalledWith({ ...SISIP, olehUserId: "u1" });
    expect(await aksi.aturProsesBanyakPemasokAction({ ...MASSAL, olehUserId: "penyusup" } as never)).toEqual({ ok: true, ditambah: ["p1"], dilepas: [] });
    expect(tiru.writer.aturProsesBanyakPemasok).toHaveBeenCalledWith({ ...MASSAL, olehUserId: "u1" });
    expect(tiru.revalidate).toHaveBeenCalledWith("/backoffice/lead-time");
  });

  it("isian rusak → ISIAN_TIDAK_SAH tanpa memanggil penulis", async () => {
    expect(await aksi.sisipkanProsesPemasokAction({ ...SISIP, celah: -1 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.sisipkanProsesPemasokAction({ ...SISIP, celah: 1.5 })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.sisipkanProsesPemasokAction({ ...SISIP, supplierId: "" })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(await aksi.aturProsesBanyakPemasokAction({ ...MASSAL, tambah: "p1" as never })).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(
      await aksi.aturProsesBanyakPemasokAction({ ...MASSAL, tambah: Array.from({ length: 501 }, (_, i) => `p${i}`) }),
    ).toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(tiru.writer.sisipkanLangkahPemasok).not.toHaveBeenCalled();
    expect(tiru.writer.aturProsesBanyakPemasok).not.toHaveBeenCalled();
  });

  it("penolakan penulis diteruskan tanpa menyegarkan; galat tak terduga menjadi GAGAL dan tidak dilempar", async () => {
    tiru.writer.aturProsesBanyakPemasok.mockResolvedValueOnce({ ok: false, code: "PROSES_TIDAK_ADA" } as never);
    expect(await aksi.aturProsesBanyakPemasokAction(MASSAL)).toEqual({ ok: false, code: "PROSES_TIDAK_ADA" });
    expect(tiru.revalidate).not.toHaveBeenCalled();

    const galat = vi.spyOn(console, "error").mockImplementation(() => {});
    tiru.writer.sisipkanLangkahPemasok.mockRejectedValueOnce(new Error("db putus"));
    expect(await aksi.sisipkanProsesPemasokAction(SISIP)).toEqual({ ok: false, code: "GAGAL" });
    expect(galat).toHaveBeenCalled();
    galat.mockRestore();
  });
});

describe("teks penolakan", () => {
  it("setiap kode penulis rantai punya teks di kedua bahasa (leadTime.server.err<KODE>)", async () => {
    const { KODE_GALAT_RANTAI } = await vi.importActual<typeof import("@/lib/leadtime/rantai-pemasok-writer")>(
      "@/lib/leadtime/rantai-pemasok-writer",
    );
    const id = (await import("@/lib/i18n/messages/id.json")).default as { leadTime: { server: Record<string, string> } };
    const en = (await import("@/lib/i18n/messages/en.json")).default as { leadTime: { server: Record<string, string> } };
    for (const kode of KODE_GALAT_RANTAI) {
      expect(id.leadTime.server[`err${kode}`], kode).toBeTruthy();
      expect(en.leadTime.server[`err${kode}`], kode).toBeTruthy();
    }
  });
});
