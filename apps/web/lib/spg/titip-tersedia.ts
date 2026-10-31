import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { MAKS_KABAR_TERSEDIA, stokUntukPermintaan } from "./titip";
import { saldoBarangToko } from "./titip-saldo";

/**
 * Titip pesan: tandai permintaan pembeli yang barangnya sekarang ADA di toko
 * (saldo buku stok > 0) sebagai TERSEDIA dan kabari SPG toko itu.
 *
 * Dipanggil SESUDAH transaksi yang menambah stok toko (terima kiriman, terima
 * mutasi, opname). Tidak pernah melempar — kegagalan hanya berarti kabarnya
 * terlambat sampai pemicu berikutnya; layar titip pesan tetap menghitung
 * ketersediaan dari buku stok saat dibuka.
 */
export async function kabariTitipanTersedia(storeId: string): Promise<void> {
  try {
    const baru = await tandaiTitipanTersedia(storeId);
    if (baru.length === 0) return;
    const spg = await prisma.user.findMany({ where: { assignedStoreId: storeId }, select: { id: true }, orderBy: { id: "asc" } });
    if (spg.length === 0) return;
    const kabar = susunKabarTersedia(baru);
    for (const u of spg) {
      for (const k of kabar) await kabariPengguna(u.id, k);
    }
  } catch (err) {
    console.error("kabariTitipanTersedia gagal", storeId, err);
  }
}

export type TitipanTersedia = { id: string; barang: string; pembeli: string };

/**
 * MENUNGGU → TERSEDIA untuk permintaan toko ini yang barangnya kini bersaldo
 * > 0. Bandingkan-lalu-tukar di dalam `runSerializable`: dua pemicu yang
 * berjalan bersamaan (terima kiriman + opname) tidak menandai — dan tidak
 * mengabarkan — permintaan yang sama dua kali. Permintaan berupa keterangan
 * bebas (tanpa barang katalog) tidak pernah ditandai otomatis.
 */
export async function tandaiTitipanTersedia(storeId: string, sekarang: Date = new Date()): Promise<TitipanTersedia[]> {
  return runSerializable(async (tx) => {
    // Dimulai kosong di setiap percobaan — percobaan ulang tidak membawa hasil yang lama.
    const menunggu = await tx.customerRequest.findMany({
      where: { storeId, status: "MENUNGGU", itemId: { not: null } },
      select: { id: true, itemId: true, variantSku: true, description: true, customerId: true },
      orderBy: { createdAt: "asc" },
    });
    if (menunggu.length === 0) return [];
    const saldo = await saldoBarangToko(
      tx,
      storeId,
      menunggu.map((r) => r.itemId as string),
    );
    const ada = menunggu.filter((r) => stokUntukPermintaan(r.itemId, r.variantSku, saldo) > 0);
    if (ada.length === 0) return [];
    const r = await tx.customerRequest.updateMany({
      where: { id: { in: ada.map((x) => x.id) }, storeId, status: "MENUNGGU" },
      data: { status: "TERSEDIA", availableAt: sekarang },
    });
    if (r.count !== ada.length) {
      // Di bawah SERIALIZABLE tidak terjadi; kalau terjadi, jangan mengabarkan yang tidak pasti.
      throw new Error(`tandaiTitipanTersedia: ${r.count} dari ${ada.length} berubah`);
    }
    const pelanggan = await tx.storeCustomer.findMany({
      where: { id: { in: [...new Set(ada.map((x) => x.customerId))] } },
      select: { id: true, name: true },
    });
    const nama = new Map(pelanggan.map((p) => [p.id, p.name]));
    return ada.map((x) => ({ id: x.id, barang: x.description, pembeli: nama.get(x.customerId) ?? "" }));
  });
}

/**
 * Kabar untuk satu SPG: satu per permintaan, paling banyak `MAKS_KABAR_TERSEDIA`.
 * Lebih dari itu, yang terakhir menjadi ringkasan tanpa `requestId` — tautannya
 * jatuh ke daftar titip pesan, tempat semuanya terlihat.
 */
export function susunKabarTersedia(baru: TitipanTersedia[]): Kabar[] {
  const satu = (t: TitipanTersedia): Kabar => ({
    jenis: JENIS_KABAR.TITIP_PESAN_TERSEDIA,
    judul: "Titip pesan: barang sudah datang",
    isi: t.pembeli
      ? `${t.barang} untuk ${t.pembeli} sudah ada di toko. Kabari pembelinya lewat WhatsApp.`
      : `${t.barang} sudah ada di toko. Kabari pembelinya lewat WhatsApp.`,
    data: { requestId: t.id },
  });
  if (baru.length <= MAKS_KABAR_TERSEDIA) return baru.map(satu);
  const sendiri = baru.slice(0, MAKS_KABAR_TERSEDIA - 1).map(satu);
  const sisa = baru.length - sendiri.length;
  return [
    ...sendiri,
    {
      jenis: JENIS_KABAR.TITIP_PESAN_TERSEDIA,
      judul: "Titip pesan: barang sudah datang",
      isi: `${sisa} titip pesan lain juga sudah datang. Buka Titip pesan untuk mengabari pembelinya.`,
      data: {},
    },
  ];
}
