import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

/**
 * Tolak vs setujui usulan toko bersamaan. Setujui sudah serializable, tolak
 * dulu tidak: `updateMany where status PENDING` di Prisma 7 bukan
 * compare-and-swap, jadi tolak bisa menimpa usulan yang baru saja DISETUJUI —
 * toko terdaftar, usulan berstatus DITOLAK, salesman diberi kabar ditolak.
 * Terhadap basis data sungguhan; kabar ke salesman dipalsukan.
 */

vi.mock("@/lib/notifications/kabar-pengguna", async (asli) => {
  const modul = await asli<typeof import("@/lib/notifications/kabar-pengguna")>();
  return { ...modul, kabariPengguna: vi.fn(async () => {}) };
});

const { ajukanUsulanToko, setujuiUsulanToko, tolakUsulanToko } = await import("./usulan-writer");

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

// Tengah Samudra Pasifik: tidak ada toko sungguhan di dekatnya.
const TITIK = { lat: -45.2234567, lng: -121.4567891 };

d("usulan toko — tolak vs setujui bersamaan (test bed only)", () => {
  let token = "";
  let pengusulId = "";
  let adminA = "";
  let adminB = "";
  const usulanIds: string[] = [];

  /** Token untuk saringan teardown — tidak pernah kosong, karena "memuat ''" cocok dengan semuanya. */
  function tokenUji(): string {
    if (token.length < 6) throw new Error("token uji belum diisi");
    return token;
  }

  beforeEach(async () => {
    token = "";
    pengusulId = "";
    adminA = "";
    adminB = "";
    usulanIds.length = 0;
    token = Math.random().toString(36).slice(2, 10).toUpperCase();
    const buat = async (peran: string) =>
      (await prisma.user.create({ data: { email: `${peran}-${token}@uji.local`, name: `${peran} ${token}` }, select: { id: true } })).id;
    pengusulId = await buat("usul-balap");
    adminA = await buat("admin-a-balap");
    adminB = await buat("admin-b-balap");
  });

  afterEach(async () => {
    const semua = await prisma.storeProposal.findMany({
      where: { proposedById: seededId(pengusulId) },
      select: { id: true, storeId: true },
    });
    const ids = [...new Set([...usulanIds, ...semua.map((u) => u.id)])];
    const toko = semua.map((u) => u.storeId).filter((s): s is string => !!s);
    await prisma.auditLog.deleteMany({ where: { entityId: { in: seededIds([...ids, ...toko]) } } });
    await prisma.storeProposal.deleteMany({ where: { id: { in: seededIds(ids) } } });
    await prisma.store.deleteMany({ where: { id: { in: seededIds(toko) } } });
    if (token.length >= 6) {
      await prisma.adminNotification.deleteMany({ where: { category: "STORE_PROPOSAL", title: { contains: tokenUji() } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [seededId(pengusulId), seededId(adminA), seededId(adminB)] } } });
  });

  async function usulanBaru(putaran: number): Promise<string> {
    const h = await ajukanUsulanToko({
      userId: pengusulId,
      masukan: {
        name: `Toko Balap ${token} ${putaran}`,
        address: "Jl. Uji 2",
        phone: "0812 3456 7891",
        photoUrl: "/api/foto/uji",
        lat: TITIK.lat + putaran * 0.01,
        lng: TITIK.lng,
      },
      idempotencyKey: `balap-${token}-${putaran}`,
      tetapAjukan: true,
    });
    if (!h.ok) throw new Error(`gagal mengajukan: ${h.code}`);
    usulanIds.push(h.id);
    return h.id;
  }

  function setuju(proposalId: string, putaran: number) {
    return setujuiUsulanToko({
      proposalId,
      reviewerId: adminA,
      masukan: {
        code: `UJB-${token}-${putaran}`,
        termsType: "PUTUS",
        groupId: null,
        salesmanId: null,
        paymentTempo: 30,
        isPkp: true,
        markupPercent: null,
        name: `Toko Balap ${token} ${putaran}`,
        address: "Jl. Uji 2",
        phone: "0812 3456 7891",
      },
    });
  }

  it("tepat satu keputusan menang; usulan yang disetujui tidak pernah berakhir DITOLAK", async () => {
    for (let putaran = 0; putaran < 4; putaran += 1) {
      const id = await usulanBaru(putaran);
      const [s, t] = await Promise.all([
        setuju(id, putaran),
        tolakUsulanToko({ proposalId: id, reviewerId: adminB, alasan: "lokasi tidak jelas" }),
      ]);

      expect([s.ok, t.ok].filter(Boolean)).toHaveLength(1);
      const kalah = s.ok ? t : s;
      expect(kalah).toEqual({ ok: false, code: "SUDAH_DIPUTUSKAN" });

      const baris = await prisma.storeProposal.findUniqueOrThrow({ where: { id: seededId(id) } });
      const toko = await prisma.store.count({ where: { code: `UJB-${token}-${putaran}` } });
      if (s.ok) {
        expect(baris.status).toBe("APPROVED");
        expect(baris.reviewNote).toBeNull();
        expect(toko).toBe(1);
      } else {
        expect(baris.status).toBe("REJECTED");
        expect(toko).toBe(0);
      }
      // Satu jejak keputusan pada usulan (setuju menulis satu, tolak menulis satu).
      const jejak = await prisma.auditLog.count({ where: { entityType: "StoreProposal", entityId: seededId(id) } });
      expect(jejak).toBe(1);
    }
  });

  it("dua penolakan bersamaan: satu jejak penolakan", async () => {
    for (let putaran = 10; putaran < 13; putaran += 1) {
      const id = await usulanBaru(putaran);
      const hasil = await Promise.all([
        tolakUsulanToko({ proposalId: id, reviewerId: adminA, alasan: "alasan A" }),
        tolakUsulanToko({ proposalId: id, reviewerId: adminB, alasan: "alasan B" }),
      ]);
      expect(hasil.filter((h) => h.ok)).toHaveLength(1);
      expect(hasil.filter((h) => !h.ok)).toEqual([{ ok: false, code: "SUDAH_DIPUTUSKAN" }]);
      const jejak = await prisma.auditLog.findMany({ where: { entityType: "StoreProposal", entityId: seededId(id) } });
      expect(jejak).toHaveLength(1);
      expect((await prisma.storeProposal.findUniqueOrThrow({ where: { id: seededId(id) } })).reviewNote).toBe(jejak[0].reason);
    }
  });
});
