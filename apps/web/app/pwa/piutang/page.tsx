import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { tokoLapangan } from "@/lib/receivables/pwa-queries";
import { tugasTagihSaya } from "@/lib/receivables/tugas-tagih-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { PiutangLapanganClient } from "./PiutangLapanganClient";
import type { TugasTagihHp } from "./TugasTagihKantor";

export const dynamic = "force-dynamic";

export default async function PiutangLapanganPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const [toko, tugas] = await Promise.all([tokoLapangan(session.user.id), tugasTagihSaya(session.user.id)]);
  // Tanggal diformat di server — klien menerima teks jadi (hidrasi Safari).
  const tokoSaya = new Set(toko.map((s) => s.storeId));
  const tugasHp: TugasTagihHp[] = tugas.map((g) => ({
    id: g.id,
    storeId: g.storeId,
    storeName: g.storeName,
    keadaan: g.keadaan,
    note: g.note,
    totalSisa: g.totalSisa,
    tenggatTeks: g.dueDate ? formatDisplayDate(g.dueDate) : null,
    faktur: g.faktur.map((f) => ({ id: f.id, invoiceNo: f.invoiceNo, sisa: f.sisa, keadaan: f.keadaan })),
    bisaDibuka: tokoSaya.has(g.storeId),
  }));

  return <PiutangLapanganClient toko={toko} tugas={tugasHp} />;
}
