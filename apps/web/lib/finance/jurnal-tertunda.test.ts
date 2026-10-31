import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, seededIds } from "@elorae/db";
import {
  dokumenJurnal,
  hitungJurnalTertunda,
  sumberNotifikasiJurnal,
  tandaiJurnalTertundaSelesai,
} from "./jurnal-tertunda";
import { findPostableJournalDocIds } from "@/lib/canvassing/journal-pending";

/*
 * Baris "Jurnal gagal" di Beranda dulu tidak pernah hilang: tidak ada kode yang
 * menandai notifikasi JOURNAL_PENDING selesai sesudah jurnalnya berhasil
 * diposting. Tes ini memakai id dokumen sintetis (tidak ada dokumen asli yang
 * membawanya) dan hitungan yang DIBATASI ke notifikasi milik tes ini, karena
 * basis data uji dipakai bersama dengan baris notifikasi asli.
 */

describe("sumberNotifikasiJurnal — metadata setiap penulis JOURNAL_PENDING", () => {
  it("memetakan setiap bentuk metadata ke sumber jurnalnya", () => {
    expect(sumberNotifikasiJurnal({ docId: "v1", kind: "van_load", reason: "UNMAPPED_ROLE" })).toEqual(
      dokumenJurnal("VAN_LOAD", "v1"),
    );
    expect(sumberNotifikasiJurnal({ docId: "v2", kind: "van_sale" })).toEqual(dokumenJurnal("VAN_SALE", "v2"));
    expect(sumberNotifikasiJurnal({ docId: "v3", kind: "van_reconcile" })).toEqual(
      dokumenJurnal("VAN_RECONCILE", "v3"),
    );
    expect(sumberNotifikasiJurnal({ grnId: "g1", kind: "receipt", reason: "ERROR" })).toEqual(dokumenJurnal("GRN", "g1"));
    expect(sumberNotifikasiJurnal({ grnId: "g1", kind: "reversal" })).toEqual(dokumenJurnal("GRN_REVERSAL", "g1"));
    expect(sumberNotifikasiJurnal({ receiptId: "r1", woId: "w1", kind: "fg_receipt" })).toEqual(
      dokumenJurnal("FG_RECEIPT", "r1"),
    );
    expect(sumberNotifikasiJurnal({ opnameId: "o1", reason: "UNBALANCED", role: null })).toEqual(
      dokumenJurnal("OPNAME", "o1"),
    );
    expect(sumberNotifikasiJurnal({ salesReturnId: "s1", kind: "revenue" })).toEqual(
      dokumenJurnal("SALESRETURN_REVENUE", "s1"),
    );
    expect(sumberNotifikasiJurnal({ salesReturnId: "s1", kind: "cogs" })).toEqual(
      dokumenJurnal("SALESRETURN_COGS", "s1"),
    );
    expect(sumberNotifikasiJurnal({ orderId: "so1", kind: "revenue" })).toEqual(
      dokumenJurnal("SALESORDER_REVENUE", "so1"),
    );
    expect(sumberNotifikasiJurnal({ orderId: "so1", kind: "cogs" })).toEqual(dokumenJurnal("SALESORDER_COGS", "so1"));
    expect(sumberNotifikasiJurnal({ docId: "po1", kind: "supplier_payment", reason: "NOTHING_TO_POST" })).toEqual({
      tipe: "pembayaranPemasok",
      arah: "payment",
      poId: "po1",
    });
    expect(sumberNotifikasiJurnal({ docId: "po1", kind: "supplier_payment_reversal" })).toEqual({
      tipe: "pembayaranPemasok",
      arah: "reversal",
      poId: "po1",
    });
  });

  it("metadata yang tiba sebagai teks JSON dibaca sama dengan objeknya", () => {
    expect(sumberNotifikasiJurnal(JSON.stringify({ grnId: "g1", kind: "receipt", reason: "ERROR" }))).toEqual(
      dokumenJurnal("GRN", "g1"),
    );
    expect(sumberNotifikasiJurnal(JSON.stringify({ docId: "po1", kind: "supplier_payment" }))).toEqual({
      tipe: "pembayaranPemasok",
      arah: "payment",
      poId: "po1",
    });
    expect(sumberNotifikasiJurnal(JSON.stringify("teks"))).toBeNull();
    expect(sumberNotifikasiJurnal("{rusak")).toBeNull();
  });

  it("bentuk yang tidak dikenal tidak dipetakan (tetap dihitung, tidak pernah diam-diam selesai)", () => {
    expect(sumberNotifikasiJurnal(null)).toBeNull();
    expect(sumberNotifikasiJurnal("x")).toBeNull();
    expect(sumberNotifikasiJurnal([])).toBeNull();
    expect(sumberNotifikasiJurnal({})).toBeNull();
    expect(sumberNotifikasiJurnal({ grnId: "g1", kind: "lain" })).toBeNull();
    expect(sumberNotifikasiJurnal({ orderId: "so1" })).toBeNull();
    expect(sumberNotifikasiJurnal({ docId: "d1", kind: "lain" })).toBeNull();
    expect(sumberNotifikasiJurnal({ grnId: "", kind: "receipt" })).toBeNull();
  });
});

