"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ambilTitipan } from "@/lib/pwa/kembali-setelah-checkin";

/**
 * Meneruskan SPG ke layar yang memintanya check-in (opname, terima kiriman,
 * jual). `checkIn` selalu mendarat di halaman toko; kalau `CheckInButton`
 * menitipkan tujuan untuk toko ini beberapa saat lalu, halaman ini langsung
 * berpindah ke sana. `replace`: Kembali dari layar itu tidak membuka halaman
 * toko yang hanya dilewati.
 */
export function LanjutSetelahCheckIn({ storeId }: { storeId: string }) {
  const router = useRouter();
  useEffect(() => {
    const tujuan = ambilTitipan(storeId);
    if (tujuan) router.replace(tujuan);
  }, [router, storeId]);
  return null;
}
