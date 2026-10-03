import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { rincianPelangganHp } from "@/lib/spg/pelanggan-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { FormPelanggan } from "../../FormPelanggan";

export const dynamic = "force-dynamic";

export default async function SpgUbahPelangganPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/pelanggan");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const { id } = await params;
  const p = await rincianPelangganHp(toko.id, id);
  if (!p) redirect("/pwa/spg/pelanggan");
  return <FormPelanggan namaToko={toko.name} awal={{ id: p.id, nama: p.nama, hp: p.hp, catatan: p.catatan }} />;
}
