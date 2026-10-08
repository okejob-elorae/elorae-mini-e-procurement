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
import { JudulKelompok } from "../DaftarIsiPengaturan";
import { DiskonManualCard } from "./DiskonManualCard";
import { ShiftCard } from "./ShiftCard";
import { KomisiPutusCard } from "./KomisiPutusCard";
import { TitipPesanCard } from "./TitipPesanCard";
import { TutupHariCard } from "./TutupHariCard";
import { BarangHilangCard } from "./BarangHilangCard";
// Dua kartu SPG ini dulu ada di Pengaturan → Salesman; tetap memakai izin yang sama (penyetuju pesanan).
import { AturanMutasiCard } from "../salesman/AturanMutasiCard";
import { HariKerjaSpgCard } from "../salesman/HariKerjaSpgCard";
import { KUNCI_ATURAN_MUTASI } from "@/lib/spg/mutasi-aturan";
import { bacaHariKerjaSpg, KUNCI_HARI_KERJA_SPG } from "@/lib/salesman/izin";

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
    where: {
      key: {
        in: [
          KUNCI_DISKON_MANUAL,
          KUNCI_SHIFT,
          KUNCI_KOMISI_PUTUS,
          KUNCI_TITIP_PESAN,
          KUNCI_TUTUP_HARI,
          KUNCI_BARANG_HILANG,
          KUNCI_ATURAN_MUTASI,
          KUNCI_HARI_KERJA_SPG,
        ],
      },
    },
    select: { key: true, value: true },
  });
  const nilai = (kunci: string) => setelan.find((s) => s.key === kunci)?.value ?? null;

  // Urutan kartu = urutan daftar isi (`daftar-isi.ts`); setiap kartu punya jangkar.
  const jangkar = "scroll-mt-6";
  return (
    <div className="space-y-6">
      <JudulPengaturanSpg bolehBukaTarget={hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)} />

      <JudulKelompok kunci="settings.spg.toc.konter" />
      <div id="diskon-manual" className={jangkar}>
        <DiskonManualCard bolehUbah={hasPermission(izin, PERMISSIONS.PROMOS_MANAGE)} nilai={bacaDiskonManual(nilai(KUNCI_DISKON_MANUAL))} />
      </div>
      <div id="tutup-hari" className={jangkar}>
        <TutupHariCard bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)} nilai={bacaTutupHari(nilai(KUNCI_TUTUP_HARI))} />
      </div>
      <div id="titip-pesan" className={jangkar}>
        <TitipPesanCard bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)} nilai={bacaTitipPesan(nilai(KUNCI_TITIP_PESAN))} />
      </div>

      <JudulKelompok kunci="settings.spg.toc.jadwal" />
      <div id="shift" className={jangkar}>
        <ShiftCard bolehUbah={hasPermission(izin, PERMISSIONS.STORES_MANAGE)} nilai={bacaAturanShift(nilai(KUNCI_SHIFT))} />
      </div>
      <div id="hari-kerja" className={jangkar}>
        <HariKerjaSpgCard
          bolehUbah={hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)}
          hariKerja={bacaHariKerjaSpg(nilai(KUNCI_HARI_KERJA_SPG))}
        />
      </div>

      <JudulKelompok kunci="settings.spg.toc.komisiBeban" />
      <div id="komisi-putus" className={jangkar}>
        <KomisiPutusCard bolehUbah={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)} nilai={bacaKomisiPutus(nilai(KUNCI_KOMISI_PUTUS))} />
      </div>
      <div id="barang-hilang" className={jangkar}>
        <BarangHilangCard bolehUbah={hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE)} nilai={bacaBarangHilang(nilai(KUNCI_BARANG_HILANG))} />
      </div>

      <JudulKelompok kunci="settings.spg.toc.stok" />
      <div id="mutasi" className={jangkar}>
        <AturanMutasiCard bolehUbah={hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)} nilai={nilai(KUNCI_ATURAN_MUTASI)} />
      </div>
    </div>
  );
}
