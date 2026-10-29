"use server";

import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { nomorWhatsApp } from "@/lib/salesman/dasbor";
import type { MemberPembeli } from "@/lib/spg/member-hp";
import { memberPembeliPerNomor } from "@/lib/spg/member-hp-queries";

/**
 * Cari pelanggan toko SPG dari layar jual (nama atau nomor HP). Hanya
 * pelanggan TOKO SPG itu sendiri — tokonya diturunkan di server dari
 * `User.assignedStoreId`, tidak pernah dari layar.
 *
 * Dengan `{ member: true }` setiap hasil membawa keadaan member nomornya
 * (tingkat dan diskon saja — member berlaku di semua toko Elorae).
 */
export type PelangganCari = { id: string; name: string; phone: string; member?: MemberPembeli };

type GagalAkses = { ok: false; code: "FORBIDDEN" | "NO_ASSIGNED_STORE" };

async function tokoPemanggil(): Promise<{ storeId: string } | GagalAkses> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const storeId = await ambilTokoTetap(session.user.id);
  if (!storeId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  return { storeId };
}

export async function cariPelangganSpgAction(q: string, opsi?: { member?: boolean }): Promise<{ ok: true; hasil: PelangganCari[] } | GagalAkses> {
  const akses = await tokoPemanggil();
  if ("ok" in akses) return akses;
  const { storeId } = akses;

  const teks = String(q ?? "").trim().slice(0, 60);
  const angka = teks.replace(/\D/g, "");
  // "0812…" dan "812…" dicari sebagai "62812…", bentuk yang disimpan.
  const hp = angka.startsWith("0") ? `62${angka.slice(1)}` : angka.startsWith("8") ? `62${angka}` : angka;
  const atau = [
    ...(teks ? [{ name: cariTeks(teks) }] : []),
    ...(hp.length >= 4 ? [{ phone: { contains: hp } }] : []),
  ];
  const hasil = await prisma.storeCustomer.findMany({
    where: { storeId, ...(atau.length ? { OR: atau } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, name: true, phone: true },
  });
  if (opsi?.member !== true || hasil.length === 0) return { ok: true, hasil };
  const member = await memberPembeliPerNomor(hasil.map((h) => h.phone));
  return { ok: true, hasil: hasil.map((h) => ({ ...h, member: member.get(h.phone) })) };
}

/**
 * Keadaan member untuk nomor pembeli BARU yang diketik di konter — supaya total
 * di HP memakai tingkat dan diskon yang sama dengan nota tercatat. Hanya
 * tingkat dan diskon yang dikembalikan; apakah nomor itu pelanggan toko lain,
 * namanya, atau belanjanya tidak pernah keluar dari sini.
 */
export async function cekMemberNomorAction(
  hp: string,
): Promise<{ ok: true; hp: string; member: MemberPembeli } | GagalAkses | { ok: false; code: "HP_TIDAK_VALID" }> {
  const akses = await tokoPemanggil();
  if ("ok" in akses) return akses;
  const nomor = nomorWhatsApp(String(hp ?? "").slice(0, 40));
  if (!nomor) return { ok: false, code: "HP_TIDAK_VALID" };
  const member = (await memberPembeliPerNomor([nomor])).get(nomor);
  if (!member) return { ok: false, code: "HP_TIDAK_VALID" };
  return { ok: true, hp: nomor, member };
}
