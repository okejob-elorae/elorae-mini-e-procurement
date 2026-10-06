import { submitFieldSalesOrder } from "@/app/pwa/stores/[id]/catalog/actions";
import { pwaDb } from "./db";
import { deletePendingOrder, type PendingOrderInden } from "./queue";
import { classifyResult, type SyncDecision } from "./classify";
import { flushPendingPhotos } from "./photo-sync";
import { flushLaporanTertahan } from "./laporan-sync";
import { flushBuktiTerimaTertahan } from "./bukti-terima-sync";
import { keadaanCheckinTertahan } from "./luring-tergantung";
import { KUNJUNGAN_DITOLAK } from "./luring-klasifikasi";

export { classifyResult, type SyncDecision } from "./classify";

let running = false;

export async function flushPendingOrders(): Promise<{ synced: number; failed: number; retried: number }> {
  if (running) return { synced: 0, failed: 0, retried: 0 };
  running = true;
  let synced = 0, failed = 0, retried = 0;
  try {
    // Also reclaim "syncing" rows: the run-lock guarantees no concurrent flush, so any row
    // left "syncing" was orphaned by an app suspend/kill mid-await (common on iOS PWAs).
    const pending: PendingOrderInden[] = (await pwaDb.pendingOrders.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort((a, b) => a.capturedAt - b.capturedAt);
    for (const o of pending) {
      // Pesanan di kunjungan yang check-in-nya juga tanpa sinyal: tunggu sampai
      // check-in itu sampai; kalau check-in-nya ditolak, berhenti dengan alasannya.
      const ikatan = await keadaanCheckinTertahan(o.visitClientId);
      if (ikatan === "tunggu") {
        await pwaDb.pendingOrders.update(o.localId, { syncState: "pending" });
        continue;
      }
      if (ikatan === "ditolak") {
        await pwaDb.pendingOrders.update(o.localId, { syncState: "failed", error: KUNJUNGAN_DITOLAK, attempts: o.attempts + 1 });
        failed += 1;
        continue;
      }
      await pwaDb.pendingOrders.update(o.localId, { syncState: "syncing" });
      let decision: SyncDecision;
      let reason = "";
      try {
        const res = await submitFieldSalesOrder({
          storeId: o.storeId,
          visitId: o.visitId ?? undefined,
          // Kunjungan yang check-in-nya dicatat tanpa sinyal (id buatan HP).
          ...(o.visitClientId ? { visitClientId: o.visitClientId } : {}),
          note: o.note,
          lines: o.lines,
          idempotencyKey: o.localId,
          // Pesanan jarak jauh tidak punya kunjungan; tanpa saluran ini server menolaknya.
          remoteChannel: o.remoteChannel ?? null,
          // Pre-order: server menilai ulang jendelanya saat sinkron (bisa sudah tutup).
          preorderWindowId: o.preorderWindowId ?? null,
          // Ubah pesanan: pesanan lama bisa sudah diputuskan kantor saat antrean akhirnya terkirim (terminal).
          gantiOrderId: o.gantiOrderId ?? null,
          // Keranjang dari permintaan SPG / rekomendasi: ditautkan server saat sampai (sekali, hanya pemegang toko).
          sumber: o.sumber ?? null,
        });
        decision = classifyResult(res);
        if (!res.ok) reason = res.code;
      } catch {
        decision = "retry";
      }
      if (decision === "evict") { await deletePendingOrder(o.localId); synced += 1; }
      else if (decision === "terminal") { await pwaDb.pendingOrders.update(o.localId, { syncState: "failed", error: reason, attempts: o.attempts + 1 }); failed += 1; }
      else { await pwaDb.pendingOrders.update(o.localId, { syncState: "pending", attempts: o.attempts + 1 }); retried += 1; }
    }
  } finally {
    running = false;
  }
  return { synced, failed, retried };
}

/**
 * Nota SPG dimuat saat dibutuhkan, bukan diimpor di kepala berkas: modulnya
 * menarik aksi server penjualan SPG, dan tes antrean pesanan (yang hanya
 * menirukan modul sinkron saudara-saudaranya) tidak boleh ikut memuatnya.
 * `run` hanya berjalan saat ada sinyal, jadi potongan kodenya selalu bisa diambil.
 */
const flushNotaSpg = () => import("./spg-jual-sinkron").then((m) => m.flushNotaSpgTertahan());

/*
 * Kunjungan dan pekerjaan stok tanpa sinyal — dimuat saat dibutuhkan dengan
 * alasan yang sama: modulnya menarik aksi server check-in, stok, dan retur
 * pembeli, yang tidak boleh ikut dimuat tes antrean pesanan.
 */
const flushCheckin = () => import("./luring-sinkron").then((m) => m.flushCheckinTertahan());
const flushStok = () => import("./luring-sinkron").then((m) => m.flushStokTertahan());
const flushCheckout = () => import("./luring-sinkron").then((m) => m.flushCheckoutTertahan());

/**
 * Urutan antrean HP: check-in dulu (pekerjaan di kunjungan tanpa sinyal
 * menunjuknya), lalu pesanan, foto kunjungan, laporan lapangan (pelunasan,
 * retur toko, janji bayar), bukti terima, nota SPG, pekerjaan stok SPG, dan
 * check-out PALING AKHIR (hasil kunjungan dinilai sesudah transaksinya sampai).
 */
const LANGKAH: (() => Promise<unknown>)[] = [
  flushCheckin,
  flushPendingOrders,
  flushPendingPhotos,
  flushLaporanTertahan,
  flushBuktiTerimaTertahan,
  flushNotaSpg,
  flushStok,
  flushCheckout,
];

/**
 * Jalankan semua langkah antrean satu kali, berurutan. Setiap langkah
 * terisolasi: yang melempar tidak menahan sisanya (nota SPG adalah catatan
 * uang). Dipakai juga tombol "Kirim sekarang" di layar antrean.
 */
export async function kirimSemuaAntrean(): Promise<void> {
  for (const l of LANGKAH) {
    try {
      await l();
    } catch (err) {
      console.error("sinkron antrean HP gagal:", err);
    }
  }
}

// Fires on reconnect + app foreground. Returns a cleanup fn. onChange lets the UI refresh its pending count.
// Each flush is run-locked, so a screen that also runs a step never sends twice.
export function setupOrderSync(onChange?: () => void): () => void {
  const run = () => {
    void (async () => {
      await kirimSemuaAntrean();
      onChange?.();
    })();
  };
  const onOnline = () => run();
  const onVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) run(); };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  if (navigator.onLine) run();
  return () => { window.removeEventListener("online", onOnline); document.removeEventListener("visibilitychange", onVisible); };
}
