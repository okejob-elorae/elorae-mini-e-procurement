import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { payloadGajiHp } from "@/lib/spg/komisi-hp";
import { gajiKomisiSpg, tokoSpg } from "@/lib/spg/queries";
import { bacaAturanHilang } from "@/lib/spg/hilang-db";
import { bebanTerbukaUntukPotong } from "@/lib/spg/hilang-potong";
import { GajiSpgClient } from "./GajiSpgClient";

export const dynamic = "force-dynamic";

export default async function GajiSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const [g, sisaHilang, aturanHilang] = await Promise.all([
    gajiKomisiSpg(session.user.id, toko, new Date()),
    bebanTerbukaUntukPotong(prisma, session.user.id),
    bacaAturanHilang(prisma),
  ]);
  // Nama bulan dan tanggal diformat DI SERVER — format di klien bisa berbeda
  // antara Node dan Safari, dan React menganggapnya hydration error.
  const namaBulan = (periode: string) =>
    new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${periode}-01T00:00:00Z`));
  return (
    <GajiSpgClient
      {...payloadGajiHp(g, toko.termsType === "KONSI", { bulan: namaBulan, tanggal: (iso) => formatDisplayDate(iso) })}
      bebanHilang={sisaHilang > 0 ? { sisa: sisaHilang, maksPotongPersen: aturanHilang.maksPotongPersen } : null}
    />
  );
}
