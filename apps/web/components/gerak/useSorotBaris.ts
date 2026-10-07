"use client";

import { useCallback, useEffect, useRef, useState, type AnimationEvent } from "react";
import {
  DURASI_SOROT_MS,
  NAMA_ANIMASI_SOROT,
  bacaCatatan,
  barisBerubah,
  gabungCatatan,
  tandaGabungan,
  uraiTanda,
  type CatatanSorot,
  type TandaBaris,
} from "@/lib/gerak/sorot";

/** Tanda yang tidak pernah tampil (baris tersaring keluar) dilepas setelah ini. */
const JAGA_MS = 8000;
/** Baris yang ditandai sendiri tidak dinyalakan lagi oleh deteksi perubahan selama ini. */
const TAHAN_TANDA_MS = 10_000;

type PropsSorot = {
  "data-sorot"?: "baru";
  onAnimationEnd?: (e: AnimationEvent<HTMLElement>) => void;
};

/**
 * Sorot baris yang baru berubah: latarnya menyala ±1,2 detik lalu memudar
 * (kelas `[data-sorot="baru"]` di globals.css).
 *
 *   const { sorot, tandai } = useSorotBaris("po", pos.map((p) => ({ id: p.id, tanda: p.status })));
 *   <TableRow key={po.id} {...sorot(po.id)}>
 *   // setelah aksi berhasil, sebelum memuat ulang: tandai(po.id)
 *
 * Selain `tandai`, baris juga menyala sendiri bila statusnya berbeda dari
 * yang terakhir dilihat di daftar ini dalam tab yang sama — misalnya pesanan
 * yang baru disetujui di halaman rinciannya lalu orang kembali ke daftar.
 */
export function useSorotBaris(kunci: string, baris: readonly TandaBaris[] = []) {
  const [menyala, setMenyala] = useState<ReadonlySet<string>>(() => new Set());
  const catatan = useRef<CatatanSorot | null | undefined>(undefined);
  const ditandai = useRef(new Map<string, number>());
  const jaga = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Perubahan yang sudah terdeteksi tapi belum dinyalakan. Di ref, bukan di
  // variabel efek: StrictMode menjalankan efek dua kali dan membatalkan
  // jadwal pertama, sementara catatannya sudah diperbarui di jalan pertama.
  const tertunda = useRef(new Set<string>());

  const lepas = useCallback((id: string) => {
    const t = jaga.current.get(id);
    if (t) clearTimeout(t);
    jaga.current.delete(id);
    setMenyala((lama) => {
      if (!lama.has(id)) return lama;
      const baru = new Set(lama);
      baru.delete(id);
      return baru;
    });
  }, []);

  const nyalakan = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      for (const id of ids) {
        const t = jaga.current.get(id);
        if (t) clearTimeout(t);
        jaga.current.set(
          id,
          setTimeout(() => lepas(id), JAGA_MS),
        );
      }
      setMenyala((lama) => {
        const baru = new Set(lama);
        for (const id of ids) baru.add(id);
        return baru;
      });
    },
    [lepas],
  );

  /** Nyalakan satu baris sekarang — dipanggil sesudah aksinya berhasil. */
  const tandai = useCallback(
    (id: string) => {
      ditandai.current.set(id, Date.now());
      nyalakan([id]);
    },
    [nyalakan],
  );

  // Satu teks mewakili isi daftar, supaya efek hanya berjalan bila isinya berubah.
  const tanda = tandaGabungan(baris);

  useEffect(() => {
    const kunciSimpan = `elorae.sorot.${kunci}`;
    if (catatan.current === undefined) {
      try {
        catatan.current = bacaCatatan(sessionStorage.getItem(kunciSimpan));
      } catch {
        catatan.current = null;
      }
    }
    const sekarang = Date.now();
    for (const [id, waktu] of ditandai.current) {
      if (sekarang - waktu > TAHAN_TANDA_MS) ditandai.current.delete(id);
    }
    const isi = uraiTanda(tanda);
    const berubah = barisBerubah(catatan.current, isi, new Set(ditandai.current.keys()));
    catatan.current = gabungCatatan(catatan.current, isi);
    try {
      sessionStorage.setItem(kunciSimpan, JSON.stringify(catatan.current));
    } catch {
      // Penyimpanan hanya kenyamanan; tanpa itu sorot dari halaman lain saja yang hilang.
    }
    for (const id of berubah) tertunda.current.add(id);
    if (tertunda.current.size === 0) return;
    // Sesudah lukisan berikutnya: baris yang baru dipasang sudah ada di layar.
    const raf = requestAnimationFrame(() => {
      const ids = [...tertunda.current];
      tertunda.current.clear();
      nyalakan(ids);
    });
    return () => cancelAnimationFrame(raf);
  }, [kunci, tanda, nyalakan]);

  useEffect(() => {
    const semua = jaga.current;
    return () => {
      for (const t of semua.values()) clearTimeout(t);
      semua.clear();
    };
  }, []);

  /** Atribut untuk baris `id`: kosong bila tidak sedang menyala. */
  const sorot = (id: string): PropsSorot =>
    menyala.has(id)
      ? {
          "data-sorot": "baru",
          onAnimationEnd: (e) => {
            // Hanya akhir animasi sorot sendiri — bukan animasi masuk baris atau ikon di dalamnya.
            if (e.animationName.startsWith(NAMA_ANIMASI_SOROT)) lepas(id);
          },
        }
      : {};

  return { sorot, tandai, durasiMs: DURASI_SOROT_MS };
}
