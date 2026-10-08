import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { hariIniWib } from "@/lib/tanggal-isian";
import { akunUntukAset } from "@/lib/finance/aset/queries";
import { rincianTemplat } from "@/lib/finance/berulang/queries";
import { FormTemplat } from "../../FormTemplat";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/** Keuangan → Jurnal berulang → Ubah templat. Butuh `journals:manage`; menyimpan menonaktifkan templat sampai disetujui orang lain. */
export default async function UbahTemplatPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) redirect(`/backoffice/finance/jurnal-berulang/${id}`);
  const [t, akun] = await Promise.all([rincianTemplat(id), akunUntukAset()]);
  if (!t) notFound();
  return (
    <FormTemplat
      akun={akun}
      hariIni={hariIniWib()}
      ubah={{
        id: t.id,
        nilai: {
          nama: t.nama,
          keterangan: t.keterangan ?? "",
          hari: t.hari,
          mulai: t.mulai,
          selesai: t.selesai ?? "",
          balikOtomatis: t.balikOtomatis,
          baris: t.baris.map((b) => ({
            akunId: b.akunId,
            debit: b.debit ? String(b.debit) : "",
            kredit: b.kredit ? String(b.kredit) : "",
            memo: b.memo ?? "",
            kanal: b.kanal ?? "",
          })),
        },
      }}
    />
  );
}
