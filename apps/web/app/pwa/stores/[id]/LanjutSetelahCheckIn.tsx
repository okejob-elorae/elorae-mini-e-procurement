"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ambilTitipan } from "@/lib/pwa/kembali-setelah-checkin";

/**
 * Meneruskan SPG sesudah check-in: ke layar yang memintanya check-in (opname,
 * terima kiriman, jual), atau — tanpa layar itu — ke berandanya, tempat tombol
 * Jual. `checkIn` selalu mendarat di halaman toko; kalau `CheckInButton`
 * menitipkan tujuan untuk toko ini beberapa saat lalu, halaman ini langsung
 * berpindah ke sana. Membuka halaman toko lagi sesudahnya tidak dialihkan:
 * titipannya sudah terpakai. `replace`: Kembali dari layar itu tidak membuka
 * halaman toko yang hanya dilewati.
 */
export function LanjutSetelahCheckIn({ storeId }: { storeId: string }) {
  const router = useRouter();
  useEffect(() => {
    const tujuan = ambilTitipan(storeId);
    if (tujuan) router.replace(tujuan);
  }, [router, storeId]);
  return null;
}
