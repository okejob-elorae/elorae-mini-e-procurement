import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  bacaAturanShift,
  bacaBarangHilang,
  bacaDiskonManual,
  bacaKomisiPutus,
  bacaTitipPesan,
  bacaTutupHari,
  KUNCI_BARANG_HILANG,
  KUNCI_DISKON_MANUAL,
  KUNCI_KOMISI_PUTUS,
  KUNCI_SHIFT,
  KUNCI_TITIP_PESAN,
  KUNCI_TUTUP_HARI,
} from "@/lib/spg/pengaturan";
import { JudulPengaturanSpg } from "./JudulPengaturanSpg";
import { DiskonManualCard } from "./DiskonManualCard";
import { ShiftCard } from "./ShiftCard";
import { KomisiPutusCard } from "./KomisiPutusCard";
import { TitipPesanCard } from "./TitipPesanCard";
import { TutupHariCard } from "./TutupHariCard";
import { BarangHilangCard } from "./BarangHilangCard";

export const dynamic = "force-dynamic";

/**
 * Pengaturan → SPG: aturan kerja SPG di konter. Setiap kartu memakai izin
 * pemilik keputusannya — promo/diskon oleh pengelola promo, jadwal dan tutup
 * hari oleh pengelola toko, komisi oleh keuangan — tanpa izin baru.
 */
export default async function PengaturanSpgPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)) redirect("/backoffice/dashboard");

  const setelan = await prisma.systemSetting.findMany({
    where: { key: { in: [KUNCI_DISKON_MANUAL, KUNCI_SHIFT, KUNCI_KOMISI_PUTUS, KUNCI_TITIP_PESAN, KUNCI_TUTUP_HARI, KUNCI_BARANG_HILANG] } },
    select: { key: true, value: true },
  });
  const nilai = (kunci: string) => setelan.find((s) => s.key === kunci)?.value ?? null;

  return (
    <div className="space-y-6">
      <JudulPengaturanSpg />
      <DiskonManualCard bolehUbah={hasPermission(izin, PERMISSIONS.PROMOS_MANAGE)} nilai={bacaDiskonManual(nilai(KUNCI_DISKON_MANUAL))} />
      <TutupHariCard bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)} nilai={bacaTutupHari(nilai(KUNCI_TUTUP_HARI))} />
      <TitipPesanCard bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)} nilai={bacaTitipPesan(nilai(KUNCI_TITIP_PESAN))} />
      <ShiftCard bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)} nilai={bacaAturanShift(nilai(KUNCI_SHIFT))} />
      <KomisiPutusCard bolehUbah={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)} nilai={bacaKomisiPutus(nilai(KUNCI_KOMISI_PUTUS))} />
      <BarangHilangCard bolehUbah={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)} nilai={bacaBarangHilang(nilai(KUNCI_BARANG_HILANG))} />
    </div>
  );
}
