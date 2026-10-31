import cron from "node-cron";
import { runCheckOverdue } from "./check-overdue";
import { runReconciliationCron } from "@/app/actions/stock-reconciliation";
import { postPendingSalesJournals, GL_CUTOVER_SETTING_KEY } from "@/lib/finance/sales/sweep";
import { postPendingVanJournals } from "@/lib/canvassing/van-journal-sweep";
import { runOverdueSweep } from "@/lib/finance/ar/overdue-sweep";
import { runPaymentReminderSweep } from "@/lib/purchase-orders/payment-reminder-sweep";
import { runSalesReturnBellSweep } from "@/lib/sales-returns/bell-sweep";
import { runKonsiCountSweep } from "@/lib/konsi-count-schedule/sweep";
import { runSettlementRematchSweep } from "@/lib/finance/settlement/rematch-sweep";
import { runFulfillmentPushDivergenceSweep } from "@/lib/fulfillment/push-divergence-sweep";
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

  // Daily 08:00 Asia/Jakarta — AR overdue threshold alerts. Distinct job from `check-overdue`
  // above on purpose: that job sweeps PurchaseOrder ETA / work orders / accessories CMT, zero AR
  // involvement — the two must never share a log line or a failure. 08:00 rather than 09:00 so
  // the two sweeps do not contend and the alert is waiting before the collections day starts.
  cron.schedule(
    "0 8 * * *",
    async () => {
      console.log("[cron] piutang-overdue tick");
      try {
        const r = await runOverdueSweep();
        console.log(
          "[cron] piutang-overdue done — scanned=%d announced=%d deferred=%d collectorNotified=%d unassigned=%d failed=%d",
          r.scanned,
          r.announced,
          r.deferred,
          r.collectorNotified,
          r.unassigned,
          r.failed,
        );
      } catch (err) {
        console.error("[cron] piutang-overdue failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /**
   * Daily 08:30 Asia/Jakarta — PO payment due-date reminders. Its own job, log line and catch,
   * like the AR sweep beside it; 08:30 keeps it off the 08:00 AR sweep and the 09:00
   * `check-overdue` job, which is a different feature (PO delivery ETA, not payment).
   */
  cron.schedule(
    "30 8 * * *",
    async () => {
      console.log("[cron] po-payment-reminder tick");
      try {
        const r = await runPaymentReminderSweep();
        console.log(
          "[cron] po-payment-reminder done — scanned=%d announced=%d deferred=%d failed=%d",
          r.scanned,
          r.announced,
          r.deferred,
          r.failed,
        );
      } catch (err) {
        console.error("[cron] po-payment-reminder failed:", err);
      }
    },
    { timezone: "Asia/Jakarta" },
  );

  /**
   * Every 5 minutes — bell notification for each new PENDING marketplace return. Its own job, log
   * line and catch. It shares the every-5-minutes cadence with the sales-journal sweep but nothing
   * else. `noOverlap` skips a tick while the previous one is still fanning out: each run reads the
   * dedup set once, so two overlapping runs would announce the same return twice.
   */
  cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        const r = await runSalesReturnBellSweep();
        if (r.flooredNow || r.announced > 0 || r.deferred > 0 || r.failed > 0) {
          console.log(
            "[cron] sales-return-bell done — scanned=%d announced=%d deferred=%d failed=%d floored=%s",
            r.scanned,
            r.announced,
            r.deferred,
            r.failed,
            r.flooredNow,
          );
        }
      } catch (err) {
        console.error("[cron] sales-return-bell failed:", err);
      }
    },
    { timezone: "Asia/Jakarta", noOverlap: true },
  );

  /**
   * Daily 07:00 Asia/Jakarta — konsi monthly counts: opens or announces a due count and raises the
   * overdue alert. Its own job, an hour ahead of the AR sweep, so the two never share a log line or
   * a failure and the count is open before the SPG's shift starts.
   */
  cron.schedule(
    "0 7 * * *",
    async () => {
      console.log("[cron] konsi-count tick");
      try {
        const r = await runKonsiCountSweep();
        console.log(
          "[cron] konsi-count done — scanned=%d opened=%d alreadyOpen=%d existingAnnounced=%d spgNotified=%d overdue=%d failed=%d",
          r.scanned,
          r.opened,
          r.alreadyOpen,
          r.existingAnnounced,
          r.spgNotified,
          r.overdueAnnounced,
          r.failed,
        );
      } catch (err) {
        console.error("[cron] konsi-count failed:", err);
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

  /**
   * Hourly — post van load/sale/reconcile journals that never got one, above the
   * auto-post floor. Backstop for a failed post whose JOURNAL_PENDING write also
   * failed. `noOverlap` skips a tick while the previous one is still posting.
   *
   * `NO_FLOOR` stays quiet on purpose: it means no van document has ever been
   * auto-posted in this environment, a healthy state, unlike the sales sweep's
   * `NO_CUTOVER`.
   */
  cron.schedule(
    "20 * * * *",
    async () => {
      try {
        const r = await postPendingVanJournals();
        if (r.skipped === "NO_FLOOR") return;
        /* A NOTHING_TO_POST residual alone stays quiet: it recurs every tick and posts nothing. */
        if (r.posted > 0 || r.failed > 0) {
          console.log(
            "[cron] van-journal done — posted=%d nothingToPost=%d failed=%d newlyFlagged=%d",
            r.posted,
            r.nothingToPost,
            r.failed,
            r.newlyFlagged,
          );
        }
      } catch (err) {
        console.error("[cron] van-journal failed:", err);
      }
    },
    { timezone: "Asia/Jakarta", noOverlap: true },
  );

  /**
   * Every minute — rematch settlements whose stamped Jubelio resync batch has finished. `noOverlap`
   * skips a tick while the previous one is still matching a large settlement, so two ticks never
   * match the same settlement at once.
   */
  cron.schedule(
    "* * * * *",
    async () => {
      try {
        const r = await runSettlementRematchSweep();
        if (r.scanned > 0) {
          console.log(
            "[cron] settlement-rematch done — scanned=%d rematched=%d skippedReconciled=%d stillRunning=%d",
            r.scanned,
            r.rematched,
            r.skippedReconciled,
            r.stillRunning,
          );
        }
      } catch (err) {
        console.error("[cron] settlement-rematch failed:", err);
      }
    },
    { timezone: "Asia/Jakarta", noOverlap: true },
  );

  /**
   * Every 30 minutes — alert admins when a PICKED/PACKED order's pick or pack push to Jubelio never
   * landed, at most `MAX_ALERTS_PER_RUN` new alerts per tick (`deferred` counts the rest, which a
   * later tick picks up). `noOverlap` skips a tick while the previous one is still running.
   */
  cron.schedule(
    "*/30 * * * *",
    async () => {
      try {
        const r = await runFulfillmentPushDivergenceSweep();
        if (r.notified > 0 || r.failed > 0 || r.deferred > 0) {
          console.log(
            "[cron] fulfillment-push-divergence done — checked=%d notified=%d failed=%d deferred=%d",
            r.checked,
            r.notified,
            r.failed,
            r.deferred,
          );
        }
      } catch (err) {
        console.error("[cron] fulfillment-push-divergence failed:", err);
      }
    },
    { timezone: "Asia/Jakarta", noOverlap: true },
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
