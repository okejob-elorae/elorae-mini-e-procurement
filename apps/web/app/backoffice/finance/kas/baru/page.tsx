import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaJenisVoucher } from "@/lib/finance/kas/aturan";
import { akunBarisVoucher } from "@/lib/finance/kas/voucher-queries";
import { daftarKategori } from "@/lib/finance/kas/kategori-writer";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { bacaTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { urutPemasok } from "@/lib/suppliers/label-pemasok";
import { bacaSkbPemasok } from "@/lib/finance/pajak/pemotongan";
import { FormVoucher } from "./FormVoucher";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;
const satu = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Voucher kas & bank baru: `?jenis=OUT` (BKK, bawaan), `IN` (BKMK), `TRANSFER`.
 * Butuh `journals:manage`.
 */
export default async function VoucherBaruPage({ searchParams }: { searchParams: Promise<{ jenis?: Param }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) redirect("/backoffice/finance/kas");
  const sp = await searchParams;
  const rekening = await rekeningKasBank();
  const [kategori, akun, pemasok, tarif] = await Promise.all([
    daftarKategori(),
    akunBarisVoucher(new Set(rekening.map((r) => r.id))),
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true, taxWithholding: true, hasNpwp: true, skbNumber: true, skbValidUntil: true } }),
    bacaTarifPajakKreatif(),
  ]);
  return (
    <FormVoucher
      jenisAwal={bacaJenisVoucher(satu(sp.jenis)) ?? "OUT"}
      rekening={rekening}
      kategori={kategori.filter((k) => k.aktif)}
      akun={akun}
      pemasok={urutPemasok(pemasok).map((p) => ({ id: p.id, kode: p.code, nama: p.name, jenisPotong: p.taxWithholding, adaNpwp: p.hasNpwp, skb: bacaSkbPemasok(p) }))}
      tarif={tarif}
      hariIni={hariIniWib()}
    />
  );
}
