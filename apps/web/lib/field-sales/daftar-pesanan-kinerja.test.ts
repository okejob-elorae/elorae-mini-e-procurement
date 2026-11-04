import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { kinerjaSatuSales } from "@/lib/salesman/metrik-queries";
import { listFieldSalesOrders } from "./queries";
import { bacaSaringanKinerja } from "./saringan-kinerja";

/*
 * Tautan kartu "Nilai pesanan putus" di Kinerja sales lapangan membuka daftar
 * Pesanan lapangan dengan `?status=AKTIF&dari=&sampai=&salesman=`. Tes ini
 * memastikan isi daftar itu SAMA dengan angka kartu: jumlah pesanan, jumlah
 * putus/konsi, dan nilai putus — termasuk batas tengah malam WIB, pesanan yang
 * ditolak kantor, dan yang dibatalkan salesman. Basis data sungguhan; teardown
 * lewat id yang diseed.
 */
const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `DPK-${Math.random().toString(36).slice(2, 10)}`;

d("listFieldSalesOrders — saringan dari Kinerja sales lapangan (basis data)", () => {
  let sales = "";
  let salesLain = "";
  let toko = "";
  const id: Record<string, string> = {};
  let nomorKe = 0;
  const rentang = { dari: "2026-07-01", sampai: "2026-07-10" };

  beforeAll(async () => {
    sales = "";
    salesLain = "";
    toko = "";
    sales = (await prisma.user.create({ data: { email: `${tag}-s@test.local`.toLowerCase(), name: `Sales ${tag}` } })).id;
    salesLain = (await prisma.user.create({ data: { email: `${tag}-l@test.local`.toLowerCase(), name: `Lain ${tag}` } })).id;
    toko = (
      await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "x", termsType: "PUTUS", isActive: true } })
    ).id;
    const buat = async (
      kunci: string,
      data: {
        dibuat: string;
        status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
        orderType?: "PUTUS" | "KONSI";
        batal?: boolean;
        total?: number;
        oleh?: string;
      },
    ) => {
      const pembuat = data.oleh ?? sales;
      id[kunci] = (
        await prisma.fieldSalesOrder.create({
          data: {
            orderNo: `${tag}-${nomorKe++}`,
            storeId: toko,
            salesmanId: pembuat,
            status: data.status,
            orderType: data.orderType ?? "PUTUS",
            cancelledById: data.batal ? pembuat : null,
            cancelledAt: data.batal ? new Date(data.dibuat) : null,
            subtotal: data.total ?? 70_000,
            total: data.total ?? 70_000,
            createdAt: new Date(data.dibuat),
          },
        })
      ).id;
    };
    await buat("putus", { dibuat: "2026-07-05T03:00:00Z", status: "APPROVED", total: 100_000 });
    await buat("konsi", { dibuat: "2026-07-06T03:00:00Z", status: "PENDING_APPROVAL", orderType: "KONSI", total: 50_000 });
    await buat("ditolakKantor", { dibuat: "2026-07-06T04:00:00Z", status: "REJECTED" });
    await buat("dibatalkan", { dibuat: "2026-07-06T05:00:00Z", status: "REJECTED", batal: true });
    // 30 Jun 23.59.59 WIB — di luar; 1 Jul 00.00 WIB — di dalam.
    await buat("sebelumTengahMalam", { dibuat: "2026-06-30T16:59:59Z", status: "APPROVED" });
    await buat("tengahMalam", { dibuat: "2026-06-30T17:00:00Z", status: "APPROVED", total: 30_000 });
    // 11 Jul 00.00 WIB — sudah lewat hari terakhir.
    await buat("sesudahRentang", { dibuat: "2026-07-10T17:00:00Z", status: "APPROVED" });
    await buat("salesLain", { dibuat: "2026-07-05T03:00:00Z", status: "APPROVED", oleh: salesLain });
  }, 60_000);

  afterAll(async () => {
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(Object.values(id)) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    if (salesLain) await prisma.user.delete({ where: { id: seededId(salesLain) } });
    if (sales) await prisma.user.delete({ where: { id: seededId(sales) } });
  });

  const saringan = (salesmanId?: string) => {
    const s = bacaSaringanKinerja({ ...rentang, salesman: salesmanId });
    return {
      status: "AKTIF" as const,
      storeId: toko,
      salesmanId: s.salesmanId ?? undefined,
      dibuatSejak: s.dibuatSejak ?? undefined,
      dibuatSebelum: s.dibuatSebelum ?? undefined,
    };
  };

  it("AKTIF + rentang + sales: hanya pesanan menunggu/disetujui sales itu yang DIBUAT di hari WIB rentang", async () => {
    const { orders, totalCount } = await listFieldSalesOrders(saringan(sales), { page: 1, pageSize: 50 });
    expect(orders.map((o) => o.id).sort()).toEqual([id.putus, id.konsi, id.tengahMalam].sort());
    expect(totalCount).toBe(3);
  });

  it("tanpa sales: semua sales di rentang (kartu tim)", async () => {
    const { orders } = await listFieldSalesOrders(saringan(), { page: 1, pageSize: 50 });
    expect(orders.map((o) => o.id).sort()).toEqual([id.putus, id.konsi, id.tengahMalam, id.salesLain].sort());
  });

  it("isi daftar sama dengan angka kartu Nilai pesanan putus di rincian sales", async () => {
    const r = await kinerjaSatuSales(sales, rentang, { sekarang: new Date("2026-07-11T05:00:00Z") });
    expect(r).not.toBeNull();
    const pesanan = r!.kinerja.metrik.pesanan;
    const { orders, totalCount } = await listFieldSalesOrders(saringan(sales), { page: 1, pageSize: 50 });
    const putus = orders.filter((o) => o.orderType === "PUTUS");
    expect(totalCount).toBe(pesanan.jumlah);
    expect(putus.length).toBe(pesanan.putus);
    expect(orders.length - putus.length).toBe(pesanan.konsi);
    expect(putus.reduce((n, o) => n + o.total, 0)).toBe(pesanan.nilaiPutus);
  });
});
