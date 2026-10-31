import { Ellipsis, Fuel, Route, SquareParking, Utensils } from "lucide-react";
import type { StatusBiaya } from "@/lib/salesman/biaya";

/**
 * Ikon kategori dan warna status biaya perjalanan — dipakai HP dan layar
 * kantor, supaya "Bensin" dan "Ditolak" terlihat sama di kedua tempat.
 *
 * Ikon dipilih dengan `switch` yang mengembalikan elemen, bukan dengan
 * mengambil komponen dari peta saat render: pengompilasi React menganggap
 * komponen hasil pemanggilan fungsi sebagai komponen baru di setiap render.
 */
export function IkonKategori({ kategori, className }: { kategori: string; className?: string }) {
  switch (kategori) {
    case "BENSIN":
      return <Fuel className={className} aria-hidden />;
    case "PARKIR":
      return <SquareParking className={className} aria-hidden />;
    case "TOL":
      return <Route className={className} aria-hidden />;
    case "MAKAN":
      return <Utensils className={className} aria-hidden />;
    default:
      return <Ellipsis className={className} aria-hidden />;
  }
}

/** Kelas pil status (latar tipis + teks). */
export const NADA_STATUS: Record<StatusBiaya, string> = {
  DIAJUKAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DISETUJUI: "bg-primary/15 text-foreground",
  DITOLAK: "bg-destructive/10 text-destructive",
  DIBAYAR: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
};

export const nadaStatus = (s: string): string => NADA_STATUS[s as StatusBiaya] ?? "bg-muted text-muted-foreground";
