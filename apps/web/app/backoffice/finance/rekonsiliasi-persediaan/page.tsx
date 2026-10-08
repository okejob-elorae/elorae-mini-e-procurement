import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { bacaSumberOperasional } from "@/lib/finance/operasional/aturan";
import { rekonsiliasiPersediaan, type RekonsiliasiPersediaan } from "@/lib/finance/operasional/rekonsiliasi-persediaan-queries";
import { dokumenOperasionalTanpaJurnal } from "@/lib/finance/operasional/sapuan";
import { cariInfoDokumen } from "../journals/_sumber/info-dokumen";
import { kunciDokumen, tautanDokumenSumber } from "../journals/_sumber/tautan";
import { jenisDanIdSumber } from "../journals/_tertunda/sebab";
import { RekonsiliasiPersediaanClient, type BarisTindakanOperasional } from "./RekonsiliasiPersediaanClient";

export const dynamic = "force-dynamic";

/** Dokumen tanpa jurnal yang ditampilkan per jenis (layar, bukan sapuan). */
const BATAS_TANPA_JURNAL = 50;

/**
 * Keuangan → Rekonsiliasi persediaan: saldo akun persediaan di buku besar
 * (bahan, barang jadi, konsinyasi, rusak, kanvas) dibandingkan dengan nilai
 * stok sistem, beserta penyebab selisih yang sudah diketahui dan jurnal
 * operasional yang tertunda atau belum pernah diposting. Melihat
 * `journals:view`; memposting `journals:manage`.
 */
export default async function RekonsiliasiPersediaanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  let rekon: RekonsiliasiPersediaan | null = null;
  let tindakan: BarisTindakanOperasional[] = [];
  let gagal = false;
  try {
    const [r, tertunda, tanpa] = await Promise.all([
      rekonsiliasiPersediaan(),
      daftarJurnalTertunda(),
      dokumenOperasionalTanpaJurnal(BATAS_TANPA_JURNAL),
    ]);
    rekon = r;
    const dariTertunda: BarisTindakanOperasional[] = [];
    for (const t of tertunda) {
      const s = jenisDanIdSumber(t.sumber);
      const sumber = s ? bacaSumberOperasional(s.jenis) : null;
      if (!s || !sumber) continue;
      dariTertunda.push({
        sumber,
        id: s.id,
        nomor: typeof t.metadata.docNo === "string" ? t.metadata.docNo : null,
        sebab: t.sebab,
        peran: t.peran,
        tanggal: t.dicatatPada.toISOString(),
      });
    }
    const sudah = new Set(dariTertunda.map((b) => `${b.sumber}|${b.id}`));
    const semua: BarisTindakanOperasional[] = [
      ...dariTertunda,
      ...tanpa
        .filter((d) => !sudah.has(`${d.sumber}|${d.id}`))
        .map((d) => ({ sumber: d.sumber, id: d.id, nomor: null, sebab: null, peran: null, tanggal: d.tanggal })),
    ];
    const info = await cariInfoDokumen(semua.map((b) => ({ jenis: b.sumber, id: b.id })));
    tindakan = semua.map((b) => {
      const dok = info.get(kunciDokumen(b.sumber, b.id));
      return { ...b, nomor: b.nomor ?? dok?.nomor ?? null, href: tautanDokumenSumber(b.sumber, b.id, dok ?? {}) };
    });
  } catch (err) {
    console.error("[rekonsiliasi-persediaan] gagal memuat", err);
    gagal = true;
  }

  return (
    <RekonsiliasiPersediaanClient
      rekon={rekon}
      tindakan={tindakan}
      gagal={gagal}
      bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
    />
  );
}
