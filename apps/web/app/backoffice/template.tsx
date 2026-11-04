import { TransisiHalaman } from "@/components/gerak/TransisiHalaman";

/**
 * Konten kantor memudar masuk saat berpindah bagian (View Transitions). Kepala
 * dan menu samping ada di tata letak, di luar template ini, jadi tidak ikut
 * dipasang ulang. Lihat `components/gerak/TransisiHalaman.tsx`.
 */
export default function BackofficeTemplate({ children }: { children: React.ReactNode }) {
  return <TransisiHalaman>{children}</TransisiHalaman>;
}
