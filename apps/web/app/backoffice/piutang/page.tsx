import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarPiutang, ringkasPiutang } from "@/lib/receivables/queries";
import { katalogBarang, tokoUntukRetur } from "@/lib/receivables/return-queries";
import { PiutangClient } from "./PiutangClient";

export const dynamic = "force-dynamic";

export default async function PiutangPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const bolehMengelola = hasPermission(
    session.user.permissions ?? [],
    PERMISSIONS.RECEIVABLES_MANAGE,
  );
  // Toko dan katalog hanya dibutuhkan oleh formulir faktur manual; tidak
  // diambil sama sekali untuk yang tidak boleh membukanya.
  const [baris, toko, katalog] = await Promise.all([
    daftarPiutang(),
    bolehMengelola ? tokoUntukRetur() : Promise.resolve([]),
    bolehMengelola ? katalogBarang() : Promise.resolve([]),
  ]);

  return (
    <PiutangClient
      baris={baris}
      ringkasan={ringkasPiutang(baris)}
      toko={toko}
      katalog={katalog}
      bolehMengelola={bolehMengelola}
    />
  );
}
