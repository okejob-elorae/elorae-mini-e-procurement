import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn(async () => {}) }));

import { batalkanPermintaanInvoice, mintaInvoice, mintaUlangInvoice, tandaiPermintaanTerpenuhi } from "./permintaan-invoice-writer";
import { runInvoiceRequestReminderSweep } from "./permintaan-invoice-pengingat";
import { batalkanTidakPerluInvoice, tandaiTidakPerluInvoice } from "./tidak-perlu-invoice-writer";

/*
 * Permintaan invoice ke pemasok (Q18 "catat kapan diminta, oleh siapa"; P19 "pengingat bila 7 hari belum
 * ada invoice"). Basis data uji; setiap tes membuat GRN-nya sendiri, dan setiap fungsi yang menyapu
 * seluruh tabel (`tandaiPermintaanTerpenuhi`, `runInvoiceRequestReminderSweep`) dibatasi ke permintaan
 * tes ini lewat `requestIds` (+ `asOf`).
 *
 * Balapan: setiap tanda keadaan adalah `updateMany where …, cek jumlah` di dalam `runSerializable` — yang
 * di Prisma 7 BUKAN compare-and-swap kalau berdiri sendiri. Tes `Promise.all` di bawah membuktikan
 * hasilnya selalu salah satu urutan serial. Penulis yang lebih pendek digeser beberapa ms supaya
 * tidak selalu kebetulan menang lebih dulu.
 */

