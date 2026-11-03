import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { menungguGudang, menungguSusulanGudang } from "@/lib/receivables/pwa-queries";
import { GudangClient } from "./GudangClient";
import { untukPenghitung, untukPenghitungSusulan } from "./nilai";

export const dynamic = "force-dynamic";

export default async function GudangReturPage() {
  const session = await auth();
  const penghitungId = session?.user?.id ?? "";
  const [nota, susulan] = await Promise.all([menungguGudang(), menungguSusulanGudang()]);
  // Pelapor tiap nota, supaya nota milik penghitung sendiri ditandai di layar
  // (server tetap menolaknya — ini hanya agar ia tidak mencoba sia-sia).
  const pelapor = nota.length
    ? await prisma.storeReturn.findMany({
        where: { id: { in: nota.map((n) => n.id) } },
        select: { id: true, salesmanId: true },
      })
    : [];
  const pelaporPer = new Map(pelapor.map((p) => [p.id, p.salesmanId]));
  // Selisih yang penanggungnya sudah membayar sebagian tidak lagi menerima barang susulan
  // (P87, bawaan tercatat) — barangnya diterima sebagai penerimaan tanpa nota.
  const sudahDibayar = susulan.length
    ? new Set(
        (
          await prisma.returnCharge.findMany({
            where: { id: { in: susulan.map((s) => s.chargeId) }, settledAmount: { gt: 0 } },
            select: { id: true },
          })
        ).map((c) => c.id),
      )
    : new Set<string>();
  // Klaim dibuang DI SERVER: qty dan nilai klaim tidak pernah sampai ke peramban —
  // begitu pula jumlah yang kurang dan catatan cek sales untuk barang susulan.
  return (
    <GudangClient
      baris={nota.map((n) => untukPenghitung(n, penghitungId, pelaporPer.get(n.id) ?? null))}
      susulan={susulan.filter((s) => !sudahDibayar.has(s.chargeId)).map((s) => untukPenghitungSusulan(s, penghitungId))}
    />
  );
}
