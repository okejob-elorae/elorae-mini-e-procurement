import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { kirimanMenunggu } from "@/lib/spg/kiriman";
import { pesananMenujuToko, pesananMenujuUntukHp } from "@/lib/spg/pesanan-menuju-toko";
import { tokoSpg } from "@/lib/spg/queries";
import { rusakUntukSpg } from "@/lib/spg/rusak-queries";
import { rusakPembeliUntukSpg } from "@/lib/spg/gudang-rusak-queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { TerimaClient } from "./TerimaClient";

export const dynamic = "force-dynamic";

/** Kiriman ke toko SPG yang belum dihitung dan diterima. */
export default async function SpgTerimaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const [kiriman, aktif, rusak, rusakPembeli, pesanan] = await Promise.all([
    kirimanMenunggu(toko.id),
    getActiveVisit(session.user.id),
    rusakUntukSpg(toko.id),
    rusakPembeliUntukSpg(toko.id),
    // Bagian tambahan: kalau gagal dimuat, daftar kiriman tetap tampil tanpanya.
    pesananMenujuToko(toko.id).catch((e) => {
      console.error("[terima] pesanan menuju toko gagal dimuat", e);
      return [];
    }),
  ]);

  return (
    <TerimaClient
      namaToko={toko.name}
      storeId={toko.id}
      sudahCheckIn={aktif?.storeId === toko.id}
      kiriman={kiriman.map((k) => ({
        sourceType: k.sourceType,
        sourceId: k.sourceId,
        docNo: k.docNo,
        // Diformat di server — format tanggal di klien bisa berbeda antara
        // Node dan Safari, dan perbedaan itu merusak hidrasi.
        tanggalLabel: formatDisplayDate(k.tanggal),
        jumlahBaris: k.lines.length,
        totalQty: k.lines.reduce((n, l) => n + l.qty, 0),
      }))}
      rusak={rusak.map((r) => ({
        // Barang rusak dari kiriman yang sudah diterima — tanpa harga.
        id: r.id,
        sourceType: r.sourceType,
        docNo: r.docNo,
        tanggalLabel: formatDisplayDate(r.diterimaPada),
        katalog: r.itemId !== null,
        productName: r.productName,
        variantSku: r.variantSku,
        qty: r.qty,
        keterangan: r.keterangan,
        status: r.status,
        catatanKeputusan: r.catatanKeputusan,
        sisa: r.sisa,
        notaRetur: r.notaRetur,
      }))}
      // Pesanan sales untuk toko ini yang belum sampai — jumlah potong saja, tanpa harga.
      pesanan={pesananMenujuUntukHp(pesanan, (d) => formatDisplayDate(d))}
      rusakPembeli={rusakPembeli.map((r) => ({
        // Barang rusak dari pembeli yang belum dikirim balik — tanpa harga.
        id: r.id,
        productName: r.productName,
        variantSku: r.variantSku,
        kondisi: r.kondisi,
        sisa: r.sisa,
        docNo: r.docNo,
        tanggalLabel: formatDisplayDate(r.dikembalikanPada),
        alasan: r.alasan,
        notaRetur: r.notaRetur,
      }))}
    />
  );
}
