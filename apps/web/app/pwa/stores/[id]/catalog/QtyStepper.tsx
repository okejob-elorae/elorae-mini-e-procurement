"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jepitJumlah, ketikJumlah, langkahJumlah, selesaiJumlah } from "@/lib/field-sales/keranjang-katalog";

/**
 * Tombol −/+ dengan angka yang bisa DIKETIK (salesman mengetik 48, bukan
 * menekan + empat puluh delapan kali). Dipakai kartu barang, layar tinjau, dan
 * lembar varian. Aturannya murni di `lib/field-sales/keranjang-katalog.ts`
 * (`ketikJumlah`, `selesaiJumlah`, `langkahJumlah`) dan dites di sana.
 *
 * - Ketikan > 0 langsung masuk keranjang; di atas `max` dijepit ke `max` dan
 *   `onJepit` dipanggil (pemanggil menulis pesannya).
 * - Kosong/0 baru dianggap "keluar dari keranjang" saat isian ditinggalkan —
 *   kalau langsung, baris di layar tinjau hilang di tengah mengetik.
 * - Isinya terpilih saat fokus, jadi angka baru langsung menggantikan yang lama.
 * - −/+ dihitung dari angka yang tampil, dan mengakhiri ketikan: di HP tombol
 *   bisa disentuh tanpa isian kehilangan fokus, dan angka lama tidak boleh
 *   tertinggal di layar sementara keranjang sudah berubah.
 */
export function QtyStepper({
  value,
  max,
  onChange,
  onJepit,
  disabled = false,
  labelKurang,
  labelTambah,
  labelJumlah,
}: {
  value: number;
  /** Batas yang sama dengan tombol +: stok tersedia, atau batas langkah pre-order. */
  max: number;
  /** Jumlah baru, sudah dijepit; 0 = keluar dari keranjang. */
  onChange: (qty: number) => void;
  onJepit?: (max: number) => void;
  disabled?: boolean;
  labelKurang: string;
  labelTambah: string;
  labelJumlah: string;
}) {
  /*
   * Teks yang sedang diketik, bersama jumlah keranjang yang SESUAI dengannya
   * (sesudah `onChange` dari ketikan itu sendiri). null = tidak sedang diketik.
   * Kalau jumlah keranjang berubah dari luar selagi isian masih fokus (mis.
   * "+1 pack"), teks lama gugur: angka lama tidak boleh tampil, apalagi ditulis
   * balik ke keranjang saat isian ditinggalkan.
   */
  const [isian, setIsian] = useState<{ teks: string; nilai: number } | null>(null);
  const draf = isian !== null && isian.nilai === value ? isian.teks : null;
  const tampil = draf === null ? value : jepitJumlah(draf, Math.max(max, value)).qty;
  const isiMati = disabled || (max <= 0 && value <= 0);

  function ketik(teksBaru: string) {
    const h = ketikJumlah(teksBaru, max, value);
    setIsian({ teks: h.draf, nilai: h.qty ?? value });
    if (h.dijepit) onJepit?.(Math.max(0, max));
    if (h.qty !== null) onChange(h.qty);
  }

  function selesai() {
    const qty = selesaiJumlah(draf, max, value);
    setIsian(null);
    if (qty !== null) onChange(qty);
  }

  function langkah(arah: 1 | -1) {
    const qty = langkahJumlah(arah, draf, max, value);
    setIsian(null);
    if (qty !== value) onChange(qty);
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        disabled={disabled || tampil <= 0}
        onClick={() => langkah(-1)}
        aria-label={labelKurang}
      >
        <Minus className="h-4 w-4" />
      </Button>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={labelJumlah}
        disabled={isiMati}
        value={draf ?? String(value)}
        onFocus={(e) => {
          const el = e.currentTarget;
          setIsian({ teks: String(value), nilai: value });
          el.select();
          // Safari HP melepas pilihan saat jari diangkat; pilih sekali lagi sesudahnya.
          window.setTimeout(() => {
            if (document.activeElement === el) el.select();
          }, 0);
        }}
        onChange={(e) => ketik(e.target.value)}
        onBlur={selesai}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="h-10 w-12 shrink-0 px-1 text-center font-semibold tabular-nums"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        disabled={disabled || tampil >= max}
        onClick={() => langkah(1)}
        aria-label={labelTambah}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
