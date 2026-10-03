import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { fakturSiapJanji } from "@/lib/receivables/pwa-queries";
import { hariWib } from "@/lib/receivables/giro";
import { formatDisplayDate } from "@/lib/date-only";
import { formatIDR } from "@/lib/sales-orders/format";
import { JanjiBayarClient } from "./JanjiBayarClient";

export const dynamic = "force-dynamic";

/**
 * Catat janji bayar / tukar faktur di depan toko.
 *
 * Hanya faktur yang ditagih salesman ini, yang masih bersisa, dan yang belum
 * dipegang toko lewat kontrabon lain — penulisnya menolak ketiganya, dan
 * servernya memeriksa ulang aturan penagihnya saat laporan tiba.
 */
export default async function JanjiBayarPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const { storeId } = await params;
  const data = await fakturSiapJanji(session.user.id, storeId);
  if (!data) notFound();

  return (
    <JanjiBayarClient
      storeId={storeId}
      storeName={data.storeName}
      hariIni={hariWib(new Date())}
      faktur={data.faktur.map((f) => ({
        id: f.id,
        invoiceNo: f.invoiceNo,
        jatuhTempo: formatDisplayDate(f.dueDate),
        sisa: f.outstanding,
        sisaTeks: formatIDR(f.outstanding),
      }))}
    />
  );
}
