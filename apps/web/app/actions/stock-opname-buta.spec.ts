import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededIds, type OpnameStatus } from "@elorae/db";

/*
 * Opname gudang dihitung buta — terhadap basis data uji, sesi ditiru.
 *
 * Yang dibuktikan di MUATAN aksi (yang terbaca di devtools), bukan hanya di
 * layar: selama CREATED/COUNTING angka sistem tidak dikirim ke siapa pun,
 * termasuk admin; sesudah dikirim hanya pemegang approve yang menerimanya;
 * sesudah disetujui semua yang boleh melihat. Dan hitungan tidak bisa diubah
 * lagi sesudah dikirim — pada saat itu angka sistem sudah terlihat.
 *
 * Opname dibuat langsung (tanpa snapshot stok sungguhan); teardown hanya
 * lewat id yang diseed. Angka snapshot sengaja unik (4937 / 88.5) supaya
 * pencarian di teks muatan tidak salah kena.
 */

const sesi = vi.hoisted(() => ({ id: "penguji-opname-buta", permissions: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: sesi.id, email: null, permissions: sesi.permissions } })),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Bacaan status di luar transaksi bisa basi: `tiruan.statusBasi` membuat SATU
// panggilan `stockOpname.findUnique` berikutnya mengembalikan status itu,
// sementara basis data sudah berubah. Klien lainnya asli.
const tiruan = vi.hoisted(() => ({ statusBasi: null as string | null }));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const prisma = new Proxy(asli.prisma, {
    get(_t, prop) {
      if (prop === "stockOpname" && tiruan.statusBasi) {
        const delegasi = asli.prisma.stockOpname;
        return new Proxy(delegasi, {
          get(_d, dp) {
            const status = tiruan.statusBasi;
            if (dp === "findUnique" && status) {
              return async (args: Parameters<typeof delegasi.findUnique>[0]) => {
                tiruan.statusBasi = null;
                const row = await delegasi.findUnique(args);
                return row ? { ...row, status } : row;
              };
            }
            const v = (delegasi as unknown as Record<PropertyKey, unknown>)[dp];
            return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(delegasi) : v;
          },
        });
      }
      return (asli.prisma as unknown as Record<PropertyKey, unknown>)[prop];
    },
  });
  return { ...asli, prisma };
});

const { getOpnameById, submitOpname, updateOpnameCounts, updateOpnameRollCounts } = await import("./stock-opname");

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;
const tag = `OPBT-${Math.random().toString(36).slice(2, 9)}`;

const PENGHITUNG = ["inventory_opname:view", "inventory_opname:count"];
const PENYETUJU = ["inventory_opname:view", "inventory_opname:approve"];

