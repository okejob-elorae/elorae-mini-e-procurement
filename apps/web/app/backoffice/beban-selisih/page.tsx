import { redirect } from "next/navigation";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarBeban } from "@/lib/receivables/dashboard-queries";
import { kandidatPenanggung } from "@/lib/receivables/return-queries";
import { bebanTokoDiNota } from "@/lib/receivables/return-writer";
import { bolehMembacaPiutang, bolehMemutuskanSelisihRetur } from "@/lib/receivables/izin";
import { BebanClient } from "./BebanClient";

export const dynamic = "force-dynamic";

export default async function BebanSelisihPage() {
  const session = await auth();
  if (!session) redirect("/login");
  // Rute modul piutang tidak dipetakan di ROUTE_PERMISSIONS — halaman memagari dirinya sendiri.
  if (!bolehMembacaPiutang(session.user.permissions)) redirect("/backoffice");

  const izin = session.user.permissions ?? [];
  // Tandai lunas = receivables:manage; alihkan beban selisih retur = store_returns:decide_shortfall
  // (P22, alihkanBebanAction). Potong dari komisi sales dan kembalikan kelebihannya (P87) dikerjakan
  // di Laporan → Komisi salesman: halamannya dijaga field_sales_orders:approve, dan kedua tombolnya
  // memanggil aksi yang dijaga receivables:manage (potongRetur di app/actions/store-returns.ts). Tautan
  // ke sana hanya untuk yang memegang KEDUANYA — yang lain akan tiba di laporan tanpa tombol.
  const kelola = hasPermission(izin, PERMISSIONS.RECEIVABLES_MANAGE);
  const putusBeban = bolehMemutuskanSelisihRetur(izin);
  const potongKomisiSales = kelola && hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  const [baris, kandidat] = await Promise.all([
    daftarBeban(),
    // Calon penanggung hanya dipakai dialog alihkan beban.
    putusBeban ? kandidatPenanggung() : Promise.resolve([]),
  ]);

  /*
   * Beban TOKO tidak pernah lunas di sini — selisihnya tetap terbuka di nota asal toko (P84). Yang
   * masih harus ditagih dibaca seperti rincian nota retur: bagian yang tidak dikreditkan ke toko di
   * BKM hidup, dibatasi sisa faktur yang membawanya (`bebanTokoDiNota().tampil`), sehingga beban yang
   * sudah dibayar toko berhenti disebut "masih ditagih". Satu baris yang gagal dibaca tampil tanpa
   * keterangan itu, tidak menggagalkan halaman.
   */
  const tokoDiNota: Record<string, { tertahan: number; tampil: number }> = {};
  const returToko = [
    ...new Set(
      baris
        .filter((b) => b.penanggung === "TOKO" && b.status !== "TERBUKA" && b.storeReturnId)
        .map((b) => b.storeReturnId as string),
    ),
  ];
  await Promise.all(
    returToko.map(async (storeReturnId) => {
      try {
        const d = await bebanTokoDiNota(prisma, storeReturnId);
        tokoDiNota[storeReturnId] = { tertahan: d.tertahan, tampil: d.tampil };
      } catch (e) {
        console.error("[beban-selisih] gagal membaca beban toko di nota", storeReturnId, e);
      }
    }),
  );

  return (
    <BebanClient
      baris={baris}
      tokoDiNota={tokoDiNota}
      kandidat={kandidat}
      bolehMengelola={kelola}
      bolehPutuskanBeban={putusBeban}
      bolehPotongKomisiSales={potongKomisiSales}
    />
  );
}
