import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { bacaStatusPromoKonter, hariSah } from "@/lib/spg/promo-konter-kantor";
import { daftarPromoKonterKantor, laporanDiskonManual, laporanPemakaianPromo } from "@/lib/spg/promo-konter-kantor-queries";
import { hariIniWib } from "@/lib/tanggal-isian";
import { PromoKonterPageClient, type TabPromoKonter } from "./PromoKonterPageClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string; status?: string; dari?: string; sampai?: string }>;
};

const TAB: readonly TabPromoKonter[] = ["daftar", "pemakaian", "manual"];

/**
 * Promo konter SPG — kantor. Tiga tab di alamat (`?tab=`): daftar promo,
 * pemakaian per promo, dan nota yang diberi diskon manual oleh SPG. Rentang
 * tanggal (`?dari=&sampai=`, hari WIB) bawaannya bulan berjalan.
 *
 * Melihat = `promos:view`; tombol ubah hanya untuk `promos:manage` (aksinya
 * memeriksa ulang).
 */
export default async function PromoKonterPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.PROMOS_VIEW)) redirect("/backoffice");

  const sp = await searchParams;
  const tab = (TAB as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as TabPromoKonter) : "daftar";
  const status = bacaStatusPromoKonter(sp.status);
  const hariIni = hariIniWib();
  const dari = sp.dari && hariSah(sp.dari) ? sp.dari : `${hariIni.slice(0, 8)}01`;
  const sampaiMentah = sp.sampai && hariSah(sp.sampai) ? sp.sampai : hariIni;
  // Rentang terbalik dari alamat yang diketik tangan dibalik, bukan dikosongkan.
  const [awal, akhir] = dari <= sampaiMentah ? [dari, sampaiMentah] : [sampaiMentah, dari];
  const rentang = { dari: parseDateOnly(awal) ?? null, sampai: parseDateOnlyEnd(akhir) ?? null };

  const [daftar, pemakaian, manual] = await Promise.all([
    tab === "daftar" ? daftarPromoKonterKantor({ status }) : null,
    tab === "pemakaian" ? laporanPemakaianPromo(rentang) : null,
    tab === "manual" ? laporanDiskonManual(rentang) : null,
  ]);

  return (
    <PromoKonterPageClient
      tab={tab}
      status={status}
      dari={awal}
      sampai={akhir}
      bolehUbah={hasPermission(izin, PERMISSIONS.PROMOS_MANAGE)}
      daftar={daftar}
      pemakaian={pemakaian}
      manual={manual}
    />
  );
}
