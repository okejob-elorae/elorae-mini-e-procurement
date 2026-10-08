import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Aksi Jubelio yang dipakai halaman Pengaturan/Kategori Jubelio mengembalikan
 * { ok:false, code } — tidak melempar Error berbahasa Inggris ke layar
 * (di produksi Next.js menyamarkannya menjadi pesan umum).
 */

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioPushDefaults: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/internal-api", () => ({
  apiFetch: vi.fn(),
  extractApiMessage: (raw: string | undefined, fallback: string) => raw || fallback,
}));

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { apiFetch } from "@/lib/internal-api";
import { getJubelioTokenState, syncJubelioCatalog } from "./settings/jubelio";
import { getJubelioPushDefaults, saveJubelioPushDefaults } from "./jubelio-push-defaults";
import { fetchJubelioCategoryList } from "./jubelio-categories";
import { deleteJubelioProduct } from "./jubelio-catalog-cleanup";

const ADMIN = { user: { id: "u1", permissions: ["*"] } };

describe("aksi Jubelio mengembalikan kode, bukan melempar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(ADMIN);
  });

  it("apps/api tidak jalan → LAYANAN_MATI, teks teknis hanya di rincian", async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
    );
    await expect(getJubelioTokenState()).resolves.toEqual({
      ok: false,
      code: "LAYANAN_MATI",
      rincian: "fetch failed (ECONNREFUSED)",
    });
    await expect(fetchJubelioCategoryList()).resolves.toMatchObject({ ok: false, code: "LAYANAN_MATI" });
  });

  it("apps/api membalas galat → LAYANAN_MENOLAK", async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, error: "Jubelio timeout" });
    await expect(syncJubelioCatalog({ dryRun: true })).resolves.toEqual({
      ok: false,
      code: "LAYANAN_MENOLAK",
      rincian: "Jubelio timeout",
    });
  });

  it("baris nilai bawaan belum ada → BAWAAN_BELUM_ADA, baik saat memuat maupun menyimpan", async () => {
    (prisma.jubelioPushDefaults.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getJubelioPushDefaults()).resolves.toMatchObject({ ok: false, code: "BAWAAN_BELUM_ADA" });
    const r = await saveJubelioPushDefaults({} as never);
    expect(r).toMatchObject({ ok: false, code: "BAWAAN_BELUM_ADA" });
    expect(prisma.jubelioPushDefaults.update).not.toHaveBeenCalled();
  });

  it("tanpa sesi atau tanpa izin → TANPA_AKSES, tanpa memanggil apps/api", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(getJubelioTokenState()).resolves.toEqual({ ok: false, code: "TANPA_AKSES" });
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: "u2", permissions: ["settings_security:view"] } });
    await expect(deleteJubelioProduct(12)).resolves.toMatchObject({ ok: false, code: "TANPA_AKSES" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("id grup tidak sah → ISIAN_TIDAK_SAH", async () => {
    await expect(deleteJubelioProduct(0)).resolves.toEqual({ ok: false, code: "ISIAN_TIDAK_SAH" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("berhasil → { ok: true, data }", async () => {
    (apiFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      data: { hasToken: true, updatedAt: null, expiresAt: null, expiresInSeconds: 60 },
    });
    await expect(getJubelioTokenState()).resolves.toMatchObject({ ok: true, data: { hasToken: true } });
  });
});
