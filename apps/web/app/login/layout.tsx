import type { Metadata } from "next";

/* Halaman masuk sendiri berupa komponen klien, yang tidak boleh mengekspor
   metadata — judul tabnya dipasang dari tata letak ini: "Masuk · Elorae". */
export const metadata: Metadata = { title: "Masuk" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
