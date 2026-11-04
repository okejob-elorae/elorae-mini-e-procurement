import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { withRetry } from "@/lib/db/tx-retry";
import { NAMA_TEMPLAT_AKUN, TEMPLAT_DAGANG_FESYEN, type AkunTemplat } from "./templat";
import { rencanaKosong, rencanaPasangTemplat, type KeadaanBagan, type RencanaTemplat } from "./rencana";
import type { AccountType } from "@/lib/constants/enums";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/** Nama tindakan jejak (`AuditLog.action`) — satu, supaya jejaknya bisa dicari. */
export const JEJAK_TEMPLAT_AKUN = "COA_TEMPLATE_INSTALLED";
/** `AuditLog.entityId` jejak pemasangan: templatnya, bukan satu akun. */
export const ID_JEJAK_TEMPLAT = "templat:dagang-fesyen";

/**
 * Keadaan bagan akun yang dibutuhkan rencana. `dipakai` (punya baris jurnal
 * atau pemetaan peran) hanya ditanyakan ke basis data untuk akun daun yang
 * akan menjadi INDUK templat — hanya di sanalah ia menentukan sesuatu.
 */
export async function bacaKeadaanBagan(
  client: AnyClient = prisma,
  templat: readonly AkunTemplat[] = TEMPLAT_DAGANG_FESYEN,
): Promise<KeadaanBagan> {
  const [akun, pemetaan] = await Promise.all([
    client.chartAccount.findMany({
      select: { id: true, code: true, name: true, type: true, depth: true, isActive: true, parentId: true },
    }),
    client.journalAccountMapping.findMany({ select: { role: true, chartAccountId: true } }),
  ]);
  const punyaAnak = new Set(akun.map((a) => a.parentId).filter((id): id is string => id !== null));
  const dipetakan = new Set(pemetaan.map((m) => m.chartAccountId));
  const kodeInduk = new Set(templat.map((t) => t.induk).filter((k): k is string => k !== null));
  const calon = akun.filter((a) => kodeInduk.has(a.code) && !punyaAnak.has(a.id) && !dipetakan.has(a.id)).map((a) => a.id);
  const berbaris = new Set<string>();
  if (calon.length > 0) {
    const baris = await client.journalLine.findMany({
      where: { chartAccountId: { in: calon } },
      select: { chartAccountId: true },
      distinct: ["chartAccountId"],
    });
    for (const b of baris) berbaris.add(b.chartAccountId);
  }
  return {
    akun: akun.map((a) => ({
      id: a.id,
      kode: a.code,
      nama: a.name,
      tipe: a.type as AccountType,
      kedalaman: a.depth,
      aktif: a.isActive,
      punyaAnak: punyaAnak.has(a.id),
      dipakai: dipetakan.has(a.id) || berbaris.has(a.id),
    })),
    peranTerpetakan: pemetaan.map((m) => m.role),
  };
}

export async function pratinjauTemplatAkun(client: AnyClient = prisma): Promise<RencanaTemplat> {
  return rencanaPasangTemplat(TEMPLAT_DAGANG_FESYEN, await bacaKeadaanBagan(client));
}

export type HasilPasangTemplat = {
  rencana: RencanaTemplat;
  akunDibuat: number;
  peranDipetakan: number;
};

/**
 * Pasang templat di dalam transaksi pemanggil. Rencana dihitung ulang di
 * dalam transaksi — yang ditulis selalu keadaan saat itu, bukan pratinjau yang
 * mungkin sudah basi. Tidak menulis apa pun (termasuk jejak) bila rencananya
 * kosong, jadi aman ditekan berulang kali.
 */
export async function pasangTemplatDalamTx(
  tx: Prisma.TransactionClient,
  opsi: { olehUserId: string; templat?: readonly AkunTemplat[] },
): Promise<HasilPasangTemplat> {
  const templat = opsi.templat ?? TEMPLAT_DAGANG_FESYEN;
  const keadaan = await bacaKeadaanBagan(tx, templat);
  const rencana = rencanaPasangTemplat(templat, keadaan);
  if (rencanaKosong(rencana)) return { rencana, akunDibuat: 0, peranDipetakan: 0 };

  const idPerKode = new Map(keadaan.akun.map((a) => [a.kode, a.id]));
  for (const a of rencana.akunBaru) {
    const parentId = a.kodeInduk === null ? null : (idPerKode.get(a.kodeInduk) ?? null);
    if (a.kodeInduk !== null && parentId === null) throw new Error(`Induk ${a.kodeInduk} untuk akun ${a.kode} tidak ditemukan`);
    const dibuat = await tx.chartAccount.create({
      data: { code: a.kode, name: a.nama, type: a.tipe, parentId, depth: a.kedalaman, isActive: true },
      select: { id: true },
    });
    idPerKode.set(a.kode, dibuat.id);
  }
  for (const p of rencana.pemetaanBaru) {
    const chartAccountId = idPerKode.get(p.kode);
    if (!chartAccountId) throw new Error(`Akun ${p.kode} untuk peran ${p.peran} tidak ditemukan`);
    await tx.journalAccountMapping.create({ data: { role: p.peran, chartAccountId } });
  }

  await tx.auditLog.create({
    data: {
      userId: opsi.olehUserId,
      action: JEJAK_TEMPLAT_AKUN,
      entityType: "ChartAccount",
      entityId: ID_JEJAK_TEMPLAT,
      metadata: {
        templat: NAMA_TEMPLAT_AKUN,
        akunDibuat: rencana.akunBaru.map((a) => `${a.kode} ${a.nama}`),
        peranDipetakan: rencana.pemetaanBaru.map((p) => `${p.peran} → ${p.kode}`),
        konflik: rencana.konflik.map((k) => `${k.kode} ${k.sebab}${k.peran.length ? ` (${k.peran.join(", ")})` : ""}`),
      },
    },
  });

  return { rencana, akunDibuat: rencana.akunBaru.length, peranDipetakan: rencana.pemetaanBaru.length };
}

export async function pasangTemplatAkun(opsi: { olehUserId: string }): Promise<HasilPasangTemplat> {
  return withRetry(() =>
    prisma.$transaction((tx) => pasangTemplatDalamTx(tx, opsi), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    }),
  );
}
