import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pilihPeriode } from "@/lib/salesman/analisa-toko";
import { analisaToko } from "@/lib/salesman/analisa-toko-queries";
import { dariSpgToko, penyerapanToko } from "@/lib/salesman/penyerapan-queries";
import { bolehBuatRekomendasi } from "@/lib/salesman/rekomendasi-aturan";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { getStore } from "@/lib/stores/queries";
import { BukanTokoSaya } from "../BukanTokoSaya";
import { AnalisaTokoClient } from "./AnalisaTokoClient";

export const dynamic = "force-dynamic";

/**
 * Analisa toko: barang jenis apa yang laku di toko ini — per kategori, artikel
 * teratas dengan ukuran dan warnanya, tren bulanan, dan untuk toko konsinyasi
 * berapa yang benar-benar laku dibanding yang dikirim.
 *
 * Aksesnya SAMA dengan halaman toko: kunci "hanya toko sendiri" berlaku. SPG
 * tidak memakai halaman ini (ia punya layar stoknya sendiri) dan dikembalikan
 * ke berandanya. Toko konsinyasi tidak pernah membawa rupiah ke HP.
 *
 * Ditambah penyerapan per artikel (masuk vs laku vs sisa), yang dilaporkan SPG
 * toko ini, dan ajakan membuat rekomendasi — hanya pemegang toko (atau siapa
 * pun bila toko belum punya pemegang dan kunci "hanya toko sendiri" mati).
 */
export default async function AnalisaTokoPage({
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
  const dipilih = pilihPeriode(periode);
  const sekarang = new Date();
  const [hasil, penyerapan, dariSpg] = await Promise.all([
    analisaToko(store.id, dipilih, sekarang),
    penyerapanToko(store.id, dipilih, sekarang),
    dariSpgToko(store.id, dipilih, sekarang),
  ]);
  if (!hasil) notFound();
  return (
    <AnalisaTokoClient
      data={hasil}
      penyerapan={penyerapan}
      dariSpg={dariSpg}
      bolehRekomendasi={bolehBuatRekomendasi({ terkunci, pemegangId: store.salesmanId, userId: session.user.id })}
    />
  );
}