d("opname gudang buta (test bed only)", () => {
  const dibuat: string[] = [];
  let ke = 0;

  beforeEach(() => {
    dibuat.length = 0;
    sesi.permissions = [];
  });

  afterEach(async () => {
    await prisma.stockOpname.deleteMany({ where: { id: { in: seededIds([...dibuat]) } } });
  });

  async function opnameBarang(status: OpnameStatus) {
    const o = await prisma.stockOpname.create({
      data: {
        docNumber: `${tag}-${ke++}`,
        scope: "FINISHED_GOOD",
        status,
        snapshotAt: new Date(),
        createdById: sesi.id,
        items: {
          create: [
            {
              itemId: `${tag}-kaos`,
              variantSku: "KAOS-M",
              itemName: "Kaos Buta",
              snapshotQty: 4937,
              countedQty: status === "CREATED" ? null : 12,
              variance: status === "CREATED" ? null : -4925,
              currentQtyAtApproval: status === "APPROVED" ? 4930 : null,
            },
          ],
        },
      },
      select: { id: true, items: { select: { id: true } } },
    });
    dibuat.push(o.id);
    return { id: o.id, barisId: o.items[0].id };
  }

  async function opnameKain(status: OpnameStatus) {
    const o = await prisma.stockOpname.create({
      data: {
        docNumber: `${tag}-${ke++}`,
        scope: "FABRIC",
        status,
        snapshotAt: new Date(),
        createdById: sesi.id,
        rolls: { create: [{ fabricRollId: `${tag}-rol`, rollCode: `${tag}-RL`, itemName: "Katun Buta", snapshotLength: 88.5 }] },
      },
      select: { id: true, rolls: { select: { id: true } } },
    });
    dibuat.push(o.id);
    return { id: o.id, rolId: o.rolls[0].id };
  }

  const muatan = async (id: string) => {
    const o = await getOpnameById(id);
    if (!o) throw new Error("opname tidak ditemukan");
    return { o, teks: JSON.stringify(o) };
  };

  it("sends no system figure to anyone while counting — not even the admin wildcard", async () => {
    for (const izin of [PENGHITUNG, PENYETUJU, ["*"]]) {
      sesi.permissions = izin;
      for (const status of ["CREATED", "COUNTING"] as const) {
        const { id } = await opnameBarang(status);
        const { o, teks } = await muatan(id);
        expect(o.angkaSistemTampil).toBe(false);
        expect(teks).not.toContain("snapshotQty");
        expect(teks).not.toContain("variance");
        expect(teks).not.toContain("4937");
        expect(teks).not.toContain("4925");
        // Yang diketik penghitung tetap ada.
        expect(o.items).toEqual([expect.objectContaining({ itemName: "Kaos Buta", countedQty: status === "CREATED" ? null : 12 })]);
      }
    }
  });

  it("hides the frozen roll length while a fabric count is open", async () => {
    sesi.permissions = ["*"];
    const { id } = await opnameKain("COUNTING");
    const { o, teks } = await muatan(id);
    expect(o.angkaSistemTampil).toBe(false);
    expect(teks).not.toContain("snapshotLength");
    expect(teks).not.toContain("88.5");
    expect(o.rolls).toEqual([expect.objectContaining({ rollCode: `${tag}-RL`, countedLength: null })]);
  });

  it("once submitted, shows the figures to whoever may approve — and still not to a counter", async () => {
    const { id } = await opnameBarang("SUBMITTED");

    sesi.permissions = PENYETUJU;
    const setuju = await muatan(id);
    expect(setuju.o.angkaSistemTampil).toBe(true);
    expect(setuju.o.items).toEqual([expect.objectContaining({ snapshotQty: 4937, countedQty: 12, variance: -4925 })]);

    sesi.permissions = PENGHITUNG;
    const hitung = await muatan(id);
    expect(hitung.o.angkaSistemTampil).toBe(false);
    expect(hitung.teks).not.toContain("4937");
  });

  it("shows the figures to every viewer once approved; a cancelled count only to approvers", async () => {
    sesi.permissions = PENGHITUNG;
    const disetujui = await opnameBarang("APPROVED");
    const a = await muatan(disetujui.id);
    expect(a.o.angkaSistemTampil).toBe(true);
    expect(a.o.items).toEqual([expect.objectContaining({ snapshotQty: 4937, currentQtyAtApproval: 4930 })]);

    const batal = await opnameBarang("CANCELLED");
    expect((await muatan(batal.id)).teks).not.toContain("4937");
    sesi.permissions = PENYETUJU;
    expect((await muatan(batal.id)).o.angkaSistemTampil).toBe(true);
  });

  it("refuses to change counts once the opname is submitted — the figures are visible by then", async () => {
    sesi.permissions = ["*"];
    const { id, barisId } = await opnameBarang("SUBMITTED");
    const r = await updateOpnameCounts(id, [{ opnameItemId: barisId, countedQty: 4937 }]);
    expect(r.success).toBe(false);
    const baris = await prisma.stockOpnameItem.findUniqueOrThrow({ where: { id: barisId }, select: { countedQty: true, variance: true } });
    expect(Number(baris.countedQty)).toBe(12);
    expect(Number(baris.variance)).toBe(-4925);

    const kain = await opnameKain("SUBMITTED");
    expect((await updateOpnameRollCounts(kain.id, [{ opnameRollId: kain.rolId, countedLength: 88.5 }])).success).toBe(false);
  });

  it("refuses a save whose status check read COUNTING just before the submit committed (guard inside the transaction)", async () => {
    // Bacaan cepat di luar transaksi melihat COUNTING (basi); di basis data
    // opname sudah SUBMITTED. Hanya penjaga di dalam transaksi yang bisa
    // menolaknya — tanpa itu hitungan berubah sesudah angka sistem terlihat.
    sesi.permissions = ["*"];
    const { id, barisId } = await opnameBarang("SUBMITTED");
    tiruan.statusBasi = "COUNTING";
    try {
      const r = await updateOpnameCounts(id, [{ opnameItemId: barisId, countedQty: 4937 }]);
      // Bacaan basi benar-benar terpakai (bukan ditolak oleh jalur cepat).
      expect(tiruan.statusBasi).toBeNull();
      expect(r.success).toBe(false);
    } finally {
      tiruan.statusBasi = null;
    }
    const akhir = await prisma.stockOpname.findUniqueOrThrow({ where: { id }, select: { status: true, items: { select: { countedQty: true } } } });
    expect(akhir.status).toBe("SUBMITTED");
    expect(Number(akhir.items[0].countedQty)).toBe(12);
  });

  it("still saves counts while counting, and moves a fresh opname to COUNTING", async () => {
    sesi.permissions = PENGHITUNG;
    const { id, barisId } = await opnameBarang("CREATED");
    const r = await updateOpnameCounts(id, [{ opnameItemId: barisId, countedQty: 11 }]);
    expect(r).toEqual({ success: true });
    const o = await prisma.stockOpname.findUniqueOrThrow({ where: { id }, select: { status: true, items: { select: { countedQty: true } } } });
    expect(o.status).toBe("COUNTING");
    expect(Number(o.items[0].countedQty)).toBe(11);
  });

  it("a save racing a submit never lands after it, and never drags the opname back to COUNTING", async () => {
    sesi.permissions = ["*"];
    for (let i = 0; i < 6; i++) {
      // Semua baris sudah terisi (12) supaya kiriman sah sejak status CREATED.
      const { id, barisId } = await opnameBarang("COUNTING");
      await prisma.stockOpname.update({ where: { id }, data: { status: "CREATED" } });
      const [kirim, simpan] = await Promise.all([submitOpname(id), updateOpnameCounts(id, [{ opnameItemId: barisId, countedQty: 11 }])]);
      const akhir = await prisma.stockOpname.findUniqueOrThrow({ where: { id }, select: { status: true, items: { select: { countedQty: true } } } });
      if (kirim.success) expect(akhir.status).toBe("SUBMITTED");
      // Simpanan yang ditolak tidak meninggalkan apa pun.
      if (!simpan.success) expect(Number(akhir.items[0].countedQty)).toBe(12);
      expect(kirim.success || simpan.success).toBe(true);
    }
  });
});