const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const HARI_MS = 86_400_000;
/** Diminta pukul 10.00 WIB, 1 Oktober 2026. */
const DIMINTA = new Date("2026-10-01T03:00:00Z");
const hariKe = (n: number, dari: Date = DIMINTA) => new Date(dari.getTime() + n * HARI_MS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

d("permintaan invoice (test bed only)", () => {
  let tag = "";
  const ids = { user: "", supplierType: "", supplier: "", uom: "", item: "", grn: "" };

  beforeEach(async () => {
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
    tag = `PIW${Math.floor(Math.random() * 10_000_000)}`;
    ids.user = (await prisma.user.create({ data: { email: `${tag}@test.local`, name: "Uji Permintaan" } })).id;
    ids.supplierType = (await prisma.supplierType.create({ data: { code: `ST-${tag}`, name: "Uji" } })).id;
    ids.supplier = (await prisma.supplier.create({ data: { code: `SUP-${tag}`, name: "Pemasok uji", typeId: ids.supplierType } })).id;
    ids.uom = (await prisma.uOM.create({ data: { code: `U-${tag}`, nameId: "pcs", nameEn: "pcs" } })).id;
    ids.item = (
      await prisma.item.create({ data: { sku: `${tag}-KAOS`, nameId: `Kaos ${tag}`, nameEn: "Tee", type: "FINISHED_GOOD", uomId: ids.uom, isActive: true } })
    ).id;
    ids.grn = (
      await prisma.gRN.create({
        data: {
          docNumber: `GRN-${tag}`,
          supplierId: ids.supplier,
          receivedBy: ids.user,
          totalAmount: 800_000,
          items: [{ itemId: ids.item, variantSku: null, qty: 100, unitCost: 8_000, totalCost: 800_000, itemType: "FINISHED_GOOD" }],
        },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    if (ids.supplier) {
      const reqIds = (await prisma.supplierInvoiceRequest.findMany({ where: { supplierId: seededId(ids.supplier) }, select: { id: true } })).map((r) => r.id);
      const milik = new Set(reqIds);
      const bells = (await prisma.adminNotification.findMany({ where: { category: "SUPPLIER_INVOICE_OVERDUE" }, select: { id: true, metadata: true } }))
        .filter((n) => milik.has(String((n.metadata as { requestId?: unknown } | null)?.requestId ?? "")))
        .map((n) => n.id);
      await prisma.adminNotification.deleteMany({ where: { id: { in: seededIds(bells) } } });
      await prisma.supplierInvoiceRequestLine.deleteMany({ where: { requestId: { in: seededIds(reqIds) } } });
      await prisma.supplierInvoiceRequest.deleteMany({ where: { id: { in: seededIds(reqIds) } } });
      await prisma.supplierInvoiceWaiver.deleteMany({ where: { supplierId: seededId(ids.supplier) } });
    }
    if (ids.grn) await prisma.gRN.deleteMany({ where: { id: seededId(ids.grn) } });
    if (ids.user) await prisma.auditLog.deleteMany({ where: { userId: seededId(ids.user) } });
    if (ids.item) await prisma.item.deleteMany({ where: { id: seededId(ids.item) } });
    if (ids.uom) await prisma.uOM.deleteMany({ where: { id: seededId(ids.uom) } });
    if (ids.supplier) await prisma.supplier.deleteMany({ where: { id: seededId(ids.supplier) } });
    if (ids.supplierType) await prisma.supplierType.deleteMany({ where: { id: seededId(ids.supplierType) } });
    if (ids.user) await prisma.user.deleteMany({ where: { id: seededId(ids.user) } });
    Object.keys(ids).forEach((k) => (ids[k as keyof typeof ids] = ""));
  });

  const minta = (kunci?: string) =>
    mintaInvoice({ supplierId: ids.supplier, sumber: [{ jenis: "GRN", id: ids.grn }], saluran: "WHATSAPP", catatan: "Mohon invoicenya", idempotencyKey: kunci, olehUserId: ids.user });
  const baca = (id: string) => prisma.supplierInvoiceRequest.findUniqueOrThrow({ where: { id: seededId(id) }, include: { lines: true } });
  const jejak = (id: string, action: string) => prisma.auditLog.count({ where: { entityId: seededId(id), action } });
  const lonceng = async (requestId: string) =>
    (await prisma.adminNotification.findMany({ where: { category: "SUPPLIER_INVOICE_OVERDUE" }, select: { id: true, metadata: true } })).filter(
      (n) => (n.metadata as { requestId?: unknown } | null)?.requestId === requestId,
    );
  const sapu = (requestId: string, asOf: Date) => runInvoiceRequestReminderSweep({ requestIds: [requestId], asOf });
  /** Mundurkan tanggal minta terakhir supaya umur permintaan bisa diatur. */
  const mundurkan = (id: string, waktu: Date = DIMINTA) => prisma.supplierInvoiceRequest.update({ where: { id: seededId(id) }, data: { requestedAt: waktu, lastRequestedAt: waktu } });
  const sisihkanSemua = () =>
    tandaiTidakPerluInvoice({ supplierId: ids.supplier, sumber: [{ jenis: "GRN", id: ids.grn, itemId: ids.item, variantSku: null }], alasan: "jasa sendiri", olehUserId: ids.user });

  it("records who asked, when and through which channel, with one line per receipt and its audit row; the same key returns it", async () => {
    const a = await minta(`kunci-${tag}-a`);
    expect(a).toEqual({ ok: true, id: expect.any(String), ulang: false });
    if (!a.ok) return;
    const r = await baca(a.id);
    expect([r.channel, r.askCount, r.requestedById, r.lastRequestedById, r.note]).toEqual(["WHATSAPP", 1, ids.user, ids.user, "Mohon invoicenya"]);
    expect(r.lines.map((l) => [l.sourceType, l.sourceId, Number(l.receivedQty), Number(l.billedQty), Number(l.qty)])).toEqual([["GRN", ids.grn, 100, 0, 100]]);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_CREATED")).toBe(1);
    expect(await minta(`kunci-${tag}-a`)).toEqual({ ok: true, id: a.id, ulang: true });
    expect(await prisma.supplierInvoiceRequest.count({ where: { supplierId: seededId(ids.supplier) } })).toBe(1);
  });

  it("refuses a second ask for a receipt already asked for, and writes nothing", async () => {
    expect((await minta()).ok).toBe(true);
    expect(await minta()).toMatchObject({ ok: false, kode: "SUDAH_DIMINTA" });
    expect(await prisma.supplierInvoiceRequest.count({ where: { supplierId: seededId(ids.supplier) } })).toBe(1);
  });

  it("refuses a receipt without a PO still awaiting admin confirmation (P51a), and writes nothing", async () => {
    await prisma.gRN.update({ where: { id: seededId(ids.grn) }, data: { requiresNoPoConfirmation: true, noPoConfirmedAt: null } });
    expect(await minta()).toMatchObject({ ok: false, kode: "MENUNGGU_KONFIRMASI" });
    expect(await prisma.supplierInvoiceRequest.count({ where: { supplierId: seededId(ids.supplier) } })).toBe(0);
  });

  it("RACE: two asks for one receipt with different keys — exactly one request, the other SUDAH_DIMINTA", async () => {
    const hasil = await Promise.all([minta(`kunci-${tag}-1`), sleep(5).then(() => minta(`kunci-${tag}-2`))]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["SUDAH_DIMINTA"]);
    expect(await prisma.supplierInvoiceRequest.count({ where: { supplierId: seededId(ids.supplier) } })).toBe(1);
  });

  it("Minta ulang moves the last ask, counts it, re-arms the reminder and writes its audit row", async () => {
    const a = await minta();
    if (!a.ok) throw new Error("minta gagal");
    await mundurkan(a.id);
    await prisma.supplierInvoiceRequest.update({ where: { id: seededId(a.id) }, data: { remindedAt: hariKe(7) } });
    expect(await mintaUlangInvoice({ requestId: a.id, saluran: "TELEPON", catatan: "ditelepon", olehUserId: ids.user })).toEqual({ ok: true, id: a.id, ulang: false });
    const r = await baca(a.id);
    expect([r.askCount, r.channel, r.note, r.remindedAt]).toEqual([2, "TELEPON", "ditelepon", null]);
    expect(r.lastRequestedAt.getTime()).toBeGreaterThan(DIMINTA.getTime());
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_FOLLOWED_UP")).toBe(1);
  });

  it("Minta ulang and Batalkan refuse before any write: an answered request and a cancelled one stay exactly as they were", async () => {
    const a = await minta();
    if (!a.ok) throw new Error("minta gagal");
    // Seluruh sisanya dibebaskan → permintaan terjawab (SELESAI_TANPA_INVOICE) walau belum ditutup.
    expect((await sisihkanSemua()).ok).toBe(true);
    const sebelum = await baca(a.id);
    expect(await mintaUlangInvoice({ requestId: a.id, saluran: "TELEPON", olehUserId: ids.user })).toEqual({ ok: false, kode: "SUDAH_DITERIMA" });
    expect(await batalkanPermintaanInvoice({ requestId: a.id, alasan: "salah", olehUserId: ids.user })).toEqual({ ok: false, kode: "SUDAH_DITERIMA" });
    expect(await batalkanPermintaanInvoice({ requestId: a.id, alasan: "  ", olehUserId: ids.user })).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    const sesudah = await baca(a.id);
    expect([sesudah.askCount, sesudah.lastRequestedAt.getTime(), sesudah.cancelledAt, sesudah.closedAt]).toEqual([
      sebelum.askCount,
      sebelum.lastRequestedAt.getTime(),
      null,
      null,
    ]);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_FOLLOWED_UP")).toBe(0);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_CANCELLED")).toBe(0);
  });

  it("an answered request is closed by tandaiPermintaanTerpenuhi (scoped) and reopened when the waiver that answered it is cancelled", async () => {
    const a = await minta();
    if (!a.ok) throw new Error("minta gagal");
    const w = await sisihkanSemua();
    if (!w.ok) throw new Error("bebaskan gagal");
    expect(await tandaiPermintaanTerpenuhi({ requestIds: [a.id] })).toBe(1);
    expect((await baca(a.id)).closedAt).not.toBeNull();
    expect(await tandaiPermintaanTerpenuhi({ requestIds: [a.id] })).toBe(0);
    expect((await batalkanTidakPerluInvoice({ waiverId: w.ids[0], alasan: "ternyata ada invoice", olehUserId: ids.user })).ok).toBe(true);
    expect((await baca(a.id)).closedAt).toBeNull();
  });

  it("RACE: Batalkan × Batalkan — exactly one cancels, one audit row; the other is SUDAH_DIBATALKAN", async () => {
    const a = await minta();
    if (!a.ok) throw new Error("minta gagal");
    const hasil = await Promise.all([
      batalkanPermintaanInvoice({ requestId: a.id, alasan: "salah pemasok", olehUserId: ids.user }),
      sleep(5).then(() => batalkanPermintaanInvoice({ requestId: a.id, alasan: "dobel", olehUserId: ids.user })),
    ]);
    expect(hasil.filter((h) => h.ok)).toHaveLength(1);
    expect(hasil.filter((h) => !h.ok).map((h) => (h.ok ? null : h.kode))).toEqual(["SUDAH_DIBATALKAN"]);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_CANCELLED")).toBe(1);
    expect((await baca(a.id)).cancelledAt).not.toBeNull();
  });

  it.each([
    ["Batalkan starts a few ms later", 0, 5],
    ["Minta ulang starts a few ms later", 5, 0],
  ])("RACE: Minta ulang × Batalkan (%s) — always one of the two serial orders, never a lost update", async (_n, tundaUlang, tundaBatal) => {
    const a = await minta();
    if (!a.ok) throw new Error("minta gagal");
    const [ulang, batal] = await Promise.all([
      sleep(tundaUlang).then(() => mintaUlangInvoice({ requestId: a.id, saluran: "TELEPON", olehUserId: ids.user })),
      sleep(tundaBatal).then(() => batalkanPermintaanInvoice({ requestId: a.id, alasan: "salah pemasok", olehUserId: ids.user })),
    ]);
    // Membatalkan selalu berhasil: minta ulang tidak menutup permintaan.
    expect(batal.ok).toBe(true);
    if (!ulang.ok) expect(ulang.kode).toBe("SUDAH_DIBATALKAN");
    const r = await baca(a.id);
    expect(r.cancelledAt).not.toBeNull();
    expect(r.askCount).toBe(ulang.ok ? 2 : 1);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_FOLLOWED_UP")).toBe(ulang.ok ? 1 : 0);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_CANCELLED")).toBe(1);
    // Minta ulang yang berhasil terjadi SEBELUM pembatalan, tidak pernah sesudahnya.
    if (ulang.ok) expect(r.lastRequestedAt.getTime()).toBeLessThanOrEqual(r.cancelledAt!.getTime());
  });

  it("RACE: Minta ulang × Minta ulang — both may succeed, but every ask is counted and audited (no lost increment)", async () => {
    const a = await minta();
    if (!a.ok) throw new Error("minta gagal");
    const hasil = await Promise.all([
      mintaUlangInvoice({ requestId: a.id, saluran: "TELEPON", olehUserId: ids.user }),
      sleep(5).then(() => mintaUlangInvoice({ requestId: a.id, saluran: "EMAIL", olehUserId: ids.user })),
    ]);
    const berhasil = hasil.filter((h) => h.ok).length;
    expect((await baca(a.id)).askCount).toBe(1 + berhasil);
    expect(await jejak(a.id, "SUPPLIER_INVOICE_REQUEST_FOLLOWED_UP")).toBe(berhasil);
  });

  describe("7-day reminder (P19)", () => {
    it("fires at day 7 (WIB calendar days), not at day 6, as one bell in the same transaction as remindedAt", async () => {
      const a = await minta();
      if (!a.ok) throw new Error("minta gagal");
      await mundurkan(a.id);
      expect(await sapu(a.id, hariKe(6))).toMatchObject({ scanned: 1, reminded: 0 });
      expect((await baca(a.id)).remindedAt).toBeNull();
      expect(await sapu(a.id, hariKe(7))).toMatchObject({ reminded: 1, failed: 0 });
      expect((await baca(a.id)).remindedAt).not.toBeNull();
      const [n] = await lonceng(a.id);
      expect(n?.metadata).toMatchObject({ requestId: a.id, supplierId: ids.supplier, lastRequestedAt: DIMINTA.toISOString(), count: 1 });
    });

    it("one reminder per ask: a later run reminds nobody; Minta ulang re-arms it", async () => {
      const a = await minta();
      if (!a.ok) throw new Error("minta gagal");
      await mundurkan(a.id);
      expect(await sapu(a.id, hariKe(8))).toMatchObject({ reminded: 1 });
      // Run berikutnya tidak memindai permintaan yang sudah diingatkan.
      expect(await sapu(a.id, hariKe(9))).toMatchObject({ scanned: 0, reminded: 0 });
      expect(await lonceng(a.id)).toHaveLength(1);
      expect((await mintaUlangInvoice({ requestId: a.id, saluran: "TELEPON", olehUserId: ids.user })).ok).toBe(true);
      const terakhir = (await baca(a.id)).lastRequestedAt;
      expect(await sapu(a.id, hariKe(6, terakhir))).toMatchObject({ reminded: 0 });
      expect(await sapu(a.id, hariKe(7, terakhir))).toMatchObject({ reminded: 1 });
      expect(await lonceng(a.id)).toHaveLength(2);
    });

    it("an answered request is closed by the sweep instead of being reminded", async () => {
      const a = await minta();
      if (!a.ok) throw new Error("minta gagal");
      await mundurkan(a.id);
      expect((await sisihkanSemua()).ok).toBe(true);
      expect(await sapu(a.id, hariKe(8))).toMatchObject({ reminded: 0, closed: 1 });
      expect((await baca(a.id)).closedAt).not.toBeNull();
      expect(await lonceng(a.id)).toHaveLength(0);
    });

    it("RACE: two sweeps at once — exactly one reminder and one bell", async () => {
      const a = await minta();
      if (!a.ok) throw new Error("minta gagal");
      await mundurkan(a.id);
      const hasil = await Promise.all([sapu(a.id, hariKe(8)), sleep(5).then(() => sapu(a.id, hariKe(8)))]);
      expect(hasil.reduce((s, h) => s + h.reminded, 0)).toBe(1);
      expect(hasil.reduce((s, h) => s + h.failed, 0)).toBe(0);
      expect(await lonceng(a.id)).toHaveLength(1);
    });

    it("RACE: sweep × Minta ulang — never a reminder stamped on the new ask", async () => {
      const a = await minta();
      if (!a.ok) throw new Error("minta gagal");
      await mundurkan(a.id);
      const [sapuan, ulang] = await Promise.all([
        sapu(a.id, hariKe(8)),
        sleep(5).then(() => mintaUlangInvoice({ requestId: a.id, saluran: "TELEPON", olehUserId: ids.user })),
      ]);
      expect(ulang.ok).toBe(true);
      const r = await baca(a.id);
      // Diingatkan dulu lalu diminta ulang (remindedAt dikosongkan lagi), atau diminta ulang dulu (CAS meleset).
      expect(r.remindedAt).toBeNull();
      expect(await lonceng(a.id)).toHaveLength(sapuan.reminded);
      for (const n of await lonceng(a.id)) expect((n.metadata as { lastRequestedAt?: unknown }).lastRequestedAt).toBe(DIMINTA.toISOString());
    });
  });
});
