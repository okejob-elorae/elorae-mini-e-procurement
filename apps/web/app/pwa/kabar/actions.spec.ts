import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: sesi dan halaman kotak kabar ditirukan, kursornya asli. Yang dipasak: "Muat lagi"
 * hanya membaca kotak kabar orang yang masuk dan berizin HP, menolak kursor rusak tanpa membaca
 * apa pun, menyusun barisnya di server (tautan HP, waktu WIB), dan tidak pernah melempar.
 */
const { mockAuth, mockHalaman } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockHalaman: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({ prisma: {} }));
vi.mock("@/lib/notifications/page", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/notifications/page")>()),
  fetchNotificationPage: mockHalaman,
}));

import { encodeNotificationCursor } from "@/lib/notifications/page";
import { muatKabarLagi } from "./actions";

const KURSOR = encodeNotificationCursor({ createdAt: new Date("2026-10-30T01:00:00.000Z"), id: "n50" });

const baris = {
  id: "n51",
  type: "AR_OVERDUE",
  title: "Piutang jatuh tempo 7 hari",
  body: "Nota INV/1 di Toko Maju sudah lewat 7 hari dari jatuh tempo.",
  data: { receivableId: "r1", thresholdDays: "7" },
  readAt: null,
  createdAt: new Date("2026-10-29T07:30:00.000Z"),
};

describe("muatKabarLagi", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1", permissions: ["pwa:access"] } });
    mockHalaman.mockReset().mockResolvedValue({ items: [baris], nextCursor: "berikut" });
  });

  it("memuat halaman sesudah kursor dari kotak kabar orang itu sendiri", async () => {
    const hasil = await muatKabarLagi(KURSOR);
    expect(mockHalaman).toHaveBeenCalledWith("u1", { createdAt: new Date("2026-10-30T01:00:00.000Z"), id: "n50" });
    expect(hasil).toMatchObject({ ok: true, kursor: "berikut" });
    if (!hasil.ok) throw new Error("harus berhasil");
    expect(hasil.baris).toHaveLength(1);
    // Jenis tim membuka layar HP-nya, waktunya diformat WIB di server.
    expect(hasil.baris[0]).toMatchObject({ id: "n51", jenis: "AR_OVERDUE", href: "/pwa/collections/r1", dibaca: false, hariIni: false });
    expect(hasil.baris[0].waktu).toContain("14.30");
  });

  it("tanpa sesi: ditolak tanpa membaca apa pun", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await muatKabarLagi(KURSOR)).toEqual({ ok: false });
    expect(mockHalaman).not.toHaveBeenCalled();
  });

  it("akun kantor (admin wildcard) bukan pengguna HP: ditolak", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a1", permissions: ["*"] } });
    expect(await muatKabarLagi(KURSOR)).toEqual({ ok: false });
    expect(mockHalaman).not.toHaveBeenCalled();
  });

  it("kursor rusak atau bukan teks: ditolak tanpa membaca apa pun", async () => {
    expect(await muatKabarLagi("bukan kursor!")).toEqual({ ok: false });
    expect(await muatKabarLagi(42 as unknown as string)).toEqual({ ok: false });
    expect(mockHalaman).not.toHaveBeenCalled();
  });

  it("basis data gagal: { ok: false }, tidak melempar", async () => {
    mockHalaman.mockRejectedValue(new Error("putus"));
    const galat = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await muatKabarLagi(KURSOR)).toEqual({ ok: false });
    galat.mockRestore();
  });
});
