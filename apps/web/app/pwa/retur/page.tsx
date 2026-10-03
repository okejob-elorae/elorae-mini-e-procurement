import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { returSaya } from "@/lib/receivables/pwa-queries";
import { ReturSayaClient } from "./ReturSayaClient";
import { formatDisplayDate } from "@/lib/date-only";
import { koreksiTertunda, penggantiUntuk } from "@/lib/receivables/koreksi";

export const dynamic = "force-dynamic";

export default async function ReturSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const baris = await returSaya(session.user.id);
  const [pengganti, koreksi] = await Promise.all([
    penggantiUntuk("retur", baris.filter((b) => b.langkah === "batal").map((b) => b.id)),
    // Yang sudah dihitung gudang: hanya kantor yang bisa membetulkannya.
    koreksiTertunda("retur", baris.filter((b) => b.langkah !== "batal" && b.langkah !== "cek").map((b) => b.id)),
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
