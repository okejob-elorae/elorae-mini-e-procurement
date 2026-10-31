import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { returSaya } from "@/lib/receivables/pwa-queries";
import { ReturSayaClient } from "./ReturSayaClient";
import { formatDisplayDate } from "@/lib/date-only";
import { koreksiTertunda, penggantiUntuk } from "@/lib/receivables/koreksi";
import { ambilTokoTetap } from "@/lib/pwa/peran";

export const dynamic = "force-dynamic";

export default async function ReturSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  // Salesman juga melihat nota yang dilaporkan SPG di toko yang ia pegang —
  // hanya dilihat. SPG (toko tetap) tetap melihat notanya sendiri saja.
  const tokoTetap = await ambilTokoTetap(session.user.id);
  const baris = await returSaya(session.user.id, { termasukSpgTokoSaya: !tokoTetap });
  // Lapor ulang dan minta koreksi hanya untuk nota milik sendiri.
  const milik = baris.filter((b) => b.milikSaya);
  const [pengganti, koreksi] = await Promise.all([
    penggantiUntuk("retur", milik.filter((b) => b.langkah === "batal").map((b) => b.id)),
    // Yang sudah dihitung gudang: hanya kantor yang bisa membetulkannya.
    koreksiTertunda("retur", milik.filter((b) => b.langkah !== "batal" && b.langkah !== "cek").map((b) => b.id)),
  ]);
  return (
    <ReturSayaClient
      baris={baris.map((b) => {
        const k = koreksi.get(b.id);
        return {
          ...b,
          digantiOleh: pengganti.get(b.id)?.nomor ?? null,
          koreksi: k ? { pada: formatDisplayDate(k.pada), alasan: k.alasan } : null,
        };
      })}
    />
  );
}
