import { TransisiHalaman } from "@/components/gerak/TransisiHalaman";

/**
 * Layar HP memudar masuk saat berpindah bagian (View Transitions). Menu bawah
 * ada di tata letak, di luar template ini, dan diberi nama transisinya sendiri
 * di globals.css supaya tidak tertutup konten yang sedang masuk. Lihat
 * `components/gerak/TransisiHalaman.tsx`.
 */
export default function PwaTemplate({ children }: { children: React.ReactNode }) {
  return <TransisiHalaman>{children}</TransisiHalaman>;
}
