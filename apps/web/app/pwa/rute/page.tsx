import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { kunciSimpanRute } from "@/lib/salesman/rute";
import { ruteHariIni } from "@/lib/salesman/rute-queries";
import { RuteClient } from "./RuteClient";

export const dynamic = "force-dynamic";

/**
 * Rute hari ini — urutan kunjungan melalui toko rencana beranda, tanpa API
 * peta berbayar. Server menyiapkan tokonya; urutan dihitung di HP karena
 * titik awalnya posisi HP.
 */
export default async function RutePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // SPG bekerja di satu toko tetap — tidak ada rute.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const data = await ruteHariIni(session.user.id, new Date());
  return (
    <RuteClient kunciSimpan={kunciSimpanRute(session.user.id)} tanggal={data.tanggal} rencana={data.rencana} toko={data.toko} />
  );
}
