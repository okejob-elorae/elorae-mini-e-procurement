import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { formatDisplayDateTime } from "@/lib/date-only";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import {
  bacaSaringPermintaan,
  daftarPermintaanMasuk,
  hitungPermintaanMasuk,
  saringBawaan,
  tokoDipegang,
} from "@/lib/spg/permintaan-salesman";
import { PermintaanMasukClient } from "./PermintaanMasukClient";

export const dynamic = "force-dynamic";

const POLA_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Kotak masuk salesman: permintaan barang SPG dari toko yang ia PEGANG.
 * `?status=` memilih tab (bawaan: yang menunggu tindakan), `?toko=<storeId>`
 * menyaring ke satu toko (tautan dari analisa toko) — hanya bila toko itu
 * memang dipegangnya. SPG punya layar permintaannya sendiri (layar stok).
 */
export default async function PermintaanMasukPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; toko?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (pwaAccessGuard(session.user.permissions) !== "render") redirect("/backoffice");
  if (await ambilTokoTetap(session.user.id)) redirect("/pwa");
  const userId = session.user.id;

  const sp = await searchParams;
  const tokoParam = Array.isArray(sp.toko) ? sp.toko[0] : sp.toko;
  const toko = tokoParam && POLA_ID.test(tokoParam) ? await tokoDipegang(userId, tokoParam) : null;

  const hitung = await hitungPermintaanMasuk(userId, toko?.id);
  const status = bacaSaringPermintaan(sp.status) ?? saringBawaan(hitung);
  const daftar = await daftarPermintaanMasuk(userId, { status, storeId: toko?.id });

  return (
    <PermintaanMasukClient
      status={status}
      hitung={hitung}
      toko={toko}
      // Toko di alamat yang tidak dipegang: saringannya diabaikan, dan layar menyebutnya.
      tokoDitolak={Boolean(tokoParam) && !toko}
      // Tanggal diformat di server (WIB) — format di klien bisa berbeda antara Node dan Safari.
      daftar={daftar.map((d) => ({ ...d, dibuatLabel: formatDisplayDateTime(d.dibuat) }))}
    />
  );
}
