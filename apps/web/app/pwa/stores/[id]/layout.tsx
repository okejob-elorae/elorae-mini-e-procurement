import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";

/**
 * Pagar SPG untuk SEMUA halaman di bawah satu toko (`/pwa/stores/<id>/…`).
 *
 * SPG punya satu toko tetap (`User.assignedStoreId`). Halaman tokonya sudah
 * menolak toko lain, tetapi subhalamannya — checklist, harga pesaing, analisa,
 * katalog, dan seterusnya — hanya memeriksa `pwa:access`, jadi SPG yang
 * mengetik alamat toko lain membukanya. Layout ini dirender ulang setiap kali
 * `id` berganti, jadi satu pemeriksaan di sini menutup semuanya, termasuk
 * subhalaman yang ditambahkan kelak.
 *
 * Salesman (tanpa toko tetap) tidak disentuh: kunci toko-sendiri mereka diatur
 * per halaman (`salesman.tokoTerkunci`). Aksi server di subhalaman tetap wajib
 * memeriksa dirinya sendiri — layout tidak dijalankan untuk panggilan aksi.
 */
export default async function TokoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/pwa");
  const { id } = await params;
  const tokoTetap = await ambilTokoTetap(session.user.id);
  if (tokoTetap && tokoTetap !== id) redirect("/pwa");
  return children;
}
