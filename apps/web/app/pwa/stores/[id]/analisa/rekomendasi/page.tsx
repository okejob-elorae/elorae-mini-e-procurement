import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pilihPeriode } from "@/lib/salesman/analisa-toko";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bahanFormRekomendasi } from "@/lib/salesman/rekomendasi-queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { getStore } from "@/lib/stores/queries";
import { BukanTokoSaya } from "../../BukanTokoSaya";
import { RekomendasiBaruClient } from "./RekomendasiBaruClient";

export const dynamic = "force-dynamic";

/**
 * Membuat rekomendasi barang untuk toko ini, dari analisa tokonya: barang yang
 * cepat terserap dan hampir habis sudah terisi jumlah sarannya; barang laris di
 * toko lain, barang baru, dan andalan toko bisa ditambahkan. Dikirim ke SPG
 * toko itu (bila ada) dan bisa diteruskan ke manager lewat WhatsApp dari
 * rinciannya.
 *
 * Aksesnya sama dengan analisa toko; SIAPA yang boleh MENGIRIM (pemegang toko)
 * dinilai lagi di formulir dan di penulisnya.
 */
export default async function RekomendasiBaruPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periode?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  const { id } = await params;
  const store = await getStore(id);
  if (!store) notFound();

  const [terkunci, tokoTetap] = await Promise.all([tokoTerkunci(), ambilTokoTetap(session.user.id)]);
  if (tokoTetap) redirect("/pwa");
  if (!bolehPegangToko({ terkunci, penanggungJawabId: store.salesmanId, userId: session.user.id })) {
    return <BukanTokoSaya nama={store.name} />;
  }

  const { periode } = await searchParams;
  const bahan = await bahanFormRekomendasi(store.id, session.user.id, pilihPeriode(periode), new Date());
  if (!bahan) notFound();
  return <RekomendasiBaruClient bahan={bahan} />;
}
