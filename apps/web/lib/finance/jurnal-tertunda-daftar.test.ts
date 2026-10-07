import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import { daftarJurnalTertunda, dokumenJurnal, hitungJurnalTertunda, metadataNotifikasi } from "./jurnal-tertunda";

/*
 * Daftar "Jurnal tertunda" di halaman Jurnal: isinya harus SAMA dengan angka
 * Beranda (`hitungJurnalTertunda`) — kalau tidak, Beranda menyebut 3 dan
 * halaman tujuan menampilkan 2. Id dokumen sintetis, dan setiap kueri dibatasi
 * ke notifikasi milik tes karena basis data uji dipakai bersama.
 */

describe("metadataNotifikasi", () => {
  it("objek dibaca apa adanya, teks JSON diurai, selain itu objek kosong", () => {
    expect(metadataNotifikasi({ grnId: "g1", reason: "ERROR" })).toEqual({ grnId: "g1", reason: "ERROR" });
    expect(metadataNotifikasi(JSON.stringify({ opnameId: "o1" }))).toEqual({ opnameId: "o1" });
    expect(metadataNotifikasi("{rusak")).toEqual({});
    expect(metadataNotifikasi(null)).toEqual({});
    expect(metadataNotifikasi([1, 2])).toEqual({});
  });
});

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("daftarJurnalTertunda (basis data uji)", () => {
  let token = "";
  let notifIds: string[] = [];
  let jurnalIds: string[] = [];

  beforeEach(() => {
    token = `t4d-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;
    notifIds = [];
    jurnalIds = [];
  });

  afterEach(async () => {
    try {
      if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    } catch (e) {
      console.warn("[jurnal-tertunda-daftar.test.ts] gagal menghapus notifikasi uji", notifIds, e);
    }
    try {
      if (jurnalIds.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    } catch (e) {
      console.warn("[jurnal-tertunda-daftar.test.ts] gagal menghapus jurnal uji", jurnalIds, e);
    }
  });

  async function gagal(metadata: Record<string, unknown>, opts: { createdAt?: Date; readAt?: Date } = {}): Promise<string> {
    const n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "uji",
        message: "uji",
        metadata: metadata as never,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        ...(opts.readAt ? { readAt: opts.readAt } : {}),
      },
      select: { id: true },
    });
    notifIds.push(n.id);
    return n.id;
  }

  async function jurnal(sourceType: string, sourceId: string): Promise<void> {
    const j = await prisma.journal.create({
      data: { date: new Date(), description: "uji daftar tertunda", sourceType, sourceId, postedById: "penguji-t4" },
      select: { id: true },
    });
    jurnalIds.push(j.id);
  }

  it("memuat sumber, sebab, dan peran; terbaru lebih dulu; sama dengan hitungan Beranda", async () => {
    const grnId = `grn-${token}`;
    const lama = await gagal(
      { grnId, kind: "receipt", reason: "UNMAPPED_ROLE", role: "AP" },
      { createdAt: new Date(Date.now() - 120_000) },
    );
    const baru = await gagal({ docId: `po-${token}`, kind: "supplier_payment", reason: "GRN_JOURNALS_INCOMPLETE", role: null });
    const ids = [lama, baru];

    const daftar = await daftarJurnalTertunda({ notifikasiIds: ids });

    expect(daftar.map((r) => r.notifikasiId)).toEqual([baru, lama]);
    expect(daftar[1]).toMatchObject({
      sumber: dokumenJurnal("GRN", grnId),
      sebab: "UNMAPPED_ROLE",
      peran: "AP",
    });
    expect(daftar[0]).toMatchObject({
      sumber: { tipe: "pembayaranPemasok", arah: "payment", poId: `po-${token}` },
      sebab: "GRN_JOURNALS_INCOMPLETE",
      peran: null,
    });
    expect(daftar[1].metadata.grnId).toBe(grnId);
    expect(daftar).toHaveLength(await hitungJurnalTertunda({ notifikasiIds: ids }));
  });

  it("yang sudah ditandai selesai atau dokumennya sudah berjurnal tidak ikut; bentuk asing tetap ikut", async () => {
    const opnameId = `op-${token}`;
    const selesai = await gagal({ grnId: `grn-${token}`, kind: "receipt", reason: "ERROR" }, { readAt: new Date() });
    const sudahBerjurnal = await gagal({ opnameId, reason: "UNBALANCED", role: null });
    const asing = await gagal({ bentuk: "tidak dikenal" });
    const masih = await gagal({ orderId: `so-${token}`, kind: "cogs", reason: "UNMAPPED_ROLE", role: "COGS" });
    await jurnal("OPNAME", opnameId);
    const ids = [selesai, sudahBerjurnal, asing, masih];

    const daftar = await daftarJurnalTertunda({ notifikasiIds: ids });

    expect(new Set(daftar.map((r) => r.notifikasiId))).toEqual(new Set([asing, masih]));
    expect(daftar.find((r) => r.notifikasiId === asing)).toMatchObject({ sumber: null, sebab: null, peran: null });
    expect(daftar).toHaveLength(await hitungJurnalTertunda({ notifikasiIds: ids }));
  });

  it("sebab/peran yang bukan teks dibaca sebagai null, bukan dilempar", async () => {
    const id = await gagal({ grnId: `grn-${token}`, kind: "receipt", reason: 7, role: { x: 1 } });
    const [baris] = await daftarJurnalTertunda({ notifikasiIds: [id] });
    expect(baris).toMatchObject({ sebab: null, peran: null });
  });

  it("daftar id kosong → daftar kosong (bukan seluruh basis data)", async () => {
    await gagal({ grnId: `grn-${token}`, kind: "receipt", reason: "ERROR" });
    expect(await daftarJurnalTertunda({ notifikasiIds: [] })).toEqual([]);
  });
});
