import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { kandidatPenanggung, rincianRetur, tokoUntukRetur } from "@/lib/receivables/return-queries";
import { RincianReturClient, type RincianBarangRetur } from "./RincianReturClient";
import { prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { koreksiTertunda, penggantiUntuk, riwayatDokumen } from "@/lib/receivables/koreksi";
import { bolehMembacaRetur } from "@/lib/receivables/izin";

export const dynamic = "force-dynamic";

export default async function RincianReturPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaRetur(session.user.permissions)) redirect("/backoffice");

  const { id } = await params;
  const kelola = hasPermission(session.user.permissions ?? [], PERMISSIONS.RECEIVABLES_MANAGE);
  const [data, kandidat, tokoTujuan] = await Promise.all([
    rincianRetur(id),
    kelola ? kandidatPenanggung() : Promise.resolve([]),
    kelola ? tokoUntukRetur() : Promise.resolve([]),
  ]);
  if (!data) notFound();

  const [pengganti, asal, koreksi, riwayat, barang, barisBuku] = await Promise.all([
    penggantiUntuk("retur", [id]),
    prisma.storeReturn
      .findUnique({ where: { id }, select: { replacesReturnId: true } })
      .then((n) =>
        n?.replacesReturnId
          ? prisma.storeReturn.findUnique({ where: { id: n.replacesReturnId }, select: { id: true, noNrt: true } })
          : null,
      ),
    koreksiTertunda("retur", [id]),
    // Nota dan hitungan gudangnya: pemindahan toko tercatat di keduanya.
    riwayatDokumen([id, ...(data.gudang ? [data.gudang.id] : [])]),
    // Baris per varian + kondisi (nota SPG), dibaca di sini karena rinciannya
    // menyandingkan per nama saja.
    prisma.storeReturn.findUnique({
      where: { id },
      select: {
        reportedBySpg: true,
        items: { select: { itemId: true, variantSku: true, itemName: true, qty: true, amount: true, condition: true } },
        warehouseReturn: {
          select: {
            items: { select: { itemId: true, variantSku: true, itemName: true, qtyClaim: true, qty: true, amount: true, condition: true } },
          },
        },
      },
    }),
    // Nota yang sudah menggerakkan buku stok toko tidak bisa dipindah toko.
    prisma.storeStockMovement.count({ where: { refType: "StoreReturn", refId: id } }),
  ]);
  const rincianBarang: RincianBarangRetur | null = barang
    ? {
        dariSpg: barang.reportedBySpg,
        adaBukuToko: barisBuku > 0,
        klaim: barang.items.map((i) => ({ ...i, amount: Number(i.amount) })),
        fisik: (barang.warehouseReturn?.items ?? []).map((i) => ({ ...i, amount: Number(i.amount) })),
      }
    : null;
  const k = koreksi.get(id);

  return (
    <RincianReturClient
      data={data}
      kandidat={kandidat}
      bolehMengelola={kelola}
      tokoTujuan={tokoTujuan}
      digantiOleh={pengganti.get(id) ?? null}
      menggantikan={asal ? { id: asal.id, nomor: asal.noNrt } : null}
      koreksi={k ? { pada: formatDisplayDate(k.pada), alasan: k.alasan } : null}
      riwayat={riwayat}
      rincianBarang={rincianBarang}
    />
  );
}
