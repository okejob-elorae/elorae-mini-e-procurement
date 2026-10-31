"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { celahDiam, celahSisip, lajuGulir, lewatAmbang } from "@/lib/gerak/seret-urut";

/*
 * Seret-lepas berurutan dengan POINTER EVENT (mouse, pena, dan jari) — satu
 * kait untuk semua daftar yang bisa diseret (Papan Pemasok, SOP Rantai, Jadwal
 * proses tahap). Tanpa pustaka seret dan tanpa API seret HTML5.
 *
 *   const seret = useSeretUrut<Data>({ onLepas: (data, { daftar, celah }) => … });
 *   <div {...atributDaftar("kartu-1")}>                // wadah yang menerima lepasan
 *     <div {...ATRIBUT_BUTIR}>                          // tiap butir, urut tampil
 *       <span {...seret.pegangan(data)} className="touch-none">⠿</span>
 *
 * Sasaran dicari dengan `document.elementFromPoint` dan atribut data, bukan dari
 * `event.target`: pointer jari tetap "tertangkap" oleh elemen tempat jari mulai
 * menekan (sama dengan `rentang-tanggal-input.tsx`), jadi target event tidak
 * pernah berpindah. Celah dihitung dari titik tengah butir (`celahSisip`).
 *
 * Hanya pegangan yang `touch-none`, supaya halaman tetap bisa digulir dengan
 * jari di luar pegangan. Elemen yang diberi `pegangan(...)` tanpa `touch-none`
 * tetap bisa diseret dengan mouse; jari di sana menggulir halaman (peramban
 * mengirim `pointercancel`, seretan dibatalkan).
 *
 * Gerak kecil di bawah ambang tetap klik; klik yang menyusul seretan ditelan.
 * Esc membatalkan. Dekat tepi wadah bergulir (atau jendela) halaman bergulir
 * sendiri. Kait ini tidak menganimasikan apa pun — tampilan "terangkat" diatur
 * layar dengan kelas `motion-safe:` sehingga "kurangi gerakan" dihormati.
 */

export type SasaranSeret = { daftar: string; celah: number };
export type SesiSeret<D> = { data: D; sasaran: SasaranSeret | null; x: number; y: number };

/** Props yang dipasang ke pegangan seret (`pegangan(data)`). */
export type PropsPegangan = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
};

const ATR_DAFTAR = "data-seret-daftar";
const ATR_BUTIR = "data-seret-butir";

/** Wadah daftar yang menerima lepasan; `id` kembali di `SasaranSeret.daftar`. */
export function atributDaftar(id: string): { "data-seret-daftar": string } {
  return { [ATR_DAFTAR]: id };
}

/** Penanda satu butir daftar (urutan DOM = urutan tampil). */
export const ATRIBUT_BUTIR = { [ATR_BUTIR]: "" } as { "data-seret-butir": string };

type Opsi<D> = {
  onLepas: (data: D, sasaran: SasaranSeret) => void;
  /** Daftar mana yang boleh menerima `data`; bawaan: semua. */
  bolehLepas?: (data: D, daftar: string) => boolean;
  nonaktif?: boolean;
};

type Tekan<D> = {
  data: D;
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  jalan: boolean;
};

