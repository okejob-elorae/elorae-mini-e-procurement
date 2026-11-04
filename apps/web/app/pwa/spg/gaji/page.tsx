import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { salesMonthLabelId } from "@/lib/spg-commission/payout";
import { payloadGajiHp } from "@/lib/spg/komisi-hp";
import { perkiraanKomisiHp, ringkasGajiSaya } from "@/lib/spg/komisi-queries";
import { tokoSpg } from "@/lib/spg/queries";
import { bebanTerbukaUntukPotong } from "@/lib/spg/hilang-potong";
import { GajiSpgClient } from "./GajiSpgClient";

export const dynamic = "force-dynamic";

/**
 * Gaji & komisi SPG di HP: gaji pokok dari jadwal / catatan check-in bulan itu dan komisi dari
 * potong yang SPG ini jual sendiri × tarif kategori bulan penjualan — hanya milik SPG yang membuka
 * layar (`payloadGajiHp`). Pembayaran yang belum dibayar memperlihatkan angka yang AKAN dibayar
 * kantor; yang menunggu dasar gajinya (P60) hanya menyebut sebabnya, tanpa rupiah. Beban barang
 * hilang dipotong penuh di pembayaran berikutnya, dari komisi dulu lalu gaji pokok (P11a).
 */
export default async function GajiSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");
  const [perkiraan, gaji, sisaHilang] = await Promise.all([
    perkiraanKomisiHp(session.user.id, toko, new Date()),
    ringkasGajiSaya(session.user.id, 6),
    bebanTerbukaUntukPotong(prisma, session.user.id),
  ]);
  // Nama bulan dan tanggal diformat DI SERVER — format di klien bisa berbeda
  // antara Node dan Safari, dan React menganggapnya hydration error.
  return (
    <GajiSpgClient
      {...payloadGajiHp({ perkiraan, resmi: gaji.resmi, koreksiMenunggu: gaji.koreksiMenunggu }, toko.termsType === "KONSI", {
        bulan: salesMonthLabelId,
        tanggal: (iso) => formatDisplayDate(iso),
        hari: (day) => formatDisplayDate(new Date(`${day}T00:00:00+07:00`)),
      })}
      bebanHilang={sisaHilang > 0 ? { sisa: sisaHilang } : null}
    />
  );
}
