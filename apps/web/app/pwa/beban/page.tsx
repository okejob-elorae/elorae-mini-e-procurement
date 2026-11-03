import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bebanSaya } from "@/lib/receivables/pwa-queries";
import { bacaAturanHilang } from "@/lib/spg/hilang-db";
import { bebanHilangSaya } from "@/lib/spg/hilang-queries";
import { bebanSpgSaya } from "@/lib/spg/beban-spg-queries";
import { BebanSayaClient } from "./BebanSayaClient";
import type { BebanReturPembeliTampil } from "./BebanReturPembeliBagian";

/** "2026-10" → label bulan untuk kedua bahasa, diformat DI SERVER (format di klien bisa berbeda antara Node dan Safari). */
function labelBulan(bulan: string): { id: string; en: string } {
  const tanggal = new Date(`${bulan}-01T00:00:00Z`);
  if (!/^\d{4}-\d{2}$/.test(bulan) || Number.isNaN(tanggal.getTime())) return { id: bulan, en: bulan };
  const opsi = { month: "long", year: "numeric", timeZone: "UTC" } as const;
  return { id: tanggal.toLocaleDateString("id-ID", opsi), en: tanggal.toLocaleDateString("en-GB", opsi) };
}

export const dynamic = "force-dynamic";

/**
 * Beban saya: selisih retur dan barang hilang yang ditetapkan kantor ke orang
 * yang masuk (sales atau SPG), dan — untuk SPG — beban retur pembeli yang
 * ditolak padahal uangnya sudah dikembalikan kasir (P13a). Hanya bagian miliknya sendiri.
 */
export default async function BebanSayaPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");

  const userId = session.user.id;
  const [baris, hilang, aturan, tokoTetap, returPembeli] = await Promise.all([
    bebanSaya(userId),
    bebanHilangSaya(userId),
    bacaAturanHilang(prisma),
    ambilTokoTetap(userId),
    bebanSpgSaya(userId),
  ]);
  const bebanRetur: BebanReturPembeliTampil[] = returPembeli.map((b) => ({
    ...b,
    potongan: b.potongan.map((p) => ({ ...p, bulanLabel: labelBulan(p.bulan) })),
    kembali: b.kembali ? { ...b.kembali, bulanLabel: b.kembali.bulan ? labelBulan(b.kembali.bulan) : null } : null,
  }));

  return (
    <BebanSayaClient
      baris={baris}
      hilang={hilang}
      bebanReturPembeli={bebanRetur}
      maksPotongPersen={aturan.maksPotongPersen}
      // SPG: beban barang hilang dipotong penuh (P11a), bukan dicicil berbatas persen.
      hilangPenuh={tokoTetap !== null}
      cadangan={tokoTetap ? "/pwa/spg/lainnya" : "/pwa/lainnya"}
    />
  );
}
