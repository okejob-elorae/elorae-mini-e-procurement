import { recordSpgSaleAction } from "@/app/actions/spg-sale";
import { pwaDb } from "./db";
import { nasibNotaSpg, type NasibNotaSpg } from "./spg-jual-klasifikasi";
import { muatanKirimNotaSpg } from "./spg-jual-muatan";
import { catatSelisihTotalDiHp, totalBerbeda } from "./spg-jual-selisih";
import { keadaanCheckinTertahan } from "./luring-tergantung";
import { KUNJUNGAN_DITOLAK } from "./luring-klasifikasi";

/**
 * Kirim nota SPG yang tertahan di HP, yang tertua dulu.
 *
 * Setiap nota dikirim dengan `luring`, waktu jualnya, dan kunjungan saat
 * dijual, memakai kunci idempotensi yang sama dengan percobaan di konter:
 * jawaban yang hilang di jalan aman, kiriman berikutnya hanya mendapat nota
 * yang sudah ada. Harga dan promo dinilai ulang di server; kalau total
 * tercatat berbeda dari layar, selisihnya dicatat di HP supaya nota menyebutnya.
 */

let berjalan = false;

export type HasilKirimNotaSpg = {
  terkirim: number;
  gagal: number;
  /** Ada pengiriman lain yang sedang berjalan — panggilan ini tidak mengirim apa pun. */
  sibuk: boolean;
  /** Nota terkirim yang total tercatatnya berbeda dari layar saat dijual. */
  berbeda: { docNo: string; pratinjau: number; tercatat: number }[];
};

export async function flushNotaSpgTertahan(): Promise<HasilKirimNotaSpg> {
  if (berjalan) return { terkirim: 0, gagal: 0, sibuk: true, berbeda: [] };
  berjalan = true;
  const hasil: HasilKirimNotaSpg = { terkirim: 0, gagal: 0, sibuk: false, berbeda: [] };
  try {
    // "syncing" ikut diambil: kunci-jalan menjamin tidak ada flush lain, jadi
    // baris "syncing" adalah sisa aplikasi yang ditutup di tengah kiriman.
    const daftar = (await pwaDb.pendingSpgSales.where("syncState").anyOf(["pending", "syncing"]).toArray()).sort(
      (a, b) => a.capturedAt - b.capturedAt,
    );
    for (const n of daftar) {
      // Nota di kunjungan yang check-in-nya juga tanpa sinyal: tunggu sampai
      // check-in itu sampai; kalau check-in-nya ditolak, berhenti dengan alasannya.
      const ikatan = await keadaanCheckinTertahan(n.visitClientId);
      if (ikatan === "tunggu") {
        await pwaDb.pendingSpgSales.update(n.localId, { syncState: "pending" });
        continue;
      }
      if (ikatan === "ditolak") {
        await pwaDb.pendingSpgSales.update(n.localId, { syncState: "failed", error: KUNJUNGAN_DITOLAK, attempts: n.attempts + 1 });
        hasil.gagal += 1;
        continue;
      }
      await pwaDb.pendingSpgSales.update(n.localId, { syncState: "syncing" });
      let nasib: NasibNotaSpg;
      let alasan = "";
      try {
        const res = await recordSpgSaleAction(muatanKirimNotaSpg(n));
        nasib = nasibNotaSpg(res);
        if (res.ok) {
          if (totalBerbeda(n.totalPratinjau, res.total)) {
            catatSelisihTotalDiHp(res.spgSaleId, n.totalPratinjau, res.total);
            hasil.berbeda.push({ docNo: res.docNo, pratinjau: n.totalPratinjau, tercatat: res.total });
          }
        } else {
          alasan = res.code;
        }
      } catch {
        nasib = "retry";
      }
      if (nasib === "evict") {
        await pwaDb.pendingSpgSales.delete(n.localId);
        hasil.terkirim += 1;
      } else {
        await pwaDb.pendingSpgSales.update(n.localId, {
          syncState: nasib === "terminal" ? "failed" : "pending",
          error: alasan || undefined,
          attempts: n.attempts + 1,
        });
        if (nasib === "terminal") hasil.gagal += 1;
      }
    }
  } finally {
    berjalan = false;
  }
  return hasil;
}
