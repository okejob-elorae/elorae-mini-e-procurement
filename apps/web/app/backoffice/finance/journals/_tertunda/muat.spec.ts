import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { hitungJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { muatJurnalTertunda } from "./muat";

/*
 * Baris tab "Tertunda": dokumen sumber + nomornya, sebab, tautan ke dokumen dan
 * ke tempat posting ulang. Satu opname sungguhan (nomornya harus terbaca), id
 * lain sintetis (dokumennya tidak ada → nomor kosong, tautan tetap aman).
 */

const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("muatJurnalTertunda (basis data uji)", () => {
  let token = "";
  let notifIds: string[] = [];
  let opnameId = "";

  beforeEach(() => {
    token = `t4m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;
    notifIds = [];
    opnameId = "";
  });

  afterEach(async () => {
    try {
      if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    } catch (e) {
      console.warn("[muat.spec.ts] gagal menghapus notifikasi uji", notifIds, e);
    }
    try {
      if (opnameId) await prisma.stockOpname.delete({ where: { id: seededId(opnameId) } });
    } catch (e) {
      console.warn("[muat.spec.ts] gagal menghapus opname uji", opnameId, e);
    }
  });

  async function gagal(metadata: Record<string, unknown>, createdAt?: Date): Promise<string> {
    const n = await prisma.adminNotification.create({
      data: {
        category: "JOURNAL_PENDING",
        severity: "WARNING",
        title: "uji",
        message: "uji",
        metadata: metadata as never,
        ...(createdAt ? { createdAt } : {}),
      },
      select: { id: true },
    });
    notifIds.push(n.id);
    return n.id;
  }

  it("nomor dokumen, sebab, peran, dan dua tautan per baris", async () => {
    const opname = await prisma.stockOpname.create({
      data: {
        docNumber: `OPN-${token}`,
        scope: "FINISHED_GOOD",
        snapshotAt: new Date(),
        createdById: "penguji-t4",
      },
      select: { id: true },
    });
    opnameId = opname.id;

    const nOpname = await gagal(
      { opnameId, reason: "UNMAPPED_ROLE", role: "INVENTORY_VARIANCE" },
      new Date(Date.now() - 60_000),
    );
    const nGrn = await gagal({ grnId: `grn-${token}`, kind: "receipt", reason: "ERROR", role: null });
    const nPo = await gagal({ docId: `po-${token}`, kind: "supplier_payment", reason: "GRN_APPROVAL_PENDING" });
    const nAsing = await gagal({ bentuk: "tidak dikenal" });
    const nSo = await gagal({ orderId: `so-${token}`, kind: "revenue", reason: "UNMAPPED_ROLE", role: "AR" });
    const ids = [nOpname, nGrn, nPo, nAsing, nSo];

    const baris = await muatJurnalTertunda({ notifikasiIds: ids });
    const per = new Map(baris.map((b) => [b.id, b]));

    expect(per.get(nOpname)).toMatchObject({
      jenis: "OPNAME",
      nomor: `OPN-${token}`,
      hrefDokumen: `/backoffice/inventory/stock-opname/${opnameId}`,
      hrefPostingUlang: `/backoffice/inventory/stock-opname/${opnameId}`,
      sebab: "UNMAPPED_ROLE",
      peran: "INVENTORY_VARIANCE",
    });
    expect(typeof per.get(nOpname)?.dicatatPada).toBe("string");

    // Dokumen tidak ditemukan: nomor kosong, tautan jatuh ke daftarnya.
    expect(per.get(nGrn)).toMatchObject({
      jenis: "GRN",
      nomor: null,
      hrefDokumen: "/backoffice/inventory?tab=grn",
      hrefPostingUlang: "/backoffice/inventory?tab=grn",
      sebab: "ERROR",
      peran: null,
    });

    expect(per.get(nPo)).toMatchObject({
      jenis: "SUPPLIER_PAYMENT",
      hrefDokumen: `/backoffice/purchase-orders/po-${token}`,
      hrefPostingUlang: `/backoffice/purchase-orders/po-${token}`,
      sebab: "GRN_APPROVAL_PENDING",
    });

    // Penjualan marketplace diposting ulang otomatis: tidak ada tempat posting ulang.
    expect(per.get(nSo)).toMatchObject({
      jenis: "SALESORDER_REVENUE",
      hrefDokumen: `/backoffice/sales-orders/so-${token}`,
      hrefPostingUlang: null,
      otomatis: true,
    });
    expect(per.get(nOpname)?.otomatis).toBe(false);

    // Bentuk asing tetap tampil (tetap dihitung Beranda) tanpa tautan tebakan.
    expect(per.get(nAsing)).toMatchObject({ jenis: null, nomor: null, hrefDokumen: null, hrefPostingUlang: null });

    expect(baris).toHaveLength(await hitungJurnalTertunda({ notifikasiIds: ids }));
    // Terbaru lebih dulu: opname (paling lama) paling akhir.
    expect(baris[baris.length - 1].id).toBe(nOpname);
  });
});