/* Menulis AdminNotification dan Journal — tidak pernah terhadap basis data produksi. */
const url = process.env.DATABASE_URL ?? "";
const isProd = url.includes(":3307") || url.includes("api.elorae.cloud");
const d = isProd ? describe.skip : describe;

d("hitung & tandai JOURNAL_PENDING (basis data uji)", () => {
  let token = "";
  let notifIds: string[] = [];
  let jurnalIds: string[] = [];

  beforeEach(() => {
    token = `w6-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)}`;
    notifIds = [];
    jurnalIds = [];
  });

  afterEach(async () => {
    try {
      if (notifIds.length) await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(notifIds) } } });
    } catch (e) {
      console.warn("[jurnal-tertunda.test.ts] gagal menghapus notifikasi uji", notifIds, e);
    }
    try {
      if (jurnalIds.length) await prisma.journal.deleteMany({ where: { id: { in: seededIds(jurnalIds) } } });
    } catch (e) {
      console.warn("[jurnal-tertunda.test.ts] gagal menghapus jurnal uji", jurnalIds, e);
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

  async function jurnal(sourceType: string, sourceId: string, createdAt?: Date): Promise<void> {
    const j = await prisma.journal.create({
      data: {
        date: new Date(),
        description: "uji jurnal tertunda",
        sourceType,
        sourceId,
        postedById: "penguji-w6",
        ...(createdAt ? { createdAt } : {}),
      },
      select: { id: true },
    });
    jurnalIds.push(j.id);
  }

  async function dibaca(id: string): Promise<boolean> {
    const n = await prisma.adminNotification.findUnique({ where: { id }, select: { readAt: true } });
    return n?.readAt != null;
  }

  it("gagal → 1 baris; jurnal berhasil + ditandai → 0", async () => {
    const grnId = `grn-${token}`;
    const id = await gagal({ grnId, kind: "receipt", reason: "UNMAPPED_ROLE", role: "AP" });
    expect(await hitungJurnalTertunda({ notifikasiIds: [id] })).toBe(1);

    await jurnal("GRN", grnId);
    const ditandai = await tandaiJurnalTertundaSelesai([dokumenJurnal("GRN", grnId)]);

    expect(ditandai).toBe(1);
    expect(await dibaca(id)).toBe(true);
    expect(await hitungJurnalTertunda({ notifikasiIds: [id] })).toBe(0);
  });

  it("dua notifikasi beralasan beda untuk dokumen yang sama → keduanya selesai; dokumen lain tidak tersentuh", async () => {
    const saleId = `vs-${token}`;
    const a = await gagal({ docId: saleId, kind: "van_sale", reason: "UNMAPPED_ROLE", role: "CASH" });
    const b = await gagal({ docId: saleId, kind: "van_sale", reason: "ERROR", role: null });
    const lain = await gagal({ docId: `vs-lain-${token}`, kind: "van_sale", reason: "UNMAPPED_ROLE" });
    const jenisLain = await gagal({ docId: saleId, kind: "van_load", reason: "UNMAPPED_ROLE" });

    const ditandai = await tandaiJurnalTertundaSelesai([dokumenJurnal("VAN_SALE", saleId)]);

    expect(ditandai).toBe(2);
    expect(await dibaca(a)).toBe(true);
    expect(await dibaca(b)).toBe(true);
    expect(await dibaca(lain)).toBe(false);
    expect(await dibaca(jenisLain)).toBe(false);
    expect(await hitungJurnalTertunda({ notifikasiIds: [a, b, lain, jenisLain] })).toBe(2);
  });

  it("pertahanan berlapis: notifikasi belum dibaca tapi jurnal dokumennya sudah ada → tidak dihitung", async () => {
    const orderId = `so-${token}`;
    const rev = await gagal({ orderId, kind: "revenue", reason: "UNMAPPED_ROLE", role: "AR" });
    const cogs = await gagal({ orderId, kind: "cogs", reason: "UNMAPPED_ROLE", role: "COGS" });
    const asing = await gagal({ bentuk: "tidak dikenal", token });
    expect(await hitungJurnalTertunda({ notifikasiIds: [rev, cogs, asing] })).toBe(3);

    await jurnal("SALESORDER_REVENUE", orderId);

    // Pendapatan sudah berjurnal; HPP belum; bentuk asing tetap dihitung.
    expect(await hitungJurnalTertunda({ notifikasiIds: [rev, cogs, asing] })).toBe(2);
    expect(await dibaca(rev)).toBe(false);
  });

  it("pembayaran pemasok: jurnal yang berdiri SEBELUM kegagalan tidak menyelesaikannya; yang sesudahnya menyelesaikan", async () => {
    const poId = `po-${token}`;
    const t0 = new Date(Date.now() - 60_000);
    const t1 = new Date(Date.now() - 30_000);
    // Jurnal generasi 1 berdiri lebih dulu, lalu tanda PAYMENT_SUPERSEDED ditulis.
    await jurnal("SUPPLIER_PAYMENT", `${poId}#1`, t0);
    const n = await gagal({ docId: poId, kind: "supplier_payment", reason: "PAYMENT_SUPERSEDED" }, t1);
    const balik = await gagal({ docId: poId, kind: "supplier_payment_reversal", reason: "ERROR" }, t1);
    expect(await hitungJurnalTertunda({ notifikasiIds: [n, balik] })).toBe(2);

    // Pembalikan generasi 1 diposting sesudah tanda → hanya tanda pembalikan yang beres.
    await jurnal("SUPPLIER_PAYMENT_REVERSAL", `${poId}#1`);
    expect(await hitungJurnalTertunda({ notifikasiIds: [n, balik] })).toBe(1);

    // Pembayaran generasi 2 diposting sesudah tanda → tanda pembayaran juga beres.
    await jurnal("SUPPLIER_PAYMENT", `${poId}#2`);
    expect(await hitungJurnalTertunda({ notifikasiIds: [n, balik] })).toBe(0);
  });

  it("pembayaran pemasok: tidak menyentuh PO lain yang id-nya berawalan sama", async () => {
    const poId = `po-${token}`;
    const t1 = new Date(Date.now() - 30_000);
    const n = await gagal({ docId: poId, kind: "supplier_payment", reason: "UNMAPPED_ROLE" }, t1);
    await jurnal("SUPPLIER_PAYMENT", `${poId}9#1`);
    expect(await hitungJurnalTertunda({ notifikasiIds: [n] })).toBe(1);
  });

  it("dibuatSebelum: tanda kegagalan yang ditulis SESUDAH posting dimulai tidak ikut ditandai", async () => {
    const poId = `po-${token}`;
    const mulai = new Date(Date.now() - 10_000);
    const lama = await gagal({ docId: poId, kind: "supplier_payment", reason: "UNMAPPED_ROLE" }, new Date(Date.now() - 60_000));
    const baru = await gagal({ docId: poId, kind: "supplier_payment", reason: "GRN_JOURNALS_INCOMPLETE" });

    const ditandai = await tandaiJurnalTertundaSelesai(
      [{ tipe: "pembayaranPemasok", arah: "payment", poId }],
      { dibuatSebelum: mulai },
    );

    expect(ditandai).toBe(1);
    expect(await dibaca(lama)).toBe(true);
    expect(await dibaca(baru)).toBe(false);
  });

  it("tombol ulang van tetap tersedia walau notifikasinya sudah ditandai selesai", async () => {
    const loadId = `vl-${token}`;
    await gagal({ docId: loadId, kind: "van_load", reason: "UNMAPPED_ROLE", role: "INVENTORY_VAN" });
    await tandaiJurnalTertundaSelesai([dokumenJurnal("VAN_LOAD", loadId)]);

    // Pembaca tombol memakai keberadaan baris, bukan readAt: kalau jurnalnya
    // ternyata belum ada, tombol "Post journal" harus tetap muncul.
    const bisaUlang = await findPostableJournalDocIds("van_load", [loadId]);
    expect(bisaUlang.has(loadId)).toBe(true);
  });

  it("balapan: dua penanda serentak untuk dokumen yang sama → tidak ada galat, semua selesai", async () => {
    const opnameId = `op-${token}`;
    const a = await gagal({ opnameId, reason: "UNMAPPED_ROLE", role: "INVENTORY" });
    const b = await gagal({ opnameId, reason: "UNBALANCED", role: null });
    await jurnal("OPNAME", opnameId);

    const hasil = await Promise.all([
      tandaiJurnalTertundaSelesai([dokumenJurnal("OPNAME", opnameId)]),
      tandaiJurnalTertundaSelesai([dokumenJurnal("OPNAME", opnameId)]),
    ]);

    expect(hasil.every((n) => n >= 0)).toBe(true);
    expect(await dibaca(a)).toBe(true);
    expect(await dibaca(b)).toBe(true);
    expect(await hitungJurnalTertunda({ notifikasiIds: [a, b] })).toBe(0);
  });

  it("daftar sumber kosong tidak menulis apa pun", async () => {
    const id = await gagal({ grnId: `grn-${token}`, kind: "receipt", reason: "ERROR" });
    expect(await tandaiJurnalTertundaSelesai([])).toBe(0);
    expect(await dibaca(id)).toBe(false);
  });
});
