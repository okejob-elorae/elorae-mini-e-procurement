import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { bacaTanggalJadwal, geserHari, JANGKAUAN_HARI_HP, seninDari } from "@/lib/salesman/jadwal";
import { jadwalMinggu } from "@/lib/salesman/jadwal-queries";
import { JadwalClient, type DataJadwal } from "./JadwalClient";

export const dynamic = "force-dynamic";

/*
 * Tanggal diformat DI SERVER: format tanggal di klien bisa berbeda antara Node
 * dan Safari (hydration error). Bentuk Indonesia, seperti layar HP lain.
 */
const fmtHariPendek = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "Asia/Jakarta" });
const fmtPanjang = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta" });
const fmtPendek = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
const awal = (k: string) => new Date(`${k}T00:00:00+07:00`);

/**
 * Jadwal kunjungan dari kantor di HP — satu minggu, hari yang dipilih
 * (bawaan hari ini; tautan kabar membawa `?tanggal=`) paling atas, lalu
 * hari-hari sesudahnya, lalu yang sudah lewat. Tiap toko membawa catatan
 * kantor dan statusnya, dan menuju halaman toko.
 */
export default async function JadwalPage({ searchParams }: { searchParams: Promise<{ tanggal?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  // SPG bekerja di satu toko tetap — tidak ada jadwal kunjungan.
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");

  const sekarang = new Date();
  const hariIni = kunciHariWib(sekarang);
  const sp = await searchParams;
  const tanggal = bacaTanggalJadwal(sp.tanggal, sekarang);
  const senin = seninDari(tanggal);
  const minggu = await jadwalMinggu(session.user.id, senin, sekarang, { hanyaAktif: true });

  // Minggu tetangga hanya ditautkan bila masih di dalam jangkauan `?tanggal=`.
  const batasAwal = geserHari(hariIni, -JANGKAUAN_HARI_HP);
  const batasAkhir = geserHari(hariIni, JANGKAUAN_HARI_HP);
  const seninLalu = geserHari(senin, -7);
  const seninDepan = geserHari(senin, 7);
  const tautanHari = (k: string) => (k === hariIni ? "/pwa/jadwal" : `/pwa/jadwal?tanggal=${k}`);

  const data: DataJadwal = {
    tanggal,
    hariIni,
    rentang: `${fmtPendek.format(awal(senin))} – ${fmtPendek.format(awal(geserHari(senin, 6)))}`,
    mingguIni: seninDari(hariIni) === senin,
    sebelum: geserHari(seninLalu, 6) >= batasAwal ? tautanHari(seninLalu < batasAwal ? batasAwal : seninLalu) : null,
    sesudah: seninDepan <= batasAkhir ? tautanHari(seninDepan) : null,
    ringkas: minggu.ringkas,
    hari: minggu.hari.map((h) => ({
      dayKey: h.dayKey,
      hariPendek: fmtHariPendek.format(awal(h.dayKey)),
      tanggalAngka: String(Number(h.dayKey.slice(8))),
      labelPanjang: fmtPanjang.format(awal(h.dayKey)),
      href: tautanHari(h.dayKey),
      ringkas: h.ringkas,
      toko: h.toko.map((b) => ({
        storeId: b.storeId,
        nama: b.nama,
        alamat: b.alamat,
        area: b.area,
        catatan: b.catatan,
        status: b.status,
      })),
    })),
  };

  return <JadwalClient data={data} />;
}
