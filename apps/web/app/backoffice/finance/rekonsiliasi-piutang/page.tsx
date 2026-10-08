import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { daftarJurnalTertunda } from "@/lib/finance/jurnal-tertunda";
import { bacaSumberLapangan } from "@/lib/finance/lapangan/aturan";
import { rekonsiliasiPiutangToko } from "@/lib/finance/lapangan/rekonsiliasi-queries";
import type { RekonsiliasiPiutang } from "@/lib/finance/lapangan/rekonsiliasi";
import { dokumenLapanganTanpaJurnal } from "@/lib/finance/lapangan/selaraskan-toko";
import { cariInfoDokumen } from "../journals/_sumber/info-dokumen";
import { kunciDokumen, tautanDokumenSumber } from "../journals/_sumber/tautan";
import { jenisDanIdSumber } from "../journals/_tertunda/sebab";
import { RekonsiliasiPiutangClient, type BarisTindakan } from "./RekonsiliasiPiutangClient";

export const dynamic = "force-dynamic";

/** Dokumen tanpa jurnal yang ditampilkan per jenis (layar, bukan sapuan). */
const BATAS_TANPA_JURNAL = 50;

/**
 * Keuangan → Rekonsiliasi piutang toko: saldo `AR_STORE` di buku besar per toko
 * dibandingkan dengan Σ sisa piutang modul piutang, beserta jurnal lapangan yang
 * tertunda dan dokumen lapangan yang belum berjurnal. Melihat `journals:view`;
 * memposting/menyelaraskan `journals:manage`.
 */
export default async function RekonsiliasiPiutangPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const izin = session.user.permissions ?? [];
  if (!hasPermission(izin, PERMISSIONS.JOURNALS_VIEW)) redirect("/backoffice");

  let rekon: RekonsiliasiPiutang | null = null;
  let tindakan: BarisTindakan[] = [];
  let gagal = false;
  try {
    const [r, tertunda, tanpa] = await Promise.all([
      rekonsiliasiPiutangToko(),
      daftarJurnalTertunda(),
      dokumenLapanganTanpaJurnal(BATAS_TANPA_JURNAL),
    ]);
    rekon = r;
    const dariTertunda: BarisTindakan[] = [];
    for (const t of tertunda) {
      const s = jenisDanIdSumber(t.sumber);
      const sumber = s ? bacaSumberLapangan(s.jenis) : null;
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
    const semua: BarisTindakan[] = [
      ...dariTertunda,
      ...tanpa
        .filter((d) => !sudah.has(`${d.sumber}|${d.id}`))
        .map((d) => ({ sumber: d.sumber, id: d.id, nomor: d.label, sebab: null, peran: null, tanggal: d.tanggal })),
    ];
    const info = await cariInfoDokumen(semua.map((b) => ({ jenis: b.sumber, id: b.id })));
    tindakan = semua.map((b) => {
      const dok = info.get(kunciDokumen(b.sumber, b.id));
      return { ...b, nomor: b.nomor ?? dok?.nomor ?? null, href: tautanDokumenSumber(b.sumber, b.id, dok ?? {}) };
    });
  } catch (err) {
    console.error("[rekonsiliasi-piutang] gagal memuat", err);
    gagal = true;
  }

  return (
    <RekonsiliasiPiutangClient
      rekon={rekon}
      tindakan={tindakan}
      gagal={gagal}
      bolehMengelola={hasPermission(izin, PERMISSIONS.JOURNALS_MANAGE)}
    />
  );
}
