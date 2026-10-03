import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { formatDisplayDate } from "@/lib/date-only";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { usulanSaya } from "@/lib/stores/usulan-queries";
import { UsulanSayaClient } from "./UsulanSayaClient";

export const dynamic = "force-dynamic";

/** Usulan toko saya — status setiap toko baru yang diajukan dari HP ini. */
export default async function UsulanSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // Layar salesman keliling: SPG (toko tetap) dikembalikan ke berandanya.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const baris = await usulanSaya(session.user.id);
  return (
    <UsulanSayaClient
      baris={baris.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        status: b.status,
        termsType: b.termsType,
        areaCode: b.areaCode,
        reviewNote: b.reviewNote,
        storeId: b.storeId,
        storeCode: b.storeCode,
        // Tanggal diformat di server: format tanggal Node dan Safari bisa berbeda (hydration error).
        diajukan: formatDisplayDate(b.createdAt),
        diputuskan: b.reviewedAt ? formatDisplayDate(b.reviewedAt) : null,
      }))}
    />
  );
}
