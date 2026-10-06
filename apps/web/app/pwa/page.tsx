import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hariIniWib } from "@/lib/tanggal-isian";
import { kembaliAman } from "@/lib/pwa/kembali-setelah-checkin";
import { getActiveVisit } from "@/lib/stores/queries";
import { ringkasanSpg, tokoSpg } from "@/lib/spg/queries";
import { prisma } from "@elorae/db";
import { shiftHariIni } from "@/lib/spg/shift-queries";
import { daftarTitipHp } from "@/lib/spg/titip-queries";
import { pengunjungUntukHp } from "@/lib/spg/pengunjung-queries";
import { hitungPesananDiproses, pesananMenujuToko } from "@/lib/spg/pesanan-menuju-toko";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { kemajuanTarget } from "@/lib/salesman/dasbor";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { berandaPenjualanHp, komisiUntukHp } from "@/lib/salesman/penjualan-hp-queries";
import { komisiBisaNaikOlehKonsi } from "@/lib/salesman/penjualan-hp";
import { absenBeranda } from "@/lib/salesman/absensi-queries";
import { ringkasTugasTagihSaya } from "@/lib/receivables/tugas-tagih-queries";
import { jumlahTargetRinci } from "@/lib/salesman/target-rinci-queries";
import { jadwalHariIniSales } from "@/lib/salesman/jadwal-queries";
import { kartuPengumumanBeranda } from "@/lib/pengumuman/queries";
import { catatanTersematPerToko } from "@/lib/stores/catatan-queries";
import { pengaturanSalesman, pesananSaya, tokoSaya } from "@/lib/salesman/queries";
import { tokoMenurunHp } from "@/lib/salesman/toko-menurun-queries";
import { HomeShell } from "./HomeShell";
import { SpgHomeShell, SpgTanpaToko, type DataBerandaSpg } from "./SpgHomeShell";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function PwaHome({ searchParams }: { searchParams: Promise<{ kembali?: string | string[] }> }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userName = session.user.name ?? session.user.email ?? "";

  /**
   * SPG is a fixed-store role (User.assignedStoreId) — detect it before
   * falling back to the roaming salesman home below. The lookup is shared
   * with the /pwa layout through React `cache`, so it costs one query per
   * request, not two.
   */
  const assignedStoreId = await ambilTokoTetap(session.user.id);

  if (assignedStoreId) {
    const sekarang = new Date();
    const [toko, active] = await Promise.all([tokoSpg(session.user.id), getActiveVisit(session.user.id)]);

    if (!toko) {
      /**
       * assignedStoreId is FK-free (relationMode=prisma) — the store could have
       * been deleted or the assignment misconfigured. Surface a clear dead-end
       * instead of a crash or silently falling through to the salesman home.
       */
      return <SpgTanpaToko userName={userName} onLogout={logout} />;
    }

    const hariKunci = kunciHariWib(sekarang);
    // Kartu tambahan SPG tahap 2 — masing-masing boleh gagal tanpa menjatuhkan beranda.
    const aman = <T,>(janji: Promise<T>, cadangan: T, nama: string) =>
      janji.catch((e) => {
        console.error(`[beranda] ${nama} gagal dimuat`, e);
        return cadangan;
      });
    const [r, pengumuman, shift, titip, tukarMasuk, sudahTutup, pengunjung, pesananDiproses] = await Promise.all([
      ringkasanSpg(session.user.id, toko, sekarang),
      kartuPengumumanBeranda(session.user.id, sekarang).catch((e) => {
        console.error("[beranda] pengumuman gagal dimuat", e);
        return null;
      }),
      aman(shiftHariIni(session.user.id, sekarang), null, "shift"),
      aman(daftarTitipHp(toko.id, sekarang).then((d) => d.datang.length), 0, "titip pesan"),
      aman(prisma.spgShiftSwap.count({ where: { partnerId: session.user.id, status: "MENUNGGU_REKAN" } }), 0, "tukar shift"),
      aman(
        prisma.spgDailyClose.findUnique({ where: { storeId_day: { storeId: toko.id, day: hariKunci } }, select: { id: true } }).then(Boolean),
        false,
        "tutup hari",
      ),
      aman(pengunjungUntukHp(session.user.id, toko.id, hariKunci), null, "pengunjung"),
      // Pesanan sales untuk toko ini yang masih diproses kantor — hitungan saja, rinciannya di Terima kiriman.
      aman(pesananMenujuToko(toko.id, sekarang).then(hitungPesananDiproses), 0, "pesanan menuju toko"),
    ]);
    // Pengingat tutup hari: sesudah jam 17.00 WIB, kalau toko sudah berjualan dan belum ada laporannya.
    const jamWib = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(sekarang));
    const disini = active && active.storeId === toko.id ? active : null;
    // `?kembali=` dari layar "check-in dulu" (opname, terima, jual): hanya
    // alamat /pwa/... yang diterima, dan hanya dipakai selama belum check-in.
    // Sengaja TIDAK dialihkan bila sudah check-in: sesudah check-in SPG
    // diteruskan ke layar itu, dan Kembali dari sana mendarat di alamat ini —
    // pengalihan akan melemparnya maju lagi, seolah tombol Kembali rusak.
    const kembali = disini ? null : kembaliAman((await searchParams).kembali);
    // Jam dan tanggal diformat DI SERVER: format tanggal di klien bisa berbeda
    // antara Node dan Safari, dan React menganggapnya hydration error.
    const jam = (d: Date | string) =>
      new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(d));
    const resmi = r.gajiKomisi.resmi[0] ?? null;

    const data: DataBerandaSpg = {
      toko: {
        id: toko.id,
        name: toko.name,
        code: toko.code,
        address: toko.address,
        mapsUrl: toko.lat !== null && toko.lng !== null ? `https://www.google.com/maps?q=${toko.lat},${toko.lng}` : null,
      },
      kunjungan: disini
        ? {
            id: disini.id,
            // Check-in yang dibiarkan terbuka dari hari lain menyebut tanggalnya —
            // "Masuk pukul 15.59" saja terbaca seperti hari ini.
            lama: hariIniWib(new Date(disini.checkinAt)) !== hariIniWib(),
            jamMasuk:
              hariIniWib(new Date(disini.checkinAt)) !== hariIniWib()
                ? new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(disini.checkinAt))
                : jam(disini.checkinAt),
            diLuarRadius: disini.checkinOutOfRadius,
            jarak: disini.checkinDistanceMeters,
          }
        : null,
      tokoLainTerbuka: active && active.storeId !== toko.id ? active.store.name : null,
      hariIniLabel: new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Jakarta" }).format(sekarang),
      hariIni: r.hariIni,
      bulanIni: {
        total: r.bulanIni.total,
        target: r.bulanIni.target,
        persen: r.bulanIni.target ? Math.round((r.bulanIni.total / r.bulanIni.target) * 100) : null,
      },
      hariMasuk: r.hariMasukBulanIni,
      terlaris: r.terlaris.map((b) => ({ kunci: `${b.itemId}::${b.variantSku}`, nama: b.nama, qty: b.qty })),
      hampirHabis: r.hampirHabis.length,
      stokDilacak: r.stokDilacak,
      kirimanMenunggu: r.kirimanMenunggu,
      pesananDiproses,
      notaHariIni: r.notaHariIni.map((n) => ({ id: n.id, docNo: n.docNo, jam: jam(n.waktu), total: n.total, jumlahBarang: n.jumlahBarang })),
      gaji: {
        perkiraan: r.gajiKomisi.perkiraan ? { totalToko: r.gajiKomisi.perkiraan.totalToko, bagianSaya: r.gajiKomisi.perkiraan.bagianSaya } : null,
        terakhir: resmi ? { periode: resmi.periode, total: resmi.total, dibayar: resmi.dibayar !== null } : null,
      },
      pengumuman,
      shift,
      titipDatang: titip,
      tukarMasuk,
      tutupPerlu: r.hariIni.nota > 0 && !sudahTutup && jamWib >= 17,
      pengunjung,
      userId: session.user.id,
    };

    return <SpgHomeShell userName={userName} data={data} kembali={kembali} />;
  }

  const hariIni = new Date();
  const salesmanId = session.user.id;
  const [active, jual, pesanan, toko, atur] = await Promise.all([
    getActiveVisit(salesmanId),
    // "Bulan ini" + grafik 60 hari untuk HP: rupiah putus + van, konsinyasi
    // hanya pcs. Rupiah konsi tidak pernah dikirim ke HP (aturan mutlak pemilik).
    berandaPenjualanHp(salesmanId, hariIni),
    pesananSaya(salesmanId, hariIni),
    // Toko menurun dinilai atas "toko saya" yang sama dengan rencana kunjungan,
    // jadi menunggu daftar itu — tetap sejalan dengan kueri lainnya. Bentuk HP:
    // tanpa rupiah; rasionya hanya untuk toko tanpa nilai konsinyasi (rasio total yang
    // memuat konsi membukanya begitu jendela lain berisi rupiah yang salesman tahu).
    tokoSaya(salesmanId, hariIni).then(async (t) => ({
      ...t,
      menurun: await tokoMenurunHp(t.rencana.map((r) => ({ storeId: r.storeId, nama: r.nama })), hariIni),
    })),
    pengaturanSalesman(salesmanId, hariIni),
  ]);

  const bulan = bulanWib(hariIni);
  const { bulanIni, tren } = jual;

  // Perkiraan komisi memakai omzet dan target yang SAMA dengan kartu "Bulan ini"
  // di atasnya (putus + van), supaya kedua kartu tidak pernah berbeda angka dan
  // tidak ada angka turunan yang membuka rupiah konsi. Kartu sekunder: kalau
  // kuerinya gagal, beranda tetap tampil tanpa kartu ini.
  const [komisi, absen, tugasTagih, jumlahTarget, jadwal, pengumuman] = await Promise.all([
    komisiUntukHp(salesmanId, bulan, { omzet: bulanIni, target: atur.target }).catch((e) => {
      console.error("[beranda] perkiraan komisi gagal dimuat", e);
      return null;
    }),
    // Kartu absen: null kalau absensi dimatikan kantor dan hari ini belum ada catatan.
    absenBeranda(salesmanId, hariIni).catch((e) => {
      console.error("[beranda] kartu absen gagal dimuat", e);
      return null;
    }),
    // Tugas tagih dari kantor: baris di "Tugas hari ini"; kalau gagal dimuat, barisnya tidak tampil.
    ringkasTugasTagihSaya(salesmanId).catch((e) => {
      console.error("[beranda] tugas tagih gagal dimuat", e);
      return { perluDitagih: 0, terlambat: 0 };
    }),
    jumlahTargetRinci(salesmanId, bulan).catch(() => 0),
    // Jadwal kantor hari ini: paling atas di "Rencana kunjungan". Gagal → kartu tampil tanpanya.
    jadwalHariIniSales(salesmanId, hariIni).catch((e) => {
      console.error("[beranda] jadwal kantor gagal dimuat", e);
      return [];
    }),
    kartuPengumumanBeranda(salesmanId, hariIni).catch((e) => {
      console.error("[beranda] pengumuman gagal dimuat", e);
      return null;
    }),
  ]);
  // Catatan tersemat (mis. "pemilik hanya ada sore hari") di baris rencana kunjungan.
  const tersemat = await catatanTersematPerToko([...toko.rencana.map((r) => r.storeId), ...jadwal.map((j) => j.storeId)]).catch(
    () => new Map<string, { teks: string }>(),
  );

  return (
    <HomeShell
      userName={userName}
      dimuatPada={hariIni.toISOString()}
      activeVisit={active ? {
        id: active.id,
        storeId: active.storeId,
        storeName: active.store.name,
        storeTermsType: active.store.termsType,
        checkinAt: active.checkinAt.toISOString(),
      } : null}
      data={{
        bulanIni,
        // Capaian atas putus + van: capaian dengan konsi × target − putus − van = konsi.
        kemajuan: kemajuanTarget(atur.target, bulanIni.total, hariIni),
        tren,
        pesanan,
        rencana: toko.rencana.map((x) => ({
          ...x,
          kunjunganTerakhir: x.kunjunganTerakhir ? x.kunjunganTerakhir.toISOString() : null,
        })),
        tagih: toko.tagih,
        menurun: toko.menurun,
        batas: atur.batas,
        insentif:
          komisi && komisi.hasil.aktif
            ? {
                komisi: komisi.hasil.komisi,
                dasar: komisi.hasil.dasar,
                dasarNilai: komisi.hasil.dasarNilai,
                tarifDipakai: komisi.hasil.tarifDipakai,
                tingkatBerikut: komisi.hasil.tingkatBerikut,
                // Kalimat "final bisa lebih tinggi" hanya bila konsi memang bisa mengubah komisinya.
                konsiBelumDihitung: komisiBisaNaikOlehKonsi({
                  pcsKonsi: bulanIni.pcsKonsi,
                  dasar: komisi.hasil.dasar,
                  tingkatBerikut: komisi.hasil.tingkatBerikut,
                }),
              }
            : null,
        absen,
        tugasTagih,
        adaTargetRinci: jumlahTarget > 0,
        jadwal: jadwal.map((j) => ({ storeId: j.storeId, nama: j.nama, catatan: j.catatan, lat: j.lat, lng: j.lng, dikunjungi: j.dikunjungi })),
        pengumuman,
        catatanTersemat: Object.fromEntries([...tersemat].map(([id, c]) => [id, c.teks])),
      }}
    />
  );
}
