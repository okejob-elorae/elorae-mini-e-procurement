import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatDisplayDate } from "@/lib/date-only";
import { JENIS_KIRIMAN, kirimanMenunggu, type JenisKiriman } from "@/lib/spg/kiriman";
import { tokoSpg } from "@/lib/spg/queries";
import { getActiveVisit } from "@/lib/stores/queries";
import { FormTerima } from "./FormTerima";

export const dynamic = "force-dynamic";

/**
 * Formulir menerima satu kiriman. Kirimannya dicari di daftar yang SAMA dengan
 * yang ditampilkan di layar sebelumnya — kiriman yang sudah diterima, milik
 * toko lain, atau di luar jendela pelacakan tidak bisa dibuka lewat alamat.
 */
export default async function SpgTerimaKirimanPage({ params }: { params: Promise<{ jenis: string; id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const toko = await tokoSpg(session.user.id);
  if (!toko) redirect("/pwa");

  const { jenis, id } = await params;
  const jenisSah = (JENIS_KIRIMAN as string[]).includes(jenis) ? (jenis as JenisKiriman) : null;

  const [daftar, aktif] = await Promise.all([
    jenisSah ? kirimanMenunggu(toko.id) : Promise.resolve([]),
    getActiveVisit(session.user.id),
  ]);
  const k = daftar.find((x) => x.sourceType === jenisSah && x.sourceId === id) ?? null;
  // Opname SESUDAH kiriman ini berangkat: barangnya mungkin sudah tiba dan ikut
  // terhitung di opname itu. Menerimanya penuh lagi menghitungnya dua kali.
  const opname = k
    ? await prisma.storeOpname.findFirst({
        where: { storeId: toko.id, countedAt: { gt: k.tanggal } },
        orderBy: { countedAt: "desc" },
        select: { countedAt: true },
      })
    : null;

  const kunjungan = aktif && aktif.storeId === toko.id ? { id: aktif.id, checkinAtMs: aktif.checkinAt.getTime() } : null;

  return (
    <FormTerima
      storeId={toko.id}
      kunjunganServer={kunjungan}
      sudahCheckIn={kunjungan !== null}
      kiriman={
        k
          ? {
              sourceType: k.sourceType,
              sourceId: k.sourceId,
              docNo: k.docNo,
              tanggalLabel: formatDisplayDate(k.tanggal),
              lines: k.lines,
              opnameSesudah: opname ? formatDisplayDate(opname.countedAt) : null,
            }
          : null
      }
    />
  );
}
