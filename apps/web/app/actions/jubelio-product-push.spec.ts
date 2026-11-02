import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/items/jubelio-create-eligibility", () => ({ jubelioCreateEligibility: vi.fn() }));
vi.mock("@/lib/jubelio/harga/pengajuan", () => ({ ajukanKeJubelio: vi.fn() }));
vi.mock("@elorae/db", () => ({ prisma: { jubelioOutbox: { create: vi.fn(), createMany: vi.fn() } } }));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { jubelioCreateEligibility } from "@/lib/items/jubelio-create-eligibility";
import { ajukanKeJubelio } from "@/lib/jubelio/harga/pengajuan";
import { createItemInJubelio } from "./jubelio-product-push";

/*
 * "Ajukan ke Jubelio" di halaman barang hanya mengajukan (keputusan pemilik 2026-11-02): produknya
 * dibuat di Jubelio sesudah harganya dikonfirmasi, jadi tombol ini tidak pernah membuat kiriman.
 */

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "u1", permissions: ["items:edit"] } } as never);
  vi.mocked(jubelioCreateEligibility).mockResolvedValue("eligible");
  vi.mocked(ajukanKeJubelio).mockResolvedValue([{ itemId: "i1", hasil: "DIAJUKAN" }]);
});

describe("createItemInJubelio", () => {
  it.each([
    ["tanpa sesi", null],
    ["tanpa items:edit", { user: { id: "u1", permissions: ["items:view", "jubelio_prices:confirm"] } }],
  ])("%s → forbidden, tidak memeriksa atau mengajukan apa pun", async (_label, sesi) => {
    vi.mocked(auth).mockResolvedValue(sesi as never);
    expect(await createItemInJubelio("i1")).toEqual({ ok: false, reason: "forbidden" });
    expect(jubelioCreateEligibility).not.toHaveBeenCalled();
    expect(ajukanKeJubelio).not.toHaveBeenCalled();
  });

  it("meneruskan alasan barang yang tidak bisa diajukan", async () => {
    vi.mocked(jubelioCreateEligibility).mockResolvedValue("already_requested");
    expect(await createItemInJubelio("i1")).toEqual({ ok: false, reason: "already_requested" });
    expect(ajukanKeJubelio).not.toHaveBeenCalled();
  });

  it("barang yang memenuhi syarat diajukan atas nama pengguna sesi, tanpa kiriman ke Jubelio", async () => {
    expect(await createItemInJubelio("i1")).toEqual({ ok: true });
    expect(ajukanKeJubelio).toHaveBeenCalledWith(["i1"], "u1");
    expect(prisma.jubelioOutbox.create).not.toHaveBeenCalled();
    expect(prisma.jubelioOutbox.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ["SUDAH_DIAJUKAN", "already_requested"],
    ["SEDANG_DIKIRIM", "already_queued"],
    ["SUDAH_DI_JUBELIO", "already_mapped"],
    ["BUKAN_BARANG_JADI_ERP", "not_erp_finished_good"],
    ["TIDAK_DITEMUKAN", "not_found"],
  ] as const)("pengajuan yang kalah balapan (%s) dilaporkan sebagai %s", async (hasil, reason) => {
    vi.mocked(ajukanKeJubelio).mockResolvedValue([{ itemId: "i1", hasil }]);
    expect(await createItemInJubelio("i1")).toEqual({ ok: false, reason });
  });
});
