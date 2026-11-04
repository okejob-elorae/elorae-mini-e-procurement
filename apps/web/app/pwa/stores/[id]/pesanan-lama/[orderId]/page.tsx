import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { muatOpnameTokoSesudah, muatPenerimaToko, muatPesananKonsiCadanganLama } from "@/lib/field-sales/konsi-transfer/pesanan-lama";
import { peranPenerimaLama } from "@/lib/field-sales/konsi-transfer/pesanan-lama-aturan";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { getActiveVisit, getStore } from "@/lib/stores/queries";
import { BukanTokoSaya } from "../../BukanTokoSaya";
import { FormSampaiPesananLama, type PenghalangSampai } from "./FormSampaiPesananLama";

export const dynamic = "force-dynamic";

/**
 * Salesman pemegang toko TANPA SPG mengonfirmasi barang pesanan konsinyasi lama yang sudah sampai,
 * saat berkunjung (check-in di toko ini). Toko ber-SPG dikonfirmasi SPG-nya; salesman lain hanya
 * melihat alasannya. Penulisnya menilai ulang semuanya — layar ini hanya memberi tahu lebih awal.
 */
export default async function PesananLamaTokoPage({ params }: { params: Promise<{ id: string; orderId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id, orderId } = await params;
  const userId = session.user.id;

  const [terkunci, tokoTetap, store] = await Promise.all([tokoTerkunci(), ambilTokoTetap(userId), getStore(id)]);
  // SPG toko ini memakai layarnya sendiri, di bawah Terima kiriman (SPG toko lain sudah
  // dikembalikan ke /pwa oleh layout toko).
  if (tokoTetap === id) redirect(`/pwa/spg/terima/pesanan-lama/${encodeURIComponent(orderId)}`);
  if (tokoTetap) redirect("/pwa");
  if (!store) notFound();
  // Kunci "hanya toko sendiri", sama dengan halaman toko dan subhalamannya — dinilai SEBELUM
  // baris pesanan dibaca: tanpa ini salesman yang bukan pemegang membaca barang pesanan toko
  // orang lain lewat alamat.
  if (!bolehPegangToko({ terkunci, penanggungJawabId: store.salesmanId, userId })) {
    return <BukanTokoSaya nama={store.name} />;
  }

  const [lama, penerima, aktif] = await Promise.all([
    muatPesananKonsiCadanganLama(prisma, orderId),
    muatPenerimaToko(prisma, id),
    getActiveVisit(userId),
  ]);

  // Opname toko SESUDAH pesanan disetujui — opname versi tim (StoreStocktake) maupun buku SPG
  // (StoreOpname): barangnya mungkin sudah ikut terhitung di sana.
  const opnameToko =
    lama && lama.storeId === id
      ? await muatOpnameTokoSesudah(prisma, { storeId: id, sejak: lama.approvedAt, itemIds: lama.baris.map((b) => b.itemId) })
      : null;
  const pesanan =
    lama && lama.storeId === id
      ? {
          orderId: lama.orderId,
          orderNo: lama.orderNo,
          disetujuiLabel: formatDisplayDate(lama.approvedAt),
          opnameTokoSesudah: opnameToko ? formatDisplayDate(opnameToko) : null,
          // Tanpa harga: hanya nama, varian, dan pcs yang sampai ke HP.
          baris: lama.baris.map((b) => ({ lineId: b.lineId, productName: b.productName, variantSku: b.variantSku, sisa: b.sisa })),
        }
      : null;
  const peran = peranPenerimaLama({
    userId,
    tokoTetapPengguna: tokoTetap,
    storeId: id,
    jumlahSpg: penerima.jumlahSpg,
    pemegangTokoId: penerima.pemegangTokoId,
  });
  const penghalang: PenghalangSampai | null = peran ? null : penerima.jumlahSpg > 0 ? "TOKO_BER_SPG" : "BUKAN_PEMEGANG";

  return (
    <FormSampaiPesananLama
      pesanan={pesanan}
      peran="SALESMAN"
      sudahCheckIn={aktif?.storeId === id}
      kembaliKe={`/pwa/stores/${id}`}
      penghalang={penghalang}
    />
  );
}
