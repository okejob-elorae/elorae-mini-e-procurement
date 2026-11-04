import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, seededId } from "@elorae/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";
import { POST as tandaiSemua } from "./read-all/route";

/*
 * Basis data sungguhan: membuktikan kursor (createdAt, id) di SQL — bukan di
 * tiruan — membawa setiap baris tepat sekali, termasuk seri milidetik yang
 * sama tepat di batas halaman, dan "Tandai semua dibaca" mengenai baris di
 * luar 50 yang termuat. Satu pengguna uji; semua baris dihapus lewat id-nya.
 */

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;
const tag = `uji-lonceng-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let userId = "";
let lainId = "";
const JUMLAH = 55;
const DIBACA = 7;

beforeAll(async () => {
  userId = "";
  lainId = "";
  userId = (await prisma.user.create({ data: { email: `${tag}@uji.local`, name: tag } })).id;
  lainId = (await prisma.user.create({ data: { email: `${tag}-lain@uji.local`, name: `${tag} lain` } })).id;
  const t0 = Date.UTC(2026, 9, 6, 3, 0, 0);
  await prisma.notificationQueue.createMany({
    data: Array.from({ length: JUMLAH }, (_, i) => ({
      userId,
      type: "TEST",
      title: `${tag} ${i}`,
      body: "isi",
      // Baris 47–52 ditulis pada milidetik yang sama: batas halaman (50) jatuh di tengah serinya.
      createdAt: new Date(i >= 47 && i <= 52 ? t0 - 47_000 : t0 - i * 1000),
      readAt: i < DIBACA ? new Date(t0) : null,
    })),
  });
  // Milik orang lain: tidak boleh ikut terbaca, terhitung, atau tertandai.
  await prisma.notificationQueue.create({
    data: { userId: lainId, type: "TEST", title: `${tag} lain`, body: "isi", createdAt: new Date(t0) },
  });
});

afterAll(async () => {
  for (const id of [userId, lainId]) {
    if (!id) continue;
    await prisma.notificationQueue.deleteMany({ where: { userId: seededId(id) } });
    await prisma.user.delete({ where: { id: seededId(id) } });
  }
});

async function ambil(cursor: string | null) {
  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await GET(new Request(`http://localhost/api/notifications${qs}`));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    items: { id: string; createdAt: string }[];
    unreadCount: number;
    nextCursor: string | null;
  };
}

describe("lonceng dengan basis data", () => {
  it("menggulir sampai habis memuat setiap notifikasi tepat sekali, dengan urutan yang sama seperti basis data", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId } });
    const harapan = await prisma.notificationQueue.findMany({
      where: { userId: seededId(userId) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });

    const termuat: string[] = [];
    const halaman: number[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const json = await ambil(cursor);
      termuat.push(...json.items.map((x) => x.id));
      halaman.push(json.items.length);
      expect(json.unreadCount).toBe(JUMLAH - DIBACA);
      cursor = json.nextCursor;
      if (!cursor) break;
    }

    expect(halaman).toEqual([50, 5]);
    expect(new Set(termuat).size).toBe(JUMLAH);
    expect(termuat).toEqual(harapan.map((x) => x.id));
  });

  it("Tandai semua dibaca mengenai SEMUA milik pengguna, termasuk di luar 50 yang termuat, dan bukan milik orang lain", async () => {
    mockAuth.mockResolvedValue({ user: { id: userId } });
    const res = await tandaiSemua();
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(JUMLAH - DIBACA);

    expect(await prisma.notificationQueue.count({ where: { userId: seededId(userId), readAt: null } })).toBe(0);
    expect(await prisma.notificationQueue.count({ where: { userId: seededId(lainId), readAt: null } })).toBe(1);
    expect((await ambil(null)).unreadCount).toBe(0);
  });
});
