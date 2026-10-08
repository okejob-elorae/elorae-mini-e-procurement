import cron from "node-cron";
import { runCheckOverdue } from "./check-overdue";
import { runReconciliationCron } from "@/app/actions/stock-reconciliation";
import { postPendingSalesJournals, GL_CUTOVER_SETTING_KEY } from "@/lib/finance/sales/sweep";
import { sapuFotoYatim } from "@/lib/foto/pembersih";
import { ingatkanGiroJatuhTempo } from "@/lib/receivables/giro-queries";
import { kirimRingkasanHarian } from "@/lib/salesman/ringkasan-harian";
import { kirimPengumumanTerjadwal } from "@/lib/pengumuman/writer";
import { ingatkanMutasiMacet, kabarkanKirimanMenunggu } from "@/lib/spg/mutasi-pengingat";
import { ingatkanTutupHari } from "@/lib/spg/tutup-hari-pengingat";
import { susunAntrean as susunAntreanPantau } from "@/lib/creative/pantau-writer";

let registered = false;

export function registerCronJobs(): void {
  if (registered) return;
  registered = true;

  // Daily 09:00 Asia/Jakarta
  cron.schedule(
    "0 9 * * *",
    async () => {
      console.log("[cron] check-overdue tick");
      try {
        await runCheckOverdue();
      } catch (err) {
        console.error("[cron] check-overdue failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  // Every 6 hours — Jubelio stock reconciliation
  cron.schedule(
    "0 */6 * * *",
    async () => {
      console.log("[cron] reconciliation tick");
      try {
        await runReconciliationCron();
      } catch (err) {
        console.error("[cron] reconciliation failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  // Every 5 minutes — post sales revenue + COGS journals for shipped orders
  cron.schedule(
    "*/5 * * * *",
    async () => {
      console.log("[cron] sales-journal tick");
      try {
        const r = await postPendingSalesJournals();
        /*
         * `NO_CUTOVER` is logged rather than passed over in silence: it means the
         * sweep is inert by configuration, not that the backlog is empty, and an
         * unset or malformed cutover date would otherwise look identical to a
         * healthy idle tick for as long as it stayed wrong.
         */
        if (r.skipped === "NO_CUTOVER") {
          console.warn(
            `[cron] sales-journal: inert — ${GL_CUTOVER_SETTING_KEY} is unset or not a valid YYYY-MM-DD date, so no sales journals will post`,
          );
        } else if (r.posted > 0 || r.pending > 0) {
          console.log(`[cron] sales-journal: +${r.revenue} rev, +${r.cogs} cogs, ${r.pending} pending`);
        }
      } catch (err) {
        console.error("[cron] sales-journal failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Tanggal 1 setiap bulan 01:00 WIB — penyusutan aset tetap bulan lalu
   * (rancangan akuntansi & pajak lengkap D3). Bulan yang terlewat ikut
   * disusulkan; bulan yang sudah ditutup dilewati (nilainya disusulkan bulan
   * terbuka berikutnya). Idempoten per aset-bulan; yang gagal menulis
   * JOURNAL_PENDING. Sapuan 02:30 menangkap yang tetap terlewat.
   */
  cron.schedule(
    "0 1 1 * *",
    async () => {
      try {
        const { postingPenyusutanTerjadwal } = await import("@/lib/finance/aset/penyusutan");
        const r = await postingPenyusutanTerjadwal();
        if (r && (r.diposting > 0 || r.gagal.length > 0)) {
          console.log(`[cron] penyusutan ${r.sampai}: ${r.diposting} diposting (Rp ${r.totalNilai}), ${r.periodeDitutup} bulan ditutup, ${r.gagal.length} gagal`);
        }
      } catch (err) {
        console.error("[cron] penyusutan gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 01:15 WIB — jurnal berulang & akrual (D4): templat AKTIF
   * (sudah disetujui orang lain) yang tanggal postingnya sudah tiba. Idempoten
   * per templat-bulan; bulan yang sudah ditutup dilewati dengan catatan.
   */
  cron.schedule(
    "15 1 * * *",
    async () => {
      try {
        const { jalankanJurnalBerulangTerjadwal } = await import("@/lib/finance/berulang/writer");
        const r = await jalankanJurnalBerulangTerjadwal();
        if (r && (r.diposting > 0 || r.gagal.length > 0 || r.dilewati.length > 0)) {
          console.log(`[cron] jurnal-berulang: ${r.diposting} diposting, ${r.dibalik} pembalik, ${r.dilewati.length} dilewati, ${r.gagal.length} gagal`);
        }
      } catch (err) {
        console.error("[cron] jurnal-berulang gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 02:30 WIB — sapuan dokumen tanpa jurnal (bagian A1).
   *
   * Jurnal otomatis dibuat sesudah dokumen di-commit; proses yang mati di
   * antaranya tidak meninggalkan apa pun. Sapuan ini menanyai setiap sumber
   * terdaftar (`lib/finance/sapuan/semua.ts`) dokumen mana sejak tanggal mulai
   * buku besar yang belum berjurnal dan mempostingnya — idempoten, dan yang
   * gagal menulis `JOURNAL_PENDING` sendiri. Tanpa tanggal mulai, inert.
   * Dibatasi 200 dokumen per sumber per malam; sisanya malam berikutnya.
   */
  cron.schedule(
    "30 2 * * *",
    async () => {
      try {
        // Baris periode bulan ini dan bulan depan dibuat lebih dulu, supaya posting
        // pertama sebuah bulan tidak perlu menyisipkannya (kunci periode, A1).
        const { siapkanBarisPeriode } = await import("@/lib/finance/periode/siapkan");
        await siapkanBarisPeriode(new Date());
      } catch (err) {
        console.error("[cron] siapkan baris periode gagal:", err);
      }
      try {
        const { jalankanSapuan, ringkasLogSapuan } = await import("@/lib/finance/sapuan/runner");
        const r = await jalankanSapuan({ batasPerSumber: 200 });
        console.log(`[cron] sapuan-jurnal: ${ringkasLogSapuan(r)}`);
      } catch (err) {
        console.error("[cron] sapuan-jurnal gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 03:10 WIB — sapu foto yatim.
   *
   * Foto disimpan sebagai bytes di dalam basis data, jadi yang tidak ditunjuk
   * dokumen mana pun bukan sekadar baris nganggur: ia ikut ke setiap cadangan
   * selamanya. Dijadwalkan dini hari karena masa tenggangnya enam jam, dan
   * pukul tiga pagi adalah saat paling kecil kemungkinannya ada formulir yang
   * sedang diisi.
   *
   * `kering: false` — penyapuan ini memang menghapus. Bawaan fungsinya kering,
   * jadi baris inilah satu-satunya tempat penghapusan diminta terang-terangan.
   */
  cron.schedule(
    "10 3 * * *",
    async () => {
      try {
        const r = await sapuFotoYatim({ kering: false });
        if (r.dihapus > 0) {
          const mb = (r.byteDibebaskan / 1024 / 1024).toFixed(1);
          console.log(`[cron] sapu-foto: ${r.dihapus} foto yatim dihapus, ${mb} MB dibebaskan`);
        }
      } catch (err) {
        console.error("[cron] sapu-foto gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 07:00 WIB — pengingat giro jatuh tempo.
   *
   * Pagi, sebelum jam setor bank: giro yang efektif hari ini baru jadi uang
   * kalau disetorkan hari ini, dan yang sudah lewat tanggalnya makin dekat ke
   * akhir masa berlaku 70 hari. Satu catatan per hari, ke pemegang izin
   * verifikasi klaim; fungsinya sendiri menolak menulis dua kali sehari.
   */
  cron.schedule(
    "0 7 * * *",
    async () => {
      try {
        const r = await ingatkanGiroJatuhTempo();
        if (r.dibuat) console.log(`[cron] giro-jatuh-tempo: ${r.jumlah} giro diingatkan`);
      } catch (err) {
        console.error("[cron] giro-jatuh-tempo gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 18:30 WIB — ringkasan kerja tim lapangan hari ini.
   *
   * Satu kabar ke setiap sales yang hari ini bekerja (kunjungan, pesanan,
   * pelunasan) dan satu catatan ke penyetuju pesanan lapangan. Hari tanpa
   * kegiatan (Minggu, libur) tidak menulis apa pun, dan fungsinya menolak
   * menulis dua kali untuk tanggal yang sama — aman bila server dinyalakan ulang.
   */
  cron.schedule(
    "30 18 * * *",
    async () => {
      try {
        const r = await kirimRingkasanHarian(new Date());
        console.log(`[cron] ringkasan-harian ${r.tanggal}: ${r.status}`);
      } catch (err) {
        console.error("[cron] ringkasan-harian gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Tiap 5 menit — kabarkan pengumuman terjadwal yang waktunya sudah tiba.
   * Sekali per pengumuman (dicatat sebagai jejak ANNOUNCEMENT_SENT); yang terbit
   * lebih dari 3 hari lalu dilewati, jadi menyalakan cron ini belakangan tidak
   * mendorong pengumuman lama sekaligus.
   */
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        const r = await kirimPengumumanTerjadwal(new Date());
        if (r.pengumuman > 0) console.log(`[cron] pengumuman terjadwal: ${r.pengumuman} dikabarkan ke ${r.orang} orang`);
      } catch (err) {
        console.error("[cron] pengumuman terjadwal gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 08:00 WIB — barang yang menunggu di toko SPG.
   *
   * Pagi, saat counter buka: mutasi antar toko yang sudah dikirim lebih dari
   * `hariPengingat` hari tanpa diterima diingatkan ke kantor (sekali per
   * mutasi) dan ke SPG toko tujuan; kiriman apa pun yang menunggu lebih dari
   * sehari dikabarkan ke SPG tokonya, sekali per toko per hari. Kedua fungsi
   * menulis penandanya sendiri, jadi aman bila server dinyalakan ulang.
   */
  cron.schedule(
    "0 8 * * *",
    async () => {
      try {
        const macet = await ingatkanMutasiMacet();
        if (macet.dikabarkan > 0) console.log(`[cron] mutasi-macet: ${macet.dikabarkan} mutasi diingatkan`);
      } catch (err) {
        console.error("[cron] mutasi-macet gagal:", err);
      }
      try {
        const r = await kabarkanKirimanMenunggu();
        if (r.toko > 0) console.log(`[cron] kiriman-menunggu: ${r.toko} toko, ${r.orang} SPG dikabari`);
      } catch (err) {
        console.error("[cron] kiriman-menunggu gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 21:30 WIB — laporan tutup hari SPG yang belum dikirim.
   *
   * Toko SPG yang hari ini sudah punya nota tapi belum punya laporan tutup
   * hari: SPG-nya yang check-in hari ini dikabari, sekali per toko per hari
   * (penandanya jejak di toko itu), jadi aman bila server dinyalakan ulang.
   */
  cron.schedule(
    "30 21 * * *",
    async () => {
      try {
        const r = await ingatkanTutupHari();
        if (r.toko > 0) console.log(`[cron] tutup-hari: ${r.toko} toko, ${r.orang} SPG diingatkan`);
      } catch (err) {
        console.error("[cron] tutup-hari gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /*
   * Setiap hari 06:00 WIB — antrean pantau KOL (ekstensi Chrome, uji coba).
   *
   * Konten kolaborasi yang jatuh di H+1/H+3/H+7/H+30 dan akun TikTok KOL yang
   * sudah waktunya dicek masuk antrean sebelum jam kerja ekstensi (bawaan
   * 08.00). Kunci tugas unik, jadi aman bila server dinyalakan ulang dan
   * tombol "Susun antrean sekarang" ditekan di hari yang sama.
   */
  cron.schedule(
    "0 6 * * *",
    async () => {
      if (process.env.VITEST) return;
      try {
        const r = await susunAntreanPantau();
        console.log(`[cron] antrean-pantau: ${r.dibuat} tugas baru, ${r.dilewati} dilewati`);
      } catch (err) {
        console.error("[cron] antrean-pantau gagal:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  console.log("[cron] jobs registered");
}
