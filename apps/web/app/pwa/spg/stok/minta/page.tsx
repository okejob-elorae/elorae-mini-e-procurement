import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { namaPemegangToko } from "@/lib/spg/permintaan-salesman";
import { stokToko, tokoSpg } from "@/lib/spg/queries";
import { bacaTambahan } from "@/lib/spg/saran-minta";
import { saranMintaToko } from "@/lib/spg/saran-minta-queries";
import { pilihanBarang } from "../pilihan";
import { FormMinta } from "./FormMinta";

export const dynamic = "force-dynamic";

/**
 * Minta kiriman ke salesman pemegang toko dan kantor. Tidak butuh check-in:
 * SPG boleh menyadari rak menipis kapan saja, dan permintaan hanya kertas —
 * tidak menggerakkan stok.
 *
 * `?tambah=` (dari layar analisa) membawa baris yang langsung ditambahkan ke
 * daftar. Saran "yang perlu diminta" adalah kartu pelengkap: kalau kuerinya
 * gagal, formulirnya tetap tampil tanpa saran.
 */
export default async function SpgMintaKirimanPage({ searchParams }: { searchParams: Promise<{ tambah?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const [stok, saran, pemegang] = await Promise.all([
    stokToko(toko.id),
    saranMintaToko(toko.id, new Date()).catch((e: unknown) => {
      console.error("saranMintaToko", e);
      return null;
    }),
    namaPemegangToko(toko.id),
  ]);
  const pilihan = await pilihanBarang(stok);
  const { tambah } = await searchParams;

  return (
    <FormMinta
      storeId={toko.id}
      namaToko={toko.name}
      pemegang={pemegang}
      pilihan={pilihan}
      saran={saran}
      tambahAwal={bacaTambahan(tambah)}
    />
  );
}