function sasaranDi(x: number, y: number): SasaranSeret | null {
  if (typeof document === "undefined") return null;
  const daftar = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${ATR_DAFTAR}]`);
  const id = daftar?.getAttribute(ATR_DAFTAR);
  if (!daftar || !id) return null;
  const tengah = Array.from(daftar.querySelectorAll<HTMLElement>(`[${ATR_BUTIR}]`))
    .filter((b) => b.closest(`[${ATR_DAFTAR}]`) === daftar)
    .map((b) => {
      const r = b.getBoundingClientRect();
      return r.top + r.height / 2;
    });
  return { daftar: id, celah: celahSisip(tengah, y) };
}

function wadahGulir(el: Element | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n && n !== document.body; n = n.parentElement) {
    const { overflowY } = getComputedStyle(n);
    if ((overflowY === "auto" || overflowY === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

function gulirOtomatis(x: number, y: number): void {
  const wadah = wadahGulir(document.elementFromPoint(x, y));
  if (wadah) {
    const r = wadah.getBoundingClientRect();
    const v = lajuGulir(y, r.top, r.bottom);
    if (v !== 0) {
      wadah.scrollTop += v;
      return;
    }
  }
  const v = lajuGulir(y, 0, window.innerHeight);
  if (v !== 0) window.scrollBy(0, v);
}

const samaSasaran = (a: SasaranSeret | null, b: SasaranSeret | null) =>
  a === b || (!!a && !!b && a.daftar === b.daftar && a.celah === b.celah);

export function useSeretUrut<D>(opsi: Opsi<D>) {
  const [sesi, setSesi] = useState<SesiSeret<D> | null>(null);
  const opsiTerkini = useRef(opsi);
  const tekan = useRef<Tekan<D> | null>(null);
  const bingkai = useRef<number | null>(null);
  const lepasPendengar = useRef<(() => void) | null>(null);
  const abaikanKlik = useRef(false);
  const pilihLama = useRef<string | null>(null);

  useEffect(() => {
    opsiTerkini.current = opsi;
  });

  const hitungSasaran = useCallback((p: Tekan<D>): SasaranSeret | null => {
    const s = sasaranDi(p.x, p.y);
    if (!s) return null;
    const boleh = opsiTerkini.current.bolehLepas;
    return boleh && !boleh(p.data, s.daftar) ? null : s;
  }, []);

  const selesai = useCallback(() => {
    if (bingkai.current !== null) cancelAnimationFrame(bingkai.current);
    bingkai.current = null;
    lepasPendengar.current?.();
    lepasPendengar.current = null;
    if (pilihLama.current !== null) {
      document.body.style.userSelect = pilihLama.current;
      pilihLama.current = null;
    }
    tekan.current = null;
    setSesi(null);
  }, []);

  useEffect(() => selesai, [selesai]);

  /** Hitung ulang sasaran di bawah penunjuk dan tampilkan (setiap gerak dan setiap gulir). */
  const segarkan = useCallback(() => {
    const p = tekan.current;
    if (!p || !p.jalan) return;
    const sasaran = hitungSasaran(p);
    setSesi((lama) =>
      lama && lama.data === p.data && lama.x === p.x && lama.y === p.y && samaSasaran(lama.sasaran, sasaran)
        ? lama
        : { data: p.data, sasaran, x: p.x, y: p.y },
    );
  }, [hitungSasaran]);

  /** Gulir otomatis tiap bingkai selama menyeret (penunjuk diam di tepi tetap menggulir). */
  const putar = useCallback(() => {
    const langkah = () => {
      const p = tekan.current;
      if (!p || !p.jalan) return;
      gulirOtomatis(p.x, p.y);
      segarkan();
      bingkai.current = requestAnimationFrame(langkah);
    };
    bingkai.current = requestAnimationFrame(langkah);
  }, [segarkan]);

  const mulaiPendengar = useCallback(() => {
    const gerak = (e: PointerEvent) => {
      const p = tekan.current;
      if (!p || e.pointerId !== p.pointerId) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (!p.jalan) {
        if (!lewatAmbang(p.x - p.x0, p.y - p.y0)) return;
        p.jalan = true;
        pilihLama.current = document.body.style.userSelect;
        document.body.style.userSelect = "none";
        window.getSelection()?.removeAllRanges();
        putar();
      }
      segarkan();
    };
    const lepas = (e: PointerEvent) => {
      const p = tekan.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const sasaran = p.jalan ? hitungSasaran({ ...p, x: e.clientX, y: e.clientY }) : null;
      const { data, jalan } = p;
      selesai();
      if (!jalan) return;
      // Klik yang menyusul seretan (mouse) bukan pilihan baru.
      abaikanKlik.current = true;
      window.setTimeout(() => {
        abaikanKlik.current = false;
      }, 0);
      if (sasaran) opsiTerkini.current.onLepas(data, sasaran);
    };
    const batal = (e: PointerEvent) => {
      if (tekan.current && e.pointerId === tekan.current.pointerId) selesai();
    };
    const tombol = (e: KeyboardEvent) => {
      if (e.key === "Escape" && tekan.current) {
        // Esc membatalkan seretan saja — dialog tempat daftar berada tetap terbuka.
        e.preventDefault();
        e.stopPropagation();
        selesai();
      }
    };
    const sembunyi = () => {
      if (document.visibilityState === "hidden") selesai();
    };
    window.addEventListener("pointermove", gerak);
    window.addEventListener("pointerup", lepas);
    window.addEventListener("pointercancel", batal);
    window.addEventListener("keydown", tombol, true);
    document.addEventListener("visibilitychange", sembunyi);
    lepasPendengar.current = () => {
      window.removeEventListener("pointermove", gerak);
      window.removeEventListener("pointerup", lepas);
      window.removeEventListener("pointercancel", batal);
      window.removeEventListener("keydown", tombol, true);
      document.removeEventListener("visibilitychange", sembunyi);
    };
  }, [hitungSasaran, putar, segarkan, selesai]);

  /** Props pegangan seret untuk satu butir/sumber. */
  const pegangan = useCallback(
    (data: D): PropsPegangan => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (opsiTerkini.current.nonaktif) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (tekan.current) {
          // Jari kedua tidak memulai seretan lain; tekanan utama baru berarti yang lama sudah usai.
          if (!e.isPrimary) return;
          selesai();
        }
        abaikanKlik.current = false;
        tekan.current = {
          data,
          pointerId: e.pointerId,
          x0: e.clientX,
          y0: e.clientY,
          x: e.clientX,
          y: e.clientY,
          jalan: false,
        };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Peramban lama / elemen terlepas: pendengar di window tetap menerima gerak.
        }
        mulaiPendengar();
      },
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
        if (!abaikanKlik.current) return;
        abaikanKlik.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
    [mulaiPendengar, selesai],
  );

  return { sesi, pegangan, batal: selesai };
}

/** Garis sisip tampil sebelum butir `i` dari daftar `daftar`? (`i = n` = sesudah butir terakhir). */
export function garisSisipDi(
  sesi: SesiSeret<unknown> | null,
  daftar: string,
  i: number,
  dari: number | null = null,
): boolean {
  const s = sesi?.sasaran;
  if (!s || s.daftar !== daftar || s.celah !== i) return false;
  return dari === null || !celahDiam(dari, i);
}
