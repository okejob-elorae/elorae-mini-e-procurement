import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { akunUntukAset, isianAwalAsetDariDokumen, pemasokUntukAset, type IsianAwalAset } from "@/lib/finance/aset/queries";
import { FormAset } from "../FormAset";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
type PageProps = { searchParams: Promise<{ voucher?: Param; pembayaran?: Param }> };

const satu = (v: Param) => (Array.isArray(v) ? v[0] : v);

/**
 * Keuangan → Aset tetap → Catat aset. Butuh `journals:manage`.
 * `?voucher=<id>` / `?pembayaran=<id>` mengisi formulir dari voucher kas atau
 * pembayaran pemasok yang sudah menjurnal perolehannya (cara: sudah dicatat).
 */
export default async function AsetBaruPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) redirect("/backoffice/finance/aset-tetap");
  const sp = await searchParams;
  let isiAwal: IsianAwalAset | null = null;
  try {
    isiAwal = await isianAwalAsetDariDokumen({ voucher: satu(sp.voucher) ?? null, pembayaran: satu(sp.pembayaran) ?? null });
  } catch (e) {
    console.error("[aset-tetap/baru] gagal membaca dokumen sumber", e);
  }
  const [akun, pemasok] = await Promise.all([akunUntukAset(), pemasokUntukAset()]);
  return <FormAset akun={akun} pemasok={pemasok} hariIni={hariIniWib()} isiAwal={isiAwal} />;
}
