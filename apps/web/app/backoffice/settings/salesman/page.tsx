import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  bacaBatasHari,
  bacaTargetSemua,
  bacaTokoTerkunci,
  bulanWib,
  KUNCI_BATAS_HARI,
  KUNCI_TARGET,
  KUNCI_TOKO_TERKUNCI,
} from "@/lib/salesman/pengaturan";
import { daftarSalesman, daftarSpg, penjualanSalesman } from "@/lib/salesman/queries";
import { bacaAturanKredit, KUNCI_ATURAN_KREDIT } from "@/lib/salesman/kredit";
import { PengaturanSalesmanClient } from "./PengaturanSalesmanClient";
import { PembagianTokoCard } from "./PembagianTokoCard";
import { KreditTokoCard } from "./KreditTokoCard";
import {
  bacaAturanCheckin,
  bacaAturanHasilKunjungan,
  KUNCI_ATURAN_CHECKIN,
  KUNCI_HASIL_KUNJUNGAN,
  KUNCI_RADIUS_GLOBAL,
} from "@/lib/salesman/aturan-kunjungan";
import { parseRadiusSetting } from "@/lib/pwa/checkin-radius";
import { AturanKunjunganCard } from "./AturanKunjunganCard";
import { AturanCheckinCard } from "./AturanCheckinCard";
import { bacaAturanKelasToko, KUNCI_KELAS_TOKO } from "@/lib/stores/kelas-toko";
import { jumlahTokoPerKelas } from "@/lib/stores/queries";
import { KelasTokoCard } from "./KelasTokoCard";
import { KomisiCard } from "./KomisiCard";
import { dataKartuKomisi } from "@/lib/salesman/komisi-queries";
import { KUNCI_MIN_PERTAMA, KUNCI_MIN_ULANG } from "@/lib/field-sales/minimum-pesanan";
import { KUNCI_JARAK_JAUH } from "@/lib/field-sales/jarak-jauh";
import { bacaPengaturanBiaya, KUNCI_PENGATURAN_BIAYA } from "@/lib/salesman/biaya";
import { bacaPengaturanAbsensi, KUNCI_PENGATURAN_ABSENSI } from "@/lib/salesman/absensi";
import { MinimumPesananCard } from "./MinimumPesananCard";
import { PesananJarakJauhCard } from "./PesananJarakJauhCard";
import { BiayaCard } from "./BiayaCard";
import { AbsensiCard } from "./AbsensiCard";
import { HariKerjaSpgCard } from "./HariKerjaSpgCard";
import { bacaHariKerjaSpg, KUNCI_HARI_KERJA_SPG } from "@/lib/salesman/izin";
import { KUNCI_PORTAL_TOKO } from "@/lib/field-sales/portal-toko-aturan";
import { PortalTokoCard } from "./PortalTokoCard";
import { KUNCI_ATURAN_MUTASI } from "@/lib/spg/mutasi-aturan";
import { AturanMutasiCard } from "./AturanMutasiCard";

export const dynamic = "force-dynamic";

/**
 * Pengaturan → Salesman: batas hari kunjungan, target bulanan, dan toko yang
 * ditugaskan per salesman.
 *
 * "Salesman" = pengguna yang perannya membuka aplikasi HP (`pwa:access`), bukan
 * peran sistem (admin), dan tidak ditugaskan tetap di satu toko (itu SPG).
 * SPG ikut tabel target (keputusan pemilik: target per orang) tapi TIDAK ikut
 * pembagian toko — tokonya sudah tetap.
 */
