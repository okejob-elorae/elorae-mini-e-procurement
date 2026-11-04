import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { rincianRekomendasiSaya } from "@/lib/salesman/rekomendasi-queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { RincianRekomendasiClient } from "./RincianRekomendasiClient";

export const dynamic = "force-dynamic";

/**
 * Satu rekomendasi milik salesman ini: barisnya, jawaban toko, kirim ke
 * manager lewat WhatsApp, tandai toko setuju (toko tanpa SPG), batalkan, dan —
 * setelah diterima — buat pesanannya dari katalog yang sudah terisi. Katalog
 * butuh kunjungan aktif di toko itu (atau pesanan jarak jauh) untuk mengirim.
 */
export default async function RincianRekomendasiPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  const { id } = await params;
  if (await ambilTokoTetap(session.user.id)) redirect(`/pwa/spg/rekomendasi/${encodeURIComponent(id)}`);

  const [rincian, aktif] = await Promise.all([rincianRekomendasiSaya(id, session.user.id), getActiveVisit(session.user.id)]);
  return <RincianRekomendasiClient rincian={rincian} sudahCheckIn={rincian !== null && aktif?.storeId === rincian.toko.id} />;
}
