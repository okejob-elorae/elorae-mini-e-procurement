import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pilihPeriodeSpg } from "@/lib/spg/analisa";
import { analisaSpg } from "@/lib/spg/analisa-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { AnalisaSpgClient } from "./AnalisaSpgClient";

export const dynamic = "force-dynamic";

const tanggal = (kunci: string) => formatDisplayDate(new Date(`${kunci}T00:00:00+07:00`));

/**
 * Analisa penjualan SPG di tokonya sendiri: laku per periode dan
 * pembandingnya, artikel & varian terlaris, sisa di rak cukup untuk berapa
 * hari, barang lambat, porsi kategori/ukuran/warna, dan barang yang dicari
 * pembeli — dengan jalan pintas "Minta" ke formulir minta kiriman.
 *
 * Hanya SPG (toko tetap); salesman dan yang lain dikembalikan ke beranda.
 * Toko SELALU toko tetap SPG dari sesi, tidak pernah dari alamat. Semua angka
 * dalam potong — tidak ada rupiah.
 */
export default async function SpgAnalisaPage({ searchParams }: { searchParams: Promise<{ periode?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await ambilTokoTetap(session.user.id))) redirect("/pwa");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const { periode } = await searchParams;
  const hasil = await analisaSpg(toko, pilihPeriodeSpg(periode), new Date());
  const r = hasil.rentang;
  return (
    <AnalisaSpgClient
      data={hasil}
      // Tanggal diformat di server (WIB): format di klien bisa berbeda antara Node dan Safari.
      label={{
        periode: `${tanggal(r.dari)} – ${tanggal(r.sampai)}`,
        pembanding: `${tanggal(r.dariLalu)} – ${tanggal(r.sampaiLalu)}`,
      }}
    />
  );
}