export default async function PengaturanSalesmanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_VIEW))
    redirect("/backoffice/dashboard");

  const hariIni = new Date();
  const bulanIni = bulanWib(hariIni);
  const awalBulan = new Date(`${bulanIni}-01T00:00:00+07:00`);
  const bulanDepan = bulanWib(new Date(awalBulan.getTime() + 32 * 86_400_000));

  const [salesman, spg, setelan, toko, tokoBatasSendiri, jumlahPerKelas, komisi] = await Promise.all([
    daftarSalesman(),
    daftarSpg(),
    prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            KUNCI_BATAS_HARI,
            KUNCI_TARGET,
            KUNCI_TOKO_TERKUNCI,
            KUNCI_ATURAN_KREDIT,
            KUNCI_HASIL_KUNJUNGAN,
            KUNCI_ATURAN_CHECKIN,
            KUNCI_RADIUS_GLOBAL,
            KUNCI_KELAS_TOKO,
            KUNCI_MIN_PERTAMA,
            KUNCI_MIN_ULANG,
            KUNCI_JARAK_JAUH,
            KUNCI_PENGATURAN_BIAYA,
            KUNCI_PENGATURAN_ABSENSI,
            KUNCI_HARI_KERJA_SPG,
            KUNCI_PORTAL_TOKO,
            KUNCI_ATURAN_MUTASI,
          ],
        },
      },
      select: { key: true, value: true },
    }),
    // Hanya toko aktif: toko nonaktif tidak didatangi siapa pun, jadi tidak
    // ikut dihitung sebagai "belum punya sales".
    prisma.store.findMany({
      where: { isActive: true },
      select: { salesmanId: true, group: { select: { code: true } } },
    }),
    // Toko PUTUS aktif yang batas kreditnya menimpa bawaan — supaya pemilik
    // tahu batas bawaan tidak berlaku untuk semua toko.
    prisma.store.count({
      where: {
        isActive: true,
        termsType: "PUTUS",
        OR: [{ creditLimit: { not: null } }, { maxOpenInvoices: { not: null } }],
      },
    }),
    jumlahTokoPerKelas(),
    dataKartuKomisi(),
  ]);
  const ringkasan = salesman.map((s) => {
    const milik = toko.filter((t) => t.salesmanId === s.id);
    const area = [...new Set(milik.map((t) => t.group?.code).filter((c): c is string => Boolean(c)))].sort();
    return { id: s.id, nama: s.nama, jumlah: milik.length, area };
  });
  const nilai = (k: string) => setelan.find((s) => s.key === k)?.value ?? null;

  // Pencapaian bulan ini per salesman, dengan definisi yang sama persis dengan
  // dasbor HP-nya — supaya angka di sini dan di HP salesman tidak pernah berbeda.
  const capai = Object.fromEntries(
    await Promise.all(
      salesman.map(
        async (s) =>
          [
            s.id,
            (await penjualanSalesman(s.id, awalBulan)).reduce(
              (n, b) => n + b.nilai,
              0,
            ),
          ] as const,
      ),
    ),
  );

  // Pencapaian SPG = jumlah nota penjualan yang ia catat bulan ini (kalender
  // WIB) — definisi yang sama dengan beranda HP SPG. Satu kueri untuk semua SPG.
  const capaiSpg = new Map<string, number>();
  if (spg.length > 0) {
    const grup = await prisma.spgSale.groupBy({
      by: ["salesmanId"],
      where: { salesmanId: { in: spg.map((s) => s.id) }, createdAt: { gte: awalBulan } },
      _sum: { total: true },
    });
    for (const g of grup) capaiSpg.set(g.salesmanId, Number(g._sum.total ?? 0));
  }

  const bolehUbah = hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  return (
    <div className="space-y-6">
      <PengaturanSalesmanClient
        bolehUbah={bolehUbah}
        batas={bacaBatasHari(nilai(KUNCI_BATAS_HARI))}
        bulan={[
          {
            kunci: bulanIni,
            target: bacaTargetSemua(nilai(KUNCI_TARGET), bulanIni),
          },
          {
            kunci: bulanDepan,
            target: bacaTargetSemua(nilai(KUNCI_TARGET), bulanDepan),
          },
        ]}
        salesman={salesman.map((s) => ({
          id: s.id,
          nama: s.nama,
          capai: capai[s.id] ?? 0,
        }))}
        spg={spg.map((s) => ({
          id: s.id,
          nama: s.nama,
          tokoNama: s.tokoNama,
          capai: capaiSpg.get(s.id) ?? 0,
        }))}
      />
      <PembagianTokoCard
        bolehUbah={bolehUbah}
        terkunci={bacaTokoTerkunci(nilai(KUNCI_TOKO_TERKUNCI))}
        tanpaPemegang={toko.filter((t) => t.salesmanId === null).length}
        ringkasan={ringkasan}
      />
      <KreditTokoCard
        bolehUbah={bolehUbah}
        aturan={bacaAturanKredit(nilai(KUNCI_ATURAN_KREDIT))}
        tokoBatasSendiri={tokoBatasSendiri}
      />
      <AturanKunjunganCard bolehUbah={bolehUbah} aturan={bacaAturanHasilKunjungan(nilai(KUNCI_HASIL_KUNJUNGAN))} />
      <AturanCheckinCard
        bolehUbah={bolehUbah}
        aturan={bacaAturanCheckin(nilai(KUNCI_ATURAN_CHECKIN))}
        radiusMeter={parseRadiusSetting(nilai(KUNCI_RADIUS_GLOBAL))}
      />
      <KelasTokoCard bolehUbah={bolehUbah} aturan={bacaAturanKelasToko(nilai(KUNCI_KELAS_TOKO))} jumlah={jumlahPerKelas} />
      <KomisiCard bolehUbah={bolehUbah} {...komisi} />
      <MinimumPesananCard
        bolehUbah={bolehUbah}
        nilaiPertama={nilai(KUNCI_MIN_PERTAMA)}
        nilaiUlang={nilai(KUNCI_MIN_ULANG)}
      />
      <PesananJarakJauhCard bolehUbah={bolehUbah} nilai={nilai(KUNCI_JARAK_JAUH)} />
      <PortalTokoCard bolehUbah={bolehUbah} nilai={nilai(KUNCI_PORTAL_TOKO)} />
      <AturanMutasiCard bolehUbah={bolehUbah} nilai={nilai(KUNCI_ATURAN_MUTASI)} />
      <BiayaCard bolehUbah={bolehUbah} pengaturan={bacaPengaturanBiaya(nilai(KUNCI_PENGATURAN_BIAYA))} />
      <AbsensiCard bolehUbah={bolehUbah} pengaturan={bacaPengaturanAbsensi(nilai(KUNCI_PENGATURAN_ABSENSI))} />
      <HariKerjaSpgCard bolehUbah={bolehUbah} hariKerja={bacaHariKerjaSpg(nilai(KUNCI_HARI_KERJA_SPG))} />
    </div>
  );
}
