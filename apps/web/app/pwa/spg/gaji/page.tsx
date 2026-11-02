import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { payloadGajiHp } from "@/lib/spg/komisi-hp";
import { komisiResmiSaya, perkiraanKomisiHp } from "@/lib/spg/komisi-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { bacaAturanHilang } from "@/lib/spg/hilang-db";
import { bebanTerbukaUntukPotong } from "@/lib/spg/hilang-potong";
import { GajiSpgClient } from "./GajiSpgClient";

export const dynamic = "force-dynamic";

/**
 * Gaji & komisi SPG di HP. Angkanya dari satu hitungan komisi untuk semua SPG — tarif per
 * kategori bulan penjualan × potong yang SPG ini jual sendiri — dan hanya milik SPG yang membuka
 * layar (`payloadGajiHp`).
 */
export default async function GajiSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const [perkiraan, resmi, sisaHilang, aturanHilang] = await Promise.all([
    perkiraanKomisiHp(session.user.id, toko, new Date()),
    komisiResmiSaya(session.user.id, 6),
    bebanTerbukaUntukPotong(prisma, session.user.id),
    bacaAturanHilang(prisma),
  ]);
  // Nama bulan dan tanggal diformat DI SERVER — format di klien bisa berbeda
  // antara Node dan Safari, dan React menganggapnya hydration error.
  return (
    <GajiSpgClient
      {...payloadGajiHp({ perkiraan, resmi }, toko.termsType === "KONSI", { bulan: salesMonthLabelId, tanggal: (iso) => formatDisplayDate(iso) })}
      bebanHilang={sisaHilang > 0 ? { sisa: sisaHilang, maksPotongPersen: aturanHilang.maksPotongPersen } : null}
    />
  );
}
