import { redirect } from "next/navigation";
import { tujuanAkunProfil } from "./tujuan";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

/**
 * Akun Profil (versi tim) DITUTUP — keputusan pemilik 2026-11-01: akun diurus di
 * Pengaturan → Pengguna, peran di Pengaturan → Peran & izin. Rute lamanya hanya
 * meneruskan, supaya tautan dan markah lama tetap sampai ke halaman yang benar.
 * Halaman tujuan memagari dirinya sendiri, jadi di sini tidak ada pemeriksaan izin.
 */
export default async function ProfileAccountsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  redirect(tujuanAkunProfil(sp.tab === "roles" ? { jenis: "peran" } : { jenis: "daftar" }));
}
