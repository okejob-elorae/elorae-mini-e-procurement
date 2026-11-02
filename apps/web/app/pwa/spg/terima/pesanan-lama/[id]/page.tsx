import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { muatPesananKonsiCadanganLama } from "@/lib/field-sales/konsi-transfer/pesanan-lama";
import { tokoSpg } from "@/lib/spg/queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { FormSampaiPesananLama } from "@/app/pwa/stores/[id]/pesanan-lama/[orderId]/FormSampaiPesananLama";

export const dynamic = "force-dynamic";

/**
 * SPG menghitung dan mengonfirmasi barang pesanan konsinyasi LAMA yang sudah sampai di tokonya
 * (dibuka dari "Pesanan untuk toko ini" di Terima kiriman). Pesanan milik toko lain, atau yang
 * sudah selesai dikonfirmasi / ditutup kantor, tidak bisa dibuka lewat alamat.
 */
export default async function SpgPesananLamaPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const { id } = await params;

  const [lama, aktif] = await Promise.all([muatPesananKonsiCadanganLama(prisma, id), getActiveVisit(session.user.id)]);
  // Opname toko SESUDAH pesanan disetujui: barangnya mungkin sudah ikut terhitung di sana.
  const opnameToko =
    lama && lama.storeId === toko.id
      ? await prisma.storeOpname.findFirst({
          where: { storeId: toko.id, countedAt: { gt: lama.approvedAt } },
          orderBy: { countedAt: "desc" },
          select: { countedAt: true },
        })
      : null;
  const pesanan =
    lama && lama.storeId === toko.id
      ? {
          orderId: lama.orderId,
          orderNo: lama.orderNo,
          disetujuiLabel: formatDisplayDate(lama.approvedAt),
          opnameTokoSesudah: opnameToko ? formatDisplayDate(opnameToko.countedAt) : null,
          // Tanpa harga: hanya nama, varian, dan pcs yang sampai ke HP SPG.
          baris: lama.baris.map((b) => ({ lineId: b.lineId, productName: b.productName, variantSku: b.variantSku, sisa: b.sisa })),
        }
      : null;

  return <FormSampaiPesananLama pesanan={pesanan} peran="SPG" sudahCheckIn={aktif?.storeId === toko.id} kembaliKe="/pwa/spg/terima" />;
}
