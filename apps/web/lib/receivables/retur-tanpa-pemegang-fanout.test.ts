import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Lonceng kantor untuk nota retur SPG dari toko tanpa pemegang: kategori yang
 * ditulis penulisnya (`catatReturToko`) harus terdaftar di `CATEGORY_PERMISSION`
 * dengan `receivables:manage` — tanpa itu penyebarannya hanya mencetak
 * peringatan dan kabarnya tidak sampai ke siapa pun — dan tautannya harus
 * membawa ke nota itu. Konstantanya diimpor dari penulis, jadi nama kategori
 * yang berubah di satu sisi saja ikut ketahuan.
 */

const { mockGetUsers, mockSend } = vi.hoisted(() => ({
  mockGetUsers: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("@/lib/notifications/recipients", () => ({
  getUsersWithPermission: mockGetUsers,
  sendNotificationToUsers: mockSend,
}));

const { fanOutAdminNotification } = await import("@/lib/notifications/admin-fanout");
const { getNotificationHref } = await import("@/lib/notifications/navigation");
const { KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG } = await import("./return-writer");

describe("nota retur SPG dari toko tanpa pemegang — penyebaran ke lonceng kantor", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetUsers.mockReset();
    mockSend.mockReset();
    mockGetUsers.mockResolvedValue([{ id: "u-piutang", fcmToken: null }]);
    mockSend.mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Penyebaran menolak berjalan di bawah VITEST; `recipients` di-mock, jadi aman dibuka per kasus.
    vi.stubEnv("VITEST", "");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("sampai ke pengelola piutang, dan tautannya membuka nota itu", async () => {
    await fanOutAdminNotification({
      id: "n-1",
      category: KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG,
      title: "Nota retur SPG dari toko tanpa pemegang: Toko X",
      message: "SPG melaporkan nota retur TRK/26/10/0001 (1 barang, 2 potong) di Toko X.",
      metadata: { storeReturnId: "nrt-1", storeId: "st-1", noNrt: "TRK/26/10/0001" },
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockGetUsers).toHaveBeenCalledWith("receivables:manage");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [, isi] = mockSend.mock.calls[0];
    expect(isi).toMatchObject({
      type: KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG,
      data: { adminNotificationId: "n-1", storeReturnId: "nrt-1", storeId: "st-1" },
    });
    expect(getNotificationHref(isi.type, isi.data)).toBe("/backoffice/retur-toko/nrt-1");
  });

  it("tanpa id nota, tautannya ke daftar retur toko", () => {
    expect(getNotificationHref(KATEGORI_NOTIF_RETUR_TANPA_PEMEGANG, null)).toBe("/backoffice/retur-toko");
  });
});
