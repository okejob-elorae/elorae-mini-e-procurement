import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { fakturToko, janjiBerjalanDiToko } from "@/lib/receivables/pwa-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { formatIDR } from "@/lib/sales-orders/format";
import { FakturTokoClient, type JanjiTampil } from "./FakturTokoClient";

export const dynamic = "force-dynamic";

export default async function FakturTokoPage({
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
  const [data, janji] = await Promise.all([fakturToko(session.user.id, storeId), janjiBerjalanDiToko(storeId)]);
  if (!data) notFound();

  // Sama dengan saringan formulirnya: faktur yang masih bersisa dan belum
  // dipegang toko lewat kontrabon berjalan.
  const bisaJanji = data.baris.some((b) => b.outstanding > 0 && !b.alasan.noKontrabon);
  const janjiTampil: JanjiTampil[] = janji.map((j) => ({
    id: j.id,
    docNo: j.docNo,
    tanggalJanji: formatDisplayDate(j.promisedDate),
    nilai: formatIDR(j.nilai),
    jumlahFaktur: j.jumlahFaktur,
    receivedBy: j.receivedBy,
    dariLapangan: j.dariLapangan,
    dikonfirmasi: j.dikonfirmasi,
  }));

  return (
    <FakturTokoClient
      storeId={storeId}
      storeName={data.storeName}
      baris={data.baris}
      bisaJanji={bisaJanji}
      janji={janjiTampil}
    />
  );
}
