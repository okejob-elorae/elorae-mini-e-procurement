import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { permintaanToko } from "@/lib/spg/permintaan-queries";
import { BATAS_HAMPIR_HABIS, stokToko, tokoSpg } from "@/lib/spg/queries";
import { StokClient } from "./StokClient";

export const dynamic = "force-dynamic";

/**
 * Stok toko SPG: saldo tiap barang + permintaan kiriman toko ini.
 * `?saring=habis` (tugas "hampir habis" di beranda) membuka saringan itu.
 */
export default async function SpgStokPage({ searchParams }: { searchParams: Promise<{ saring?: string }> }) {
  const { saring } = await searchParams;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const [baris, permintaan] = await Promise.all([stokToko(toko.id), permintaanToko(toko.id)]);

  return (
    <StokClient
      namaToko={toko.name}
      baris={baris}
      batasHampirHabis={BATAS_HAMPIR_HABIS}
      saringAwal={saring === "habis" ? "hampir" : "semua"}
      // Tanggal diformat di sini: format di klien bisa berbeda antara Node
      // dan Safari, dan perbedaan itu merusak hidrasi.
      permintaan={permintaan.map((p) => ({
        ...p,
        dibuatLabel: formatDisplayDateTime(p.dibuat),
        ditanganiLabel: p.ditanganiPada ? formatDisplayDateTime(p.ditanganiPada) : null,
      }))}
    />
  );
}
