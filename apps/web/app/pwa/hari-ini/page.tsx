import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { awalHari, bacaTanggalHariIni, tujuhHariTerakhir } from "@/lib/salesman/metrik-lapangan";
import { kinerjaSatuSales } from "@/lib/salesman/metrik-queries";
import { HariIniClient, type DataHariIni } from "./HariIniClient";

export const dynamic = "force-dynamic";

/*
 * Jam dan tanggal diformat DI SERVER: format tanggal di klien bisa berbeda
 * antara Node dan Safari (hydration error). Bahasa aplikasi hanya diketahui
 * klien, jadi server memakai bentuk Indonesia seperti layar HP lain.
 */
const fmtJam = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const fmtHariPendek = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "Asia/Jakarta" });
const fmtTanggalPanjang = new Intl.DateTimeFormat("id-ID", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});
const jam = (d: Date | null) => (d ? fmtJam.format(d) : null);

/**
 * Ringkasan kerja salesman untuk satu hari (bawaan hari ini, bisa mundur enam
 * hari): angka kunjungan, pesanan dan pelunasan dalam bahasa sehari-hari, lalu
 * daftar kunjungan hari itu beserta hasilnya. Kabar "Ringkasan kerja" jam 18.30
 * membawa ke sini.
 */
export default async function HariIniPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // SPG: check-in mereka absensi di toko tetap, bukan kunjungan jualan.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const sekarang = new Date();
  const sp = await searchParams;
  const tanggal = bacaTanggalHariIni(sp.tanggal, sekarang);
  const pilihan = tujuhHariTerakhir(sekarang);
  const r = await kinerjaSatuSales(session.user.id, { dari: tanggal, sampai: tanggal }, { sekarang });
  if (!r) redirect("/login");

  const m = r.kinerja.metrik;
  const rencana = r.kinerja.rencana;
  const data: DataHariIni = {
    tanggal,
    hariIni: tanggal === pilihan[0],
    tanggalPanjang: fmtTanggalPanjang.format(awalHari(tanggal)),
    pilihan: pilihan.map((k, i) => ({
      kunci: k,
      hariPendek: fmtHariPendek.format(awalHari(k)),
      tanggalAngka: String(Number(k.slice(8))),
      hariIni: i === 0,
      // Hari ini tanpa parameter: alamatnya sama dengan tautan kabar.
      href: i === 0 ? "/pwa/hari-ini" : `/pwa/hari-ini?tanggal=${k}`,
    })),
    angka: {
      kunjungan: m.kunjungan,
      tokoDikunjungi: m.tokoDikunjungi,
      efektif: m.efektif,
      persenEfektif: m.persenEfektif,
      berlangsung: m.berlangsung,
      janggal: m.janggal,
      rencana: rencana ? { direncanakan: rencana.direncanakan, dikunjungi: rencana.dikunjungi } : null,
      pesanan: m.pesanan,
      van: m.van,
      pelunasan: m.pelunasan,
      retur: m.retur,
      tokoBaru: m.tokoBaru,
      lapangan: {
        menit: m.lapangan.menit,
        mulai: jam(m.lapangan.mulai),
        selesai: jam(m.lapangan.selesai),
        masihDiLapangan: m.berlangsung > 0 && tanggal === pilihan[0],
      },
    },
    hasil: m.hasil.perKode,
    perTanda: m.perTanda,
    kunjungan: r.kunjungan.map((k) => ({
      id: k.id,
      storeId: k.storeId,
      toko: k.toko,
      jamMasuk: fmtJam.format(k.checkinAt),
      jamKeluar: jam(k.checkoutAt),
      durasiMenit: k.durasiMenit,
      kodeHasil: k.kodeHasil,
      catatan: k.catatan,
      efektif: k.efektif,
      pesanan: k.pesanan,
      pesananDitolak: k.pesananDitolak,
      nilaiPutus: k.nilaiPutus,
      konsi: k.konsi,
      klaim: k.klaim,
      retur: k.retur,
      van: k.van,
      tanda: [...(k.diLuarRadius ? (["LUAR_RADIUS"] as const) : []), ...k.tanda.map((t) => t.kode)],
    })),
    // Toko yang dijadwalkan kantor sudah punya daftarnya sendiri di bawah — tidak diulang di sini.
    belumDidatangi: (rencana?.toko ?? [])
      .filter((t) => !t.dikunjungi && !r.jadwal.some((j) => j.storeId === t.storeId))
      .map((t) => ({ storeId: t.storeId, nama: t.nama, alasan: t.alasan })),
    tokoBaru: r.tokoBaru.map((t) => ({ storeId: t.storeId, nama: t.nama })),
    // Jadwal kantor hari itu: belum didatangi dulu.
    jadwal:
      r.jadwal.length > 0 && r.kinerja.jadwal
        ? {
            dikunjungi: r.kinerja.jadwal.dikunjungi,
            direncanakan: r.kinerja.jadwal.direncanakan,
            href: tanggal === pilihan[0] ? "/pwa/jadwal" : `/pwa/jadwal?tanggal=${tanggal}`,
            toko: [...r.jadwal]
              .sort((a, b) => Number(a.status === "DIKUNJUNGI") - Number(b.status === "DIKUNJUNGI"))
              .map((j) => ({ storeId: j.storeId, nama: j.nama, catatan: j.catatan, status: j.status })),
          }
        : null,
  };

  return <HariIniClient data={data} />;
}
