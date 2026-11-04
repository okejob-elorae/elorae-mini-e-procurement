import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Lonceng kantor untuk permintaan stok SPG dari toko tanpa pemegang: kategori
 * yang ditulis penulisnya (`mintaKiriman`) harus terdaftar di
 * `CATEGORY_PERMISSION` dengan `stores:manage` — tanpa itu penyebarannya hanya
 * mencetak peringatan dan kabarnya tidak sampai ke siapa pun. Konstantanya diimpor
 * dari penulis, jadi nama kategori yang berubah di satu sisi saja ikut ketahuan.
 */

const { mockGetUsers, mockSend } = vi.hoisted(() => ({
  mockGetUsers: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("./recipients", () => ({
  getUsersWithPermission: mockGetUsers,
  sendNotificationToUsers: mockSend,
}));

const { fanOutAdminNotification } = await import("./admin-fanout");
const { KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG } = await import("@/lib/spg/stok-writer");
const { getNotificationHref } = await import("./navigation");

describe("permintaan stok dari toko tanpa pemegang — penyebaran ke lonceng kantor", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockGetUsers.mockReset();
    mockSend.mockReset();
    mockGetUsers.mockResolvedValue([{ id: "u-kantor", fcmToken: null }]);
    mockSend.mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Penyebaran menolak berjalan di bawah VITEST; `./recipients` di-mock, jadi aman dibuka per kasus.
    vi.stubEnv("VITEST", "");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("reaches the users who manage stores, with the request and store in the data", async () => {
    await fanOutAdminNotification({
      id: "n-1",
      category: KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG,
      title: "Permintaan stok dari toko tanpa pemegang: Toko X",
      message: "SPG meminta 2 barang (3 potong) untuk Toko X.",
      metadata: { requestId: "req-1", storeId: "st-1" },
    });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockGetUsers).toHaveBeenCalledWith("stores:manage");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [penerima, isi] = mockSend.mock.calls[0];
    expect(penerima).toEqual([{ id: "u-kantor", fcmToken: null }]);
    expect(isi).toMatchObject({
      type: KATEGORI_NOTIF_PERMINTAAN_TANPA_PEMEGANG,
      data: { adminNotificationId: "n-1", requestId: "req-1", storeId: "st-1" },
    });
    // Data yang tiba di lonceng membawa ke daftar permintaan yang tersaring.
    expect(getNotificationHref(isi.type, isi.data)).toBe("/backoffice/spg-requests?pemegang=tanpa");
  });
});
