import { prisma } from "@elorae/db";
import { hargaKonsiHp, perkiraanNilaiKonsi, type PerkiraanKonsi } from "./perkiraan-konsi";

/**
 * Perkiraan nilai retail pesanan KONSI yang masih MENUNGGU persetujuan, untuk HP salesman (P18).
 * Satu kueri untuk semua id; hanya pesanan konsi menunggu yang punya entri — pesanan lain (putus,
 * atau konsi yang sudah disetujui dan berharga beku) tidak muncul di peta. Harganya dari harga jual
 * barang dan markup toko SEKARANG (`hargaKonsiHp`), sama dengan yang akan dibekukan kantor. Baris
 * bonus tidak ikut, seperti di rincian pesanan.
 */
export async function perkiraanPesananKonsi(orderIds: readonly string[]): Promise<Map<string, PerkiraanKonsi | null>> {
  const hasil = new Map<string, PerkiraanKonsi | null>();
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return hasil;
  const pesanan = await prisma.fieldSalesOrder.findMany({
    where: { id: { in: ids }, orderType: "KONSI", status: "PENDING_APPROVAL" },
    select: {
      id: true,
      store: { select: { markupPercent: true } },
      lines: { where: { isBonus: false }, select: { qty: true, item: { select: { sellingPrice: true } } } },
    },
  });
  for (const p of pesanan) {
    const markup = p.store?.markupPercent == null ? null : Number(p.store.markupPercent);
    hasil.set(
      p.id,
      perkiraanNilaiKonsi(
        p.lines.map((l) => {
          const jual = l.item?.sellingPrice;
          return { qty: l.qty, harga: hargaKonsiHp(jual == null ? null : Number(jual), markup) };
        }),
      ),
    );
  }
  return hasil;
}
