import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { tokoSpg } from "@/lib/spg/queries";
import { FormPelanggan } from "../FormPelanggan";

export const dynamic = "force-dynamic";

export default async function SpgPelangganBaruPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa/spg/pelanggan/baru");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  return <FormPelanggan namaToko={toko.name} awal={null} />;
}
