import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, seededId, seededIds } from "@elorae/db";
import { listFieldSalesOrders } from "./queries";

/*
 * Saringan daftar pesanan lapangan: "Ditolak" = ditolak KANTOR saja, "Dibatalkan sales"
 * terpisah, dan saringan status pengiriman (hanya pesanan PUTUS yang disetujui — pesanan
 * menunggu juga bernilai bawaan PENDING di kolomnya, tapi belum bisa dikirim).
 * Dibatasi ke toko uji lewat `storeId`; teardown lewat id yang diseed.
 */
const url = process.env.DATABASE_URL ?? "";
const d = url.includes(":3307") || url.includes("api.elorae.cloud") ? describe.skip : describe;

const tag = `DPS-${Math.random().toString(36).slice(2, 10)}`;

d("listFieldSalesOrders — saringan status & pengiriman (basis data)", () => {
  let sales = "";
  let toko = "";
  const id: Record<string, string> = {};
  let nomorKe = 0;

  beforeAll(async () => {
    sales = (await prisma.user.create({ data: { email: `${tag}-s@test.local`.toLowerCase(), name: `s ${tag}` } })).id;
    toko = (
      await prisma.store.create({ data: { code: `${tag}-T`, name: `Toko ${tag}`, address: "x", termsType: "PUTUS", isActive: true } })
    ).id;
    const buat = async (
      kunci: string,
      data: { status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"; deliveryStatus?: "PENDING" | "PARTIAL" | "DELIVERED" | "CLOSED"; cancelledById?: string; orderType?: "PUTUS" | "KONSI" },
    ) => {
      id[kunci] = (
        await prisma.fieldSalesOrder.create({
          data: {
            orderNo: `${tag}-${nomorKe++}`,
            storeId: toko,
            salesmanId: sales,
            status: data.status,
            orderType: data.orderType ?? "PUTUS",
            deliveryStatus: data.deliveryStatus ?? "PENDING",
            cancelledById: data.cancelledById ?? null,
            cancelledAt: data.cancelledById ? new Date() : null,
            subtotal: 70_000,
            total: 70_000,
          },
        })
      ).id;
    };
    await buat("menunggu", { status: "PENDING_APPROVAL" });
    await buat("belumKirim", { status: "APPROVED", deliveryStatus: "PENDING" });
    await buat("sebagian", { status: "APPROVED", deliveryStatus: "PARTIAL" });
    await buat("terkirim", { status: "APPROVED", deliveryStatus: "DELIVERED" });
    await buat("konsi", { status: "APPROVED", orderType: "KONSI" });
    await buat("ditolakKantor", { status: "REJECTED" });
    await buat("dibatalkan", { status: "REJECTED", cancelledById: sales });
  });

  afterAll(async () => {
    await prisma.fieldSalesOrder.deleteMany({ where: { id: { in: seededIds(Object.values(id)) } } });
    if (toko) await prisma.store.delete({ where: { id: seededId(toko) } });
    if (sales) await prisma.user.delete({ where: { id: seededId(sales) } });
  });

  const daftar = async (f: Parameters<typeof listFieldSalesOrders>[0]) =>
    (await listFieldSalesOrders({ ...f, storeId: toko }, { page: 1, pageSize: 50 })).orders;
  const ids = async (f: Parameters<typeof listFieldSalesOrders>[0]) => (await daftar(f)).map((o) => o.id).sort();

  it("REJECTED = hanya ditolak kantor; CANCELLED = hanya dibatalkan salesman", async () => {
    expect(await ids({ status: "REJECTED" })).toEqual([id.ditolakKantor]);
    expect(await ids({ status: "CANCELLED" })).toEqual([id.dibatalkan]);
  });

  it("kirim=PENDING: pesanan PUTUS disetujui yang belum dikirim saja (bukan pesanan menunggu, bukan konsinyasi)", async () => {
    expect(await ids({ kirim: "PENDING" })).toEqual([id.belumKirim]);
  });

  it("kirim=PARTIAL dan DELIVERED", async () => {
    expect(await ids({ kirim: "PARTIAL" })).toEqual([id.sebagian]);
    expect(await ids({ kirim: "DELIVERED" })).toEqual([id.terkirim]);
  });

  it("baris daftar membawa deliveryStatus untuk lencana", async () => {
    const baris = await daftar({});
    expect(baris.find((o) => o.id === id.sebagian)?.deliveryStatus).toBe("PARTIAL");
    expect(baris.find((o) => o.id === id.dibatalkan)?.dibatalkan).toBe(true);
  });
});
