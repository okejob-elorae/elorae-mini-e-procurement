import { notFound, redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bacaHariBaru } from "@/lib/salesman/saran-tawar";
import { KUNCI_HARI_BARU } from "@/lib/salesman/saran-tawar-queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { getStore, getActiveVisit } from "@/lib/stores/queries";
import { getPackRatio } from "@/app/actions/settings/pack-ratio";
import { dasarLakuToko } from "@/lib/field-sales/smart-request/rencana-queries";
import { BukanTokoSaya } from "../BukanTokoSaya";
import { RencanaKirimShell } from "./RencanaKirimShell";

export const dynamic = "force-dynamic";

/**
 * Rencana kirim (dulu "pesanan cepat"): salesman memilih jenis barang, jumlah
 * per artikel, sumber barang, dan batasan; server menyusun DRAF pesanan yang ia
 * tinjau dan ubah sebelum dikirim. Untuk toko putus DAN konsinyasi — konsinyasi
 * tanpa harga, total, maupun anggaran di mana pun.
 *
 * Aksesnya sama dengan halaman toko (kunci "hanya toko sendiri"). Menyusun
 * rencana tidak butuh check-in; MENGIRIMNYA butuh kunjungan berjalan di toko ini,
 * dan layar menjelaskannya bila belum.
 */
export default async function PwaRencanaKirim({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Pesanan milik salesman keliling: SPG menjual dari layarnya sendiri.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");
  const { id } = await params;
  const store = await getStore(id);
  if (!store || !store.isActive) notFound();
  if (!bolehPegangToko({ terkunci: await tokoTerkunci(), penanggungJawabId: store.salesmanId, userId: session.user.id })) {
    return <BukanTokoSaya nama={store.name} />;
  }

  const [active, categories, ratio, setelanHariBaru, dasarLaku] = await Promise.all([
    getActiveVisit(session.user.id),
    prisma.itemCategory.findMany({
      where: { isActive: true, items: { some: { isActive: true, type: "FINISHED_GOOD" } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    getPackRatio(),
    prisma.systemSetting.findUnique({ where: { key: KUNCI_HARI_BARU }, select: { value: true } }),
    dasarLakuToko(store.id, store.termsType),
  ]);
  const visitId = active?.storeId === store.id ? active.id : null;

  return (
    <RencanaKirimShell
      storeId={store.id}
      storeName={store.name}
      konsi={store.termsType === "KONSI"}
      visitId={visitId}
      categories={categories}
      ratio={ratio}
      hariBaruBawaan={bacaHariBaru(setelanHariBaru?.value)}
      dasarLaku={dasarLaku}
    />
  );
}
