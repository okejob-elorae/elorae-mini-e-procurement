import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockRevalidate, mockAtur } = vi.hoisted(() => ({ mockAuth: vi.fn(), mockRevalidate: vi.fn(), mockAtur: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));
vi.mock("@/lib/spg/member-writer", () => ({ aturAktifMember: mockAtur }));

import { aturAktifMemberAction } from "./spg-member-kantor";

describe("aturAktifMemberAction", () => {
  beforeEach(() => {
    for (const m of [mockAuth, mockRevalidate, mockAtur]) m.mockReset();
  });

  it("needs a session and promos:manage — viewing the page (spg_sales:view) is not enough", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await aturAktifMemberAction({ memberId: "m1", aktif: false, alasan: "x" })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["spg_sales:view"] } });
    expect(await aturAktifMemberAction({ memberId: "m1", aktif: false, alasan: "x" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mockAtur).not.toHaveBeenCalled();
  });

  it("takes the actor from the session, never from the caller", async () => {
    mockAuth.mockResolvedValue({ user: { id: "kantor-1", permissions: ["promos:manage"] } });
    mockAtur.mockResolvedValue({ ok: true, berubah: true });
    const isi = { memberId: "m1", aktif: false, alasan: "nomor dipakai orang lain", userId: "palsu" } as never;
    expect(await aturAktifMemberAction(isi)).toEqual({ ok: true, berubah: true });
    expect(mockAtur).toHaveBeenCalledWith({ memberId: "m1", aktif: false, alasan: "nomor dipakai orang lain", userId: "kantor-1" });
    expect(mockRevalidate).toHaveBeenCalledWith("/backoffice/spg-pelanggan");
  });

  it("passes the writer's refusal through, and turns a crash into a code", async () => {
    mockAuth.mockResolvedValue({ user: { id: "kantor-1", permissions: ["promos:manage"] } });
    mockAtur.mockResolvedValue({ ok: false, code: "ALASAN_WAJIB" });
    expect(await aturAktifMemberAction({ memberId: "m1", aktif: false, alasan: "" })).toEqual({ ok: false, code: "ALASAN_WAJIB" });
    expect(mockRevalidate).not.toHaveBeenCalled();
    mockAtur.mockRejectedValue(new Error("db"));
    const diam = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await aturAktifMemberAction({ memberId: "m1", aktif: true })).toEqual({ ok: false, code: "GAGAL" });
    diam.mockRestore();
    expect(await aturAktifMemberAction({ memberId: 5, aktif: true } as never)).toEqual({ ok: false, code: "TIDAK_ADA" });
  });
});
