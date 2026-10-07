'use client';

import { useEffect, useRef } from 'react';
import { getSyncStatus, syncPendingOperations, syncPendingPOs } from '@/lib/offline/sync';
import { setLuring } from '@/lib/pulau/pulau';
import { awalKirim, langkahKirim, type KeadaanKirim, type PeristiwaKirim } from '@/lib/pulau/pengiriman';

/** Selang membaca antrean kantor saat tenang, dan saat sedang mengirim. */
const SELANG_MS = 5000;
const SELANG_KIRIM_MS = 1000;
/** Pengiriman yang tidak selesai dalam waktu ini berhenti disebut "Mengirim…". */
const BATAS_KIRIM_MS = 20_000;
/** Sekian bacaan berturut-turut tanpa perubahan = pengiriman sudah berhenti. */
const BACAAN_TENANG = 3;

/**
 * Pemantau sinyal kantor — tidak menggambar apa pun.
 *
 * Dulu label "Online/Offline" di pojok kiri bawah menu samping. Sekarang
 * keadaannya tampil di pulau status di tengah atas: "Tanpa sinyal · N belum
 * terkirim", "Mengirim…" saat sinyal kembali, lalu "Terkirim". Saat ada sinyal
 * dan antrean kosong pulau diam. Antrean yang tetap tertahan sesudah sinyal
 * kembali tampil sebagai "N belum terkirim" yang bisa diketuk untuk mengirim
 * ulang (pengganti tombol sinkron lama).
 *
 * Pengiriman otomatis saat sinyal kembali tetap dijalankan
 * `setupSyncListeners` di `BackofficeShell`; di sini hanya diamati.
 * Dipasang SEKALI di `BackofficeShell`.
 */
export function OfflineIndicator() {
  const keadaan = useRef<KeadaanKirim>(awalKirim(true, 0));

  useEffect(() => {
    let aktif = true;
    let pengatur: ReturnType<typeof setTimeout> | null = null;
    let batas: ReturnType<typeof setTimeout> | null = null;
    let kirimManual = false;
    let samaBerturut = 0;

    const terbitkan = () => {
      const k = keadaan.current;
      setLuring({
        luring: k.luring,
        belumTerkirim: k.belum,
        mengirim: k.mengirim,
        kirimUlang: k.luring ? undefined : kirimUlang,
      });
    };

    const langkah = (p: PeristiwaKirim) => {
      const sebelum = keadaan.current;
      keadaan.current = langkahKirim(sebelum, p);
      if (sebelum.mengirim && !keadaan.current.mengirim && batas !== null) {
        clearTimeout(batas);
        batas = null;
      }
      if (!sebelum.mengirim && keadaan.current.mengirim) {
        samaBerturut = 0;
        batas = setTimeout(() => {
          batas = null;
          langkah({ jenis: 'batas' });
        }, BATAS_KIRIM_MS);
      }
      terbitkan();
      jadwalkanBaca();
    };

    const baca = async () => {
      try {
        const status = await getSyncStatus();
        if (!aktif) return;
        const belum = status.pendingCount + (status.pendingPOCount || 0);
        samaBerturut = belum === keadaan.current.belum ? samaBerturut + 1 : 0;
        langkah({ jenis: 'hitung', belum });
        // Antrean yang tidak berkurang lagi: kirimannya sudah berhenti (sisanya gagal).
        if (keadaan.current.mengirim && !kirimManual && samaBerturut >= BACAAN_TENANG) langkah({ jenis: 'tenang' });
      } catch {
        // IndexedDB tidak tersedia (mode privat): coba lagi nanti, angkanya tetap.
        if (aktif) jadwalkanBaca();
      }
    };

    function jadwalkanBaca() {
      if (pengatur !== null) clearTimeout(pengatur);
      pengatur = setTimeout(() => void baca(), keadaan.current.mengirim ? SELANG_KIRIM_MS : SELANG_MS);
    }

    async function kirimUlang() {
      if (kirimManual) return;
      kirimManual = true;
      langkah({ jenis: 'kirimUlang' });
      try {
        await syncPendingOperations();
        await syncPendingPOs();
      } catch {
        // Gagal kirim: sisanya tetap terhitung "belum terkirim".
      } finally {
        kirimManual = false;
        await baca();
        if (aktif) langkah({ jenis: 'tenang' });
      }
    }

    const saatLuring = () => langkah({ jenis: 'luring' });
    const saatDaring = () => langkah({ jenis: 'daring' });

    keadaan.current = awalKirim(typeof navigator === 'undefined' || navigator.onLine, 0);
    terbitkan();
    void baca();
    window.addEventListener('online', saatDaring);
    window.addEventListener('offline', saatLuring);

    return () => {
      aktif = false;
      if (pengatur !== null) clearTimeout(pengatur);
      if (batas !== null) clearTimeout(batas);
      window.removeEventListener('online', saatDaring);
      window.removeEventListener('offline', saatLuring);
      setLuring({ luring: false, belumTerkirim: 0, mengirim: false });
    };
  }, []);

  return null;
}
