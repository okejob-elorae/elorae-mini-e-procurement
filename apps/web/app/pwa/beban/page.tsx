import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bebanSaya } from "@/lib/receivables/pwa-queries";
import { bacaAturanHilang } from "@/lib/spg/hilang-db";
import { bebanHilangSaya } from "@/lib/spg/hilang-queries";
import { BebanSayaClient } from "./BebanSayaClient";

export const dynamic = "force-dynamic";

/**
 * Beban saya: selisih retur dan barang hilang yang ditetapkan kantor ke orang
 * yang masuk (sales atau SPG). Hanya bagian miliknya sendiri.
 */
export default async function BebanSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const userId = session.user.id;
  const [baris, hilang, aturan, tokoTetap] = await Promise.all([
    bebanSaya(userId),
    bebanHilangSaya(userId),
    bacaAturanHilang(prisma),
    ambilTokoTetap(userId),
  ]);

  return (
    <BebanSayaClient
      baris={baris}
      hilang={hilang}
      maksPotongPersen={aturan.maksPotongPersen}
      cadangan={tokoTetap ? "/pwa/spg/lainnya" : "/pwa/lainnya"}
    />
  );
}
