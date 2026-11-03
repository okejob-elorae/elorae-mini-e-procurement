import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { returSaya, selisihReturSaya } from "@/lib/receivables/pwa-queries";
import { ReturSayaClient } from "./ReturSayaClient";
import { SelisihPerluDicek } from "./SelisihPerluDicek";
import { formatDisplayDate } from "@/lib/date-only";
import { koreksiTertunda, penggantiUntuk } from "@/lib/receivables/koreksi";
import { ambilTokoTetap } from "@/lib/pwa/peran";

export const dynamic = "force-dynamic";

export default async function ReturSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  // Salesman juga melihat nota yang dilaporkan SPG di toko yang ia pegang —
  // hanya dilihat. SPG (toko tetap) tetap melihat notanya sendiri saja. Nilai
  // retur toko KONSI tampil di HP salesman (P57, P18); HP SPG tetap tanpa (P18a).
  // Selisih retur yang perlu dicek hanya untuk salesman pemegang tokonya.
  const tokoTetap = await ambilTokoTetap(session.user.id);
  const [baris, selisih] = await Promise.all([
    returSaya(session.user.id, { termasukSpgTokoSaya: !tokoTetap, nilaiKonsi: !tokoTetap }),
    tokoTetap ? Promise.resolve([]) : selisihReturSaya(session.user.id),
  ]);
  // Lapor ulang dan minta koreksi hanya untuk nota milik sendiri.
  const milik = baris.filter((b) => b.milikSaya);
  const [pengganti, koreksi] = await Promise.all([
    penggantiUntuk("retur", milik.filter((b) => b.langkah === "batal").map((b) => b.id)),
    // Yang sudah dihitung gudang: hanya kantor yang bisa membetulkannya.
    koreksiTertunda("retur", milik.filter((b) => b.langkah !== "batal" && b.langkah !== "cek").map((b) => b.id)),
  ]);
  return (
    <ReturSayaClient
      selisih={selisih.length > 0 ? <SelisihPerluDicek baris={selisih} /> : null}
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
