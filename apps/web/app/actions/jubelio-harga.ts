"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaHargaDiharapkan, MAKS_ANTRE_LANGSUNG, MAKS_BARIS_KONFIRMASI } from "@/lib/jubelio/harga/aturan";
import {
  kembalikanHargaErp,
  kirimUlangHargaJubelio,
  konfirmasiHargaJubelio,
  type HasilKembalikanHarga,
  type HasilKirimUlang,
  type HasilKonfirmasiHarga,
} from "@/lib/jubelio/harga/writer";
import { fireProductPushNow } from "@/lib/jubelio/product-push";
import { gagalJubelio, jalankanAksiJubelio, type HasilJubelio } from "@/app/backoffice/jubelio/galat-jubelio";

/**
 * Aksi halaman Jubelio → Konfirmasi harga (keputusan pemilik 2026-11-02). Ketiganya butuh
 * `jubelio_prices:confirm` — izin yang sama dengan halaman, tombol, baris Beranda dan lonceng;
 * bawaannya hanya admin. Pelakunya selalu dari sesi, tidak pernah dari isian. "Batalkan pengajuan"
 * sudah tidak ada: barang dijual di marketplace atau tidak kini ditentukan saluran jualnya di
 * halaman barang (jawaban pemilik P3/P76).
 */

const HALAMAN = "/backoffice/jubelio/harga";

async function pelakuBerizin(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JUBELIO_PRICES_CONFIRM)) return null;
  return session.user.id;
}

function idSah(nilai: unknown): nilai is string {
  return typeof nilai === "string" && nilai.length > 0 && nilai.length <= 64;
}

/**
 * Setujui & kirim ke Jubelio. Isian: `[{ itemId, hargaErp }]` — `hargaErp` adalah harga ERP yang
 * dilihat orangnya saat halaman dibuka; baris yang harganya berubah sejak itu ditolak
 * (`HARGA_BERUBAH`). Setiap baris transaksinya sendiri, jadi satu penolakan tidak membatalkan
 * yang lain. Kiriman langsung hanya untuk sedikit baris; sisanya diambil poller.
 */
export async function konfirmasiHargaJubelioAction(
  baris: unknown,
): Promise<HasilJubelio<Array<{ itemId: string; hasil: HasilKonfirmasiHarga["hasil"] }>>> {
  return jalankanAksiJubelio(async () => {
    const pelaku = await pelakuBerizin();
    if (!pelaku) return gagalJubelio("TANPA_AKSES");

    if (!Array.isArray(baris) || baris.length === 0 || baris.length > MAKS_BARIS_KONFIRMASI) {
      return gagalJubelio("ISIAN_TIDAK_SAH");
    }
    const isian: Array<{ itemId: string; hargaErp: string | null }> = [];
    const sudah = new Set<string>();
    for (const b of baris) {
      const itemId = (b as { itemId?: unknown } | null)?.itemId;
      const harga = bacaHargaDiharapkan((b as { hargaErp?: unknown } | null)?.hargaErp);
      if (!idSah(itemId) || !harga.ok || sudah.has(itemId)) return gagalJubelio("ISIAN_TIDAK_SAH");
      sudah.add(itemId);
      isian.push({ itemId, hargaErp: harga.harga });
    }

    if ((await prisma.jubelioPushDefaults.count()) === 0) return gagalJubelio("BAWAAN_BELUM_ADA");

    const hasil: Array<{ itemId: string; hasil: HasilKonfirmasiHarga["hasil"] }> = [];
    const terkirim: string[] = [];
    for (const { itemId, hargaErp } of isian) {
      const h = await konfirmasiHargaJubelio({ itemId, hargaErpDiharapkan: hargaErp, olehUserId: pelaku });
      hasil.push({ itemId, hasil: h.hasil });
      if (h.hasil === "DIKONFIRMASI") terkirim.push(h.outboxId);
    }
    if (terkirim.length <= MAKS_ANTRE_LANGSUNG) {
      for (const rowId of terkirim) fireProductPushNow(rowId, pelaku);
    }

    revalidatePath(HALAMAN);
    return { ok: true, data: hasil };
  });
}

/** Kembalikan harga ERP ke harga Jubelio. Isian: `{ itemId, hargaErp }`. */
export async function kembalikanHargaErpAction(input: unknown): Promise<HasilJubelio<HasilKembalikanHarga>> {
  return jalankanAksiJubelio(async () => {
    const pelaku = await pelakuBerizin();
    if (!pelaku) return gagalJubelio("TANPA_AKSES");

    const itemId = (input as { itemId?: unknown } | null)?.itemId;
    const harga = bacaHargaDiharapkan((input as { hargaErp?: unknown } | null)?.hargaErp);
    if (!idSah(itemId) || !harga.ok) return gagalJubelio("ISIAN_TIDAK_SAH");

    const h = await kembalikanHargaErp({ itemId, hargaErpDiharapkan: harga.harga, olehUserId: pelaku });
    if (h.hasil === "DIKEMBALIKAN") fireProductPushNow(h.outboxId, pelaku);

    revalidatePath(HALAMAN);
    revalidatePath(`/backoffice/items/${itemId}`);
    return { ok: true, data: h };
  });
}

/** ISO yang terbaca sebagai waktu, atau null. */
function waktuSah(nilai: unknown): nilai is string | null {
  return nilai === null || (typeof nilai === "string" && nilai.length <= 40 && !Number.isNaN(Date.parse(nilai)));
}

/**
 * "Kirim ulang harga ERP" — satu-satunya jalan keluar "Harga di Jubelio berbeda dengan ERP"
 * (jawaban pemilik P74). SATU baris per tekan (rancangan R26): setiap penimpaan harga di Jubelio
 * adalah keputusan sendiri atas angka yang dilihat orangnya (P75 "saya tidak setuju jika harga bisa
 * tertimpa"). Isian: `{ itemId, berubahPada }` — `berubahPada` adalah waktu bacaan Jubelio berubah
 * yang ditampilkan halaman; bila Jubelio berubah lagi sejak itu, ditolak (`TERBACA_BERUBAH`).
 */
export async function kirimUlangHargaJubelioAction(input: unknown): Promise<HasilJubelio<HasilKirimUlang>> {
  return jalankanAksiJubelio(async () => {
    const pelaku = await pelakuBerizin();
    if (!pelaku) return gagalJubelio("TANPA_AKSES");

    const itemId = (input as { itemId?: unknown } | null)?.itemId;
    const berubahPada = (input as { berubahPada?: unknown } | null)?.berubahPada;
    if (!idSah(itemId) || !waktuSah(berubahPada)) return gagalJubelio("ISIAN_TIDAK_SAH");

    if ((await prisma.jubelioPushDefaults.count()) === 0) return gagalJubelio("BAWAAN_BELUM_ADA");

    const h = await kirimUlangHargaJubelio({ itemId, berubahPadaDiharapkan: berubahPada, olehUserId: pelaku });
    if (h.hasil === "DIKIRIM_ULANG") fireProductPushNow(h.outboxId, pelaku);

    revalidatePath(HALAMAN);
    revalidatePath(`/backoffice/items/${itemId}`);
    return { ok: true, data: h };
  });
}
