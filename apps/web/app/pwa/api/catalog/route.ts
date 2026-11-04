import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { aksesTokoHp } from "@/lib/pwa/akses-toko";
import { listCatalogForPwa } from "@/lib/catalog/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pwaAccessGuard(session.user.permissions) !== "render") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId required" }, { status: 400 });

  // Harga dan stok rak satu toko: SPG hanya tokonya, salesman mengikuti kunci
  // "hanya toko sendiri" — aturan yang sama dengan check-in (lib/pwa/akses-toko.ts).
  const akses = await aksesTokoHp(session.user.id, storeId);
  if (!akses.ok) {
    return akses.code === "TOKO_TIDAK_ADA"
      ? NextResponse.json({ error: "Store not found" }, { status: 404 })
      : NextResponse.json({ error: "STORE_NOT_ASSIGNED" }, { status: 403 });
  }

  /*
   * "Ubah pesanan" (`?ganti=<orderId>`): barang yang sudah ada di pesanan itu tetap tampil walau
   * kini "Marketplace saja" (P73, `tetapTampilkan`). Daftarnya disusun SERVER dari pesanan
   * PENDING milik salesman ini sendiri di toko ini — id pesanan orang lain, toko lain, atau yang
   * sudah diputuskan tidak membuka barang apa pun. SPG tidak pernah mengubah pesanan salesman.
   */
  const ganti = req.nextUrl.searchParams.get("ganti");
  let tetapTampilkan: string[] = [];
  if (!akses.spg && ganti) {
    const pesanan = await prisma.fieldSalesOrder.findFirst({
      where: { id: ganti, storeId, salesmanId: session.user.id, status: "PENDING_APPROVAL" },
      select: { lines: { select: { itemId: true } } },
    });
    tetapTampilkan = [...new Set((pesanan?.lines ?? []).map((l) => l.itemId))];
  }

  // Katalog HP salesman: ikut stok di rak toko (buku stok SPG, pcs) supaya
  // salesman tidak mengirim barang yang masih menumpuk di toko. SPG tidak
  // memakai stok rak di katalog ini. Harga retail konsi hanya untuk HP SALESMAN
  // (pemilik P18 "berikan selengkapnya saja"); HP SPG tetap tanpa harga konsi (P18a).
  const payload = await listCatalogForPwa(storeId, {
    stokRak: !akses.spg,
    hargaKonsi: !akses.spg,
    ...(tetapTampilkan.length > 0 ? { tetapTampilkan } : {}),
  });
  if (!payload) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  return NextResponse.json(payload);
}
