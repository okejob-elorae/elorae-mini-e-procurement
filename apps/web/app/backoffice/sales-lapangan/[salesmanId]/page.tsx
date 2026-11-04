import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { alamatPelunasanKinerja, alamatPesananKinerja } from "@/lib/field-sales/saringan-kinerja";
import { bolehMembacaPelunasan } from "@/lib/receivables/izin";
import type { TandaCheckin } from "@/lib/salesman/checkin-janggal";
import { bacaRentang } from "@/lib/salesman/metrik-lapangan";
import { kinerjaSatuSales } from "@/lib/salesman/metrik-queries";
import { keAngka, labelRentang, paramRentang } from "../bentuk";
import { RincianSalesClient, type TandaRincian } from "./RincianSalesClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ salesmanId: string }>;
  searchParams: Promise<{ rentang?: string | string[]; dari?: string | string[]; sampai?: string | string[] }>;
};

const URUT_STATUS = { TERLEWAT: 0, MENUNGGU: 1, DIKUNJUNGI: 2, IZIN: 3 } as const;

const fmtJam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/** Rincian tanda untuk layar — angka saja, kalimatnya dari terjemahan. */
function rincianTanda(t: TandaCheckin): TandaRincian {
  switch (t.kode) {
    case "AKURASI_BURUK":
      return { kode: t.kode, param: { akurasi: t.akurasiMeter, batas: t.batasMeter } };
    case "LOMPATAN_MUSTAHIL":
      return {
        kode: t.kode,
        param: { jarak: (t.jarakMeter / 1000).toFixed(1).replace(".", ","), menit: t.menit },
      };
    case "KOORDINAT_KEMBAR":
      return { kode: t.kode, param: { toko: t.namaToko ?? "—" } };
    default:
      return { kode: t.kode, param: {} };
  }
}

/**
 * Rincian satu sales di dasbor Kinerja Sales Lapangan: angka yang sama dengan
 * barisnya di tabel, rencana vs realisasi toko per toko, dan setiap kunjungan
 * dengan hasil, transaksi, tanda check-in dan tautan peta titik check-in.
 */
export default async function RincianSalesPage({ params, searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_VIEW)) redirect("/backoffice");

  const [{ salesmanId }, sp] = await Promise.all([params, searchParams]);
  const sekarang = new Date();
  const { preset, rentang } = bacaRentang(sp, sekarang);
  const r = await kinerjaSatuSales(salesmanId, rentang, { sekarang });
  if (!r) notFound();

  const q = paramRentang(preset, rentang);
  const beberapaHari = rentang.dari !== rentang.sampai;
  const { kinerja } = r;

  return (
    <RincianSalesClient
      nama={kinerja.nama}
      kembali={`/backoffice/sales-lapangan?${q}`}
      alamat={`/backoffice/sales-lapangan/${encodeURIComponent(salesmanId)}`}
      filter={{ preset, dari: rentang.dari, sampai: rentang.sampai, label: labelRentang(rentang) }}
      angka={keAngka(kinerja.metrik, kinerja)}
      hasil={kinerja.metrik.hasil.perKode}
      perTanda={kinerja.metrik.perTanda}
      rencana={kinerja.rencana?.toko ?? []}
      tokoBaru={r.tokoBaru}
      // Jadwal kantor: belum didatangi dulu (terlewat, lalu menunggu), lalu urut hari.
      jadwal={[...r.jadwal]
        .sort((a, b) => URUT_STATUS[a.status] - URUT_STATUS[b.status] || (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0))
        .map((j) => ({ ...j, tanggal: formatDisplayDate(new Date(`${j.dayKey}T00:00:00+07:00`)) }))}
      alamatJadwal={`/backoffice/jadwal-kunjungan?sales=${encodeURIComponent(salesmanId)}&minggu=${rentang.sampai}`}
      // Pesanan: rentang + sales + menunggu/disetujui, sama dengan angka kartunya. Pelunasan:
      // BKM terverifikasi dalam rentang (tanggal verifikasi, hari WIB) dicari dengan nama
      // sales — hanya untuk yang boleh membukanya.
      tautan={{
        kunjungan: "#kunjungan",
        pesanan: alamatPesananKinerja(rentang, salesmanId),
        pelunasan: bolehMembacaPelunasan(session.user.permissions)
          ? alamatPelunasanKinerja(rentang, kinerja.nama)
          : undefined,
      }}
      // Target dibaca per bulan WIB: bulan hari terakhir rentang.
      alamatTarget={`/backoffice/target-sales?bulan=${rentang.sampai.slice(0, 7)}`}
      kunjungan={r.kunjungan.map((k) => ({
        id: k.id,
        storeId: k.storeId,
        toko: k.toko,
        kodeToko: k.kodeToko,
        tanggal: beberapaHari ? formatDisplayDate(k.checkinAt) : null,
        jamMasuk: fmtJam.format(k.checkinAt),
        jamKeluar: k.checkoutAt ? fmtJam.format(k.checkoutAt) : null,
        durasiMenit: k.durasiMenit,
        ditutupOtomatis: k.ditutupOtomatis,
        kodeHasil: k.kodeHasil,
        catatan: k.catatan,
        efektif: k.efektif,
        pesanan: k.pesanan,
        pesananDitolak: k.pesananDitolak,
        nilaiPutus: k.nilaiPutus,
        konsi: k.konsi,
        klaim: k.klaim,
        nilaiKlaim: k.nilaiKlaim,
        retur: k.retur,
        van: k.van,
        nilaiVan: k.nilaiVan,
        jarakMeter: k.jarakMeter,
        tanda: [
          ...(k.diLuarRadius ? [{ kode: "LUAR_RADIUS" as const, param: { jarak: k.jarakMeter ?? "?" } }] : []),
          ...k.tanda.map(rincianTanda),
        ],
        peta: `https://www.google.com/maps?q=${k.lat},${k.lng}`,
      }))}
    />
  );
}
